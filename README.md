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
npm install
npm run dev        # http://localhost:5173
```

De eerste OCR-run downloadt de taalbestanden (~15 MB). Die worden in de browser gecachet.

## Google OAuth instellen (eenmalig)

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com/) en maak een project.
2. **APIs & Services → Library** → zoek *Google Calendar API* → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → vul naam/e-mail in.
   Voeg bij **Test users** je eigen Google-account toe (zolang de app in testmodus staat).
   Scopes hoef je hier niet vooraf toe te voegen.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `http://localhost:5173`
   - Redirect URI's zijn niet nodig (de app gebruikt de token-flow van Google Identity Services).
5. Kopieer de client ID in de app onder **Instellingen**, of zet hem in een `.env`-bestand:

   ```
   VITE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
   ```

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

Alles is te corrigeren in de reviewtabel voordat er iets naar Google gaat.

## Tests

```bash
npm run test:parser
```

Draait de parser op echte OCR-output van `samples/week-2026-09-07.png` (opgeslagen in
`scripts/fixture.json`) en vergelijkt die met de shifts zoals ze in die screenshot staan.
Nieuwe fixture nodig na een layoutwijziging? Zie de OCR-instellingen in `src/lib/ocr.ts`
(grijswaarden, contrast 1.4/-40, schaal ~3×) en neem dezelfde voorbewerking over.

## Bekende beperkingen

- Getest op de Nederlandse roosterweergave met kolommen **Shift** en **Activiteiten**.
- Een dag met een gat tussen activiteiten (geen aansluitende tijden) kan als twee shifts
  verschijnen; corrigeer dat in de tabel of vink er één uit.
- Shifts over middernacht worden ondersteund (eindtijd ≤ starttijd → volgende dag, `+1d`).
