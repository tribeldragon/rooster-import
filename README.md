# Rooster Import

Upload een screenshot van je weekrooster, controleer wat eruit gelezen wordt, en zet de
shifts in een Google Agenda naar keuze.

- **OCR in de browser** (Tesseract.js, Nederlands + Engels) — er gaat geen screenshot naar een server.
- **Eén afspraak per shift**, met de activiteiten (Voice, Admin Klant, Lunch, Chat, Coaching, …)
  en een tijdsverdeling in de omschrijving.
- **Opnieuw importeren is veilig**: elke shift krijgt een vast event-ID
  (`rooster<jjjjmmdd>t<uumm>`), dus een tweede import werkt de bestaande afspraak bij in plaats
  van een dubbele aan te maken.

## Starten

```bash
npm install        # kopieert ook de Tesseract-worker/wasm en haalt de taalbestanden op
npm run dev        # http://localhost:5173
```

`npm install` draait `scripts/prepare-assets.mjs`: die zet de Tesseract-worker en de wasm-core
uit `node_modules` in `public/tesseract/` en downloadt `nld` + `eng` taaldata (~21 MB) naar
`public/tessdata/`. Daardoor draait de OCR volledig lokaal, zonder CDN. Mislukt het downloaden,
dan valt de app terug op de CDN van tesseract.js; `npm run prepare-assets` probeert het opnieuw.
Beide mappen staan in `.gitignore`.

## Google OAuth instellen (eenmalig)

De console heet tegenwoordig **Google Auth Platform** (het oude *APIs & Services → OAuth consent
screen* wijst daarheen door).

1. [console.cloud.google.com](https://console.cloud.google.com/) → maak of kies een project
   (projectkiezer bovenin).
2. **APIs & Services → Library** → zoek *Google Calendar API* → **Enable**.
3. **Google Auth Platform → Branding**: app-naam en support-e-mail invullen (eenmalige registratie).
4. **Google Auth Platform → Audience**: User type **External**. Zolang de app op *Testing* staat,
   voeg je bij **Test users** je eigen Google-account toe — anders krijg je bij het inloggen
   "app is blocked" of "has not completed verification".
5. **Google Auth Platform → Clients → Create client**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `http://localhost:5173`
   - Redirect URI's zijn niet nodig (de app gebruikt de token-flow van Google Identity Services).
6. Kopieer de **Client ID** (eindigt op `.apps.googleusercontent.com`) naar `.env`:

   ```
   VITE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
   ```

   Daarna `npm run dev` herstarten — Vite leest `.env` alleen bij het starten.

De **client secret** van datzelfde scherm heb je niet nodig en hoort hier ook niet: alles wat in
`VITE_*` staat komt in de browserbundel terecht. Een client ID is publiek bedoeld; Google beveiligt
hem via de toegestane JavaScript-origin.

Gebruikte scopes: `calendar.readonly` (lijst met agenda's ophalen) en `calendar.events`
(afspraken aanmaken/bijwerken). De token blijft in het geheugen van het tabblad; er wordt niets
op een server opgeslagen.

## Hoe het parsen werkt

`src/lib/ocr.ts`
: Zet de screenshot om naar grijswaarden, rekt het contrast op en schaalt naar ~2600 px breed —
  zonder die stap leest Tesseract de kleine tabeltekst slecht. Daarna twee OCR-passes: één over
  de hele tabel (activiteiten) en één over alleen de linkerkolom (datums), die los veel beter leest.

`src/lib/parse.ts`
: Pure functies, zonder browser-API's, dus testbaar in Node.
  - Kolomgrens wordt bepaald door de kop **Activiteiten** te zoeken.
  - Datums: fuzzy match op Nederlandse dag- en maandnamen; omdat de rijen opeenvolgende dagen
    zijn, wordt één betrouwbare datum gebruikt als anker voor de hele week. `&` → `8`, `S` → `5` enz.
  - Shifts: activiteiten binnen een dag sluiten op elkaar aan, dus een nieuwe keten = een nieuwe
    dag. Elke keten wordt gekoppeld aan het datumlabel dat binnen zijn verticale bereik valt.
  - Shifttijd komt uit de activiteiten (eerste start, laatste eind), niet uit de linkerkolom —
    die leest slechter. Wijkt de linkerkolom af, dan verschijnt er een waarschuwing.
  - Tijden die niet aansluiten worden gecorrigeerd en met `*` gemarkeerd.

Alles is te corrigeren in de reviewtabel voordat er iets naar Google gaat: per rij de datum en
tijden aanpassen, een rij uitvinken, of hem met ✕ uit de lijst gooien. **Tabel leegmaken** wist de
hele lijst; daarna sleep je gewoon de volgende screenshot erin. Een nieuwe screenshot vervangt de
lijst.

De Google-sessie blijft daarbij staan. Na één keer toestemming geven haalt de app bij een volgend
bezoek stil een nieuwe token op (`prompt: ''`), dus na herladen hoef je niet opnieuw in te loggen —
tot je op **Uitloggen** klikt, dan wordt de token ingetrokken. Verloopt de token midden in een
import, dan vraagt de app er eenmalig een nieuwe en gaat verder.

## Tests

```bash
npm run test:parser
```

Draait de parser op echte OCR-output van `samples/week-2026-09-07.png` (opgeslagen in
`scripts/fixture.json`) en vergelijkt die met de shifts zoals ze in die screenshot staan.
Nieuwe fixture nodig na een layoutwijziging? Zie de OCR-instellingen in `src/lib/ocr.ts`
(grijswaarden, contrast 1.4/-40, schaal ~3×) en neem dezelfde voorbewerking over.

## Waar wat staat

```
src/lib/ocr.ts      voorbewerking + Tesseract (browser)
src/lib/parse.ts    pure parser, zonder browser-API's
src/lib/google.ts   OAuth-token + Calendar API
src/App.tsx         upload, reviewtabel, import
scripts/            asset-prep en parsertest + OCR-fixture
samples/            voorbeeldscreenshot waar de test op draait
```

## Bekende beperkingen

- Getest op de Nederlandse roosterweergave met kolommen **Shift** en **Activiteiten**.
- Een dag met een gat tussen activiteiten (geen aansluitende tijden) kan als twee shifts
  verschijnen; corrigeer dat in de tabel of vink er één uit.
- Shifts over middernacht worden ondersteund (eindtijd ≤ starttijd → volgende dag, `+1d`).
