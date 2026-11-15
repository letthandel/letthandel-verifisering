#!/usr/bin/env python3
"""Lag data/stores.json fra Geofabriks norske OpenStreetMap-uttrekk."""
import json
import os
import re
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
import osmium

SOURCE = "https://download.geofabrik.de/europe/norway-latest.osm.pbf"
CHAINS = [
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
        if obj.tags.get("shop") not in ("supermarket", "convenience", "grocery"):
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

def main():
    with tempfile.TemporaryDirectory() as directory:
        filename = os.path.join(directory, "norway.osm.pbf")
        request = urllib.request.Request(SOURCE, headers={"User-Agent": "LettHandel-store-updater/1.0"})
        print(f"Laster ned {SOURCE}", flush=True)
        with urllib.request.urlopen(request, timeout=120) as response, open(filename, "wb") as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
        print(f"Nedlasting ferdig: {os.path.getsize(filename) / 1048576:.1f} MiB", flush=True)
        handler = StoreHandler()
        handler.apply_file(filename, locations=True)
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
