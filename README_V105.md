# ULMIPOINT v105 Speicherlogik-Unterbau

Dieses Paket trennt Organisation und Gruppendaten.

## Wichtig

Organisation / Häuser bleiben in `api/org-structure.js`.
Gruppendaten werden separat pro `siteId + groupKey` gespeichert.

## Vercel Hobby kompatibel

Die öffentlichen URLs funktionieren:

- `/api/group-state`
- `/api/group-employees`
- `/api/group-plan`
- `/api/group-wishes`

Technisch laufen sie über eine einzelne Function:

- `api/group.js`

Das verhindert, dass der kostenlose Vercel-Hobby-Tarif wegen zu vieler Serverless Functions wieder fehlschlägt.

## Enthalten

- `api/group.js`
- `api/events.js`
- `lib/_group-section.js`
- `vercel.json`

## Nicht enthalten / nicht anfassen

- `organisation-admin.html`
- `api/org-structure.js`
- `planer.html`
- Startseite
- Login
- Nachtwache
- Haus-Pikett
- Haus-Dienstplan
- CSV-Import
- `api/org-users.js`

## Sicherheit

- Leere Überschreibungen werden blockiert, wenn schon Daten vorhanden sind.
- Jeder Speicher-Vorgang schreibt ein Event.
- Vor jedem Überschreiben wird ein Backup im Serverstand abgelegt.
- Alte lokale Daten werden nur als Legacy-Preview angezeigt, nicht automatisch migriert.

## Test nach Upload

Beispiel GET:

`/api/group-state?siteId=riehenstrasse&groupKey=riehenstrasse_delos`

Beispiel POST:

```json
{
  "mode": "save",
  "siteId": "riehenstrasse",
  "groupKey": "riehenstrasse_delos",
  "state": {"test": true}
}
```

Danach prüfen:

`/api/events`
