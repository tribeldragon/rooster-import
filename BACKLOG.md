# Backlog

Ideeën die we bewust hebben uitgesteld.

## Apple Agenda via iOS Opdrachten + QR-code

Shifts zonder OAuth of .ics in Apple Agenda zetten. Een eerste versie is gebouwd en weer verwijderd (zie git-historie rond oktober 2026); dit is de opzet:

- Een eenmalig zelfgemaakte Opdracht "Rooster Import" op de iPhone verwerkt JSON:
  `{ events: [{ id, title, start, end, notes, alertMinutes }] }`.
- Knop "Naar Apple Agenda" opent `shortcuts://run-shortcut?name=Rooster%20Import&input=text&text=<JSON>`.
- Vanaf een desktop-browser: toon een QR-code met dezelfde link (npm-pakket `qrcode`), scan met de iPhone-camera.
  - QR-capaciteit is beperkt: compacte payload zonder activiteitenlijst in de notities, foutcorrectie-niveau `L`.
  - Bij te veel shifts: melding om er een paar uit te zetten of per week te splitsen.
- Start/eind als lokale tijd (`YYYY-MM-DDTHH:mm:00`, zonder offset); nachtshifts eindigen de volgende dag.
- Een `rooster-id:` regel in de notities laat de Opdracht bestaande afspraken overslaan (dubbele imports voorkomen).
- Open punten: de Opdracht zelf moet handmatig gemaakt worden (stappen uitleggen in de app), en een iCloud-deellink voor de Opdracht zou de setup eenvoudiger maken.
