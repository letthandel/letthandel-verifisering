# Expo-integrasjon for LettHandel

App-koden ligger fortsatt i Expo Snack. Den er **ikke** publisert i dette offentlige GitHub-repositoriet.

## Endringene som er klargjort
Den oppdaterte App.js-filen er levert separat i samtalen. Den:
- Leser `data/offers.json` fra GitHub via HTTPS
- Kontrollerer gyldighetsdatoer
- Mapper poster til eksisterende `OfferPoster` og `PdfViewer`
- Oppdaterer data når hjemmesiden åpnes og hver time mens den er montert
- Viser ikke gamle hardkodede kampanjer dersom ingen aktive avisdata finnes

## Slik tar du den i bruk
1. Ta en sikkerhetskopi av din eksisterende `App.js` i Expo Snack.
2. Erstatt `App.js` med filen `LettHandel_App_oppdatert.js` som ble levert i samtalen.
3. Behold eksisterende `firebase.js` og øvrige Expo-avhengigheter.
4. Test appen. Før godkjente datakilder er satt opp, vil tilbudsseksjonene være tomme.
5. Legg inn en godkjent JSON-feed i `sources.json` og start arbeidsflyten manuelt under Actions.

**Viktig:** Ingen butikkilder er ennå koblet til. GitHub Actions er bare grunnlaget for automatisk innhenting. For ekte ukentlige plakater må det først finnes verifiserte, lovlige kilder. Ingen Firebase-administratortilgang skal legges i kildekoden.
