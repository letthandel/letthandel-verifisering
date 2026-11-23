#!/usr/bin/env python3
"""Lag data/stores.json fra Geofabriks norske OpenStreetMap-uttrekk."""
import json
import os
import re
import tempfile
import urllib.request
import urllib.error
import time
from datetime import datetime, timezone
from pathlib import Path
import osmium

SOURCE = "https://download.geofabrik.de/europe/norway-latest.osm.pbf"
REGION_SOURCES = [
    f"https://download.geofabrik.de/europe/norway/{region}-latest.osm.pbf"
    for region in ("nord-norge", "ostlandet", "sorlandet", "trondelag", "vestlandet")
]
CHAINS = [
    (r"europris", "Europris"),
    (r"eurospar", "EUROSPAR"),
    (r"rema\s*1000|rema1000", "Rema 1000"),
    (r"\bkiwi\b", "Kiwi"),
    (r"\bextra\b", "Extra"),
    (r"\bcoop\s*prix\b|\bprix\b", "Coop Prix"),
    (r"\bcoop\s*mega\b|\bmega\b", "Coop Mega"),
    (r"\bobs\b", "Obs"),
    (r"\bmeny\b", "MENY"),
    (r"\bbunnpris\b", "Bunnpris"),
    (r"\bspar\b", "SPAR"),
    (r"\bjoker\b", "Joker"),
    (r"\bnærbutikken\b|\bnaerbutikken\b", "Nærbutikken"),
    (r"\bmatkroken\b", "Matkroken"),
    (r"\bcoop\s*marked\b", "Coop Marked"),
    (r"\bcoop\b", "Coop"),
]
PATTERNS = [(re.compile(pattern, re.I), name) for pattern, name in CHAINS]

def identify(tags):
    value = " ".join(tags.get(k, "") for k in ("brand", "name", "operator"))
    for pattern, name in PATTERNS:
        if pattern.search(value):
            return name
    return None

class StoreHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.stores = {}

    def record(self, kind, obj, lat, lon):
        if obj.tags.get("shop") not in ("supermarket", "convenience", "grocery", "variety", "department_store", "discount", "general"):
            return
        chain = identify(obj.tags)
        if not chain or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return
        sid = f"{kind}-{obj.id}"
        self.stores[sid] = {
            "id": sid,
            "name": obj.tags.get("name") or chain,
            "chain": chain,
            "latitude": round(lat, 7),
            "longitude": round(lon, 7),
        }

    def node(self, obj):
        if obj.location.valid():
            self.record("node", obj, obj.location.lat, obj.location.lon)

    def way(self, obj):
        coords = [(n.location.lat, n.location.lon) for n in obj.nodes if n.location.valid()]
        if coords:
            self.record("way", obj, sum(x for x, _ in coords) / len(coords),
                        sum(y for _, y in coords) / len(coords))

def download_file(url, filename):
    # Behold nedlastede bytes etter 503, timeout eller tilkoblingsbrudd.
    # HTTP Range brukes til å fortsette i stedet for å laste hele PBF-filen på nytt.
    max_attempts = 6
    for attempt in range(1, max_attempts + 1):
        existing = os.path.getsize(filename) if os.path.exists(filename) else 0
        headers = {"User-Agent": "LettHandel-store-updater/1.0", "Accept-Encoding": "identity"}
        if existing:
            headers["Range"] = f"bytes={existing}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            print(f"Laster ned {url} (forsøk {attempt}/{max_attempts}, {existing / 1048576:.1f} MiB lagret)", flush=True)
            with urllib.request.urlopen(request, timeout=90) as response:
                status = response.status
                content_range = response.headers.get("Content-Range", "")
                if status == 206 and existing and content_range.startswith(f"bytes {existing}-"):
                    mode = "ab"
                elif status == 200:
                    mode = "wb"  # Serveren ignorerte Range: start på nytt.
                else:
                    raise RuntimeError(f"Uventet HTTP-status eller Content-Range: {status} {content_range}")
                with open(filename, mode) as target:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        target.write(chunk)
                actual = os.path.getsize(filename)
                if status == 206:
                    total = response.headers.get("Content-Range", "").split("/")[-1]
                    if total.isdigit() and actual != int(total):
                        raise IOError(f"Ufullstendig fil: {actual} av {total} bytes")
                else:
                    length = response.headers.get("Content-Length")
                    if length and length.isdigit() and actual != int(length):
                        raise IOError(f"Ufullstendig fil: {actual} av {length} bytes")
                print(f"Nedlasting ferdig: {actual / 1048576:.1f} MiB", flush=True)
                return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError, OSError, RuntimeError) as exc:
            if attempt == max_attempts:
                raise RuntimeError(f"Nedlasting feilet etter {max_attempts} forsøk fra {url}: {exc}") from exc
            delay = min(8 * attempt, 40)
            print(f"Nedlasting avbrutt ({exc}); prøver igjen om {delay} s.", flush=True)
            time.sleep(delay)

def main():
    with tempfile.TemporaryDirectory() as directory:
        filename = os.path.join(directory, "norway.osm.pbf")
        handler = StoreHandler()
        try:
            download_file(SOURCE, filename)
            handler.apply_file(filename, locations=True)
        except Exception as exc:
            print(f"Landsfilen kunne ikke lastes/behandles ({exc}). Prøver alle fem regioner.", flush=True)
            handler = StoreHandler()
            # Alle regionene må lykkes før eksisterende butikkdata kan overskrives.
            for url in REGION_SOURCES:
                if os.path.exists(filename):
                    os.remove(filename)
                try:
                    download_file(url, filename)
                    handler.apply_file(filename, locations=True)
                except Exception as region_exc:
                    raise RuntimeError(f"Regional nedlasting/behandling feilet for {url}: {region_exc}") from region_exc

        stores = sorted(handler.stores.values(), key=lambda item: item["id"])
        print(f"Fant {len(stores)} kjedebutikker", flush=True)
        if len(stores) < 300:
            raise RuntimeError("For få butikker; eksisterende data beholdes")
        path = Path("data/stores.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": "OpenStreetMap contributors via Geofabrik",
            "stores": stores,
        }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(path)
        print(f"Skrev {path}", flush=True)

if __name__ == "__main__":
    main()
