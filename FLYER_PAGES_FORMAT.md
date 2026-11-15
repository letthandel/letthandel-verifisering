# Tilbudsavis med flere sider

Expo-appen kan vise en tilbudsavis direkte i appen når hvert tilbud i `data/offers.json` har et `pages`-felt med direkte HTTPS-bildelenker, i riktig siderekkefølge.

```json
{
  "id": "butikk-uke-xx",
  "chain": "MENY",
  "title": "Kundeavis",
  "imageUrl": "https://example.org/cover.jpg",
  "url": "https://example.org/avis",
  "pages": [
    "https://example.org/page-1.jpg",
    "https://example.org/page-2.jpg"
  ],
  "validFrom": "2026-11-16",
  "validTo": "2026-11-22"
}
```

Eksempellenkene er ikke virkelige. **Ikke legg inn generiske nettsidebilder som avisforsider.** Kontroller at hver kilde er en faktisk avisside, og at bruken er tillatt. Innhentingsskriptet trenger fortsatt en pålitelig bildekilde og må utvides for å fylle `pages` automatisk.
