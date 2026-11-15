# LettHandel – tilbudsaviser

Dette repositoriet inneholder en **grunnstruktur** for automatisk oppdatering av tilbudsaviser til LettHandel (Expo).

## Status
GitHub Actions kjører daglig kl. 05:17 UTC og kan startes manuelt. Ingen butikkilder er aktivert ennå. `data/offers.json` er derfor tom; vi publiserer ikke oppdiktede tilbud.

## Legg til en godkjent datakilde
Før opp en kilde i `sources.json`:
```json
{"sources":[{"id":"butikk-feed","chain":"MENY","url":"https://example.org/approved-offers.json"}]}
```
URL-en må være en reell, godkjent HTTPS JSON-feed med format:
```json
{"offers":[{"id":"unik-id","chain":"MENY","title":"Ukens tilbud","imageUrl":"https://example.org/cover.jpg","url":"https://example.org/avis","validFrom":"2026-11-16","validTo":"2026-11-22"}]}
```
Ikke bruk eksempellenkene i produksjon. Avklar tilgang og rettigheter til bilder og avisinnhold med kjedene eller leverandøren.

## Expo
Expo kan lese den offentlige JSON-filen:
`https://raw.githubusercontent.com/letthandel/letthandel-verifisering/main/data/offers.json`

Bruk `offers`-arrayen som dynamisk kilde i stedet for den hardkodede `OFFERS`-listen, og behold eksisterende liste som reserve under migreringen. Ingen Firebase-nøkler eller administratorlegitimasjon skal legges i dette offentlige repositoriet.

## Videre
1. Verifiser tillatte kilder fra REMA 1000, KIWI, Coop, MENY og Bunnpris.
2. Koble dem til `sources.json`.
3. Integrer JSON-innhentingen i Expo-appen og test plakatvisningen.
4. Dersom Firebase skal brukes som distribusjonslag, skriv fra en serverjobb med sikret tilgang, ikke fra offentlig kode.
