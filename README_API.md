# ULMIPOINT API-Paket v52

Dieses Paket ist für das Vercel-Hobby-Problem:

> Maximal 12 Serverless Functions

## Enthalten

Echte API-Endpunkte:

- `api/events.js`
- `api/monthly-close.js`
- `api/org-admin-login.js`
- `api/org-structure.js`
- `api/org-users.js`
- `api/time-clock-list.js`
- `api/wunsch-login.js`
- `api/wunsch-plan.js`
- `api/wunsch-save.js`

Hilfsdateien ausserhalb von `/api`:

- `lib/_wishlib.js`
- `lib/_timeClockRules.js`

## Auf GitHub ersetzen / hochladen

Alle Dateien aus diesem ZIP hochladen.

## Danach auf GitHub im Ordner `/api` löschen, falls vorhanden

- `api/_wishlib.js`
- `api/_timeClockRules.js`
- `api/organisation-admin.html`

Diese drei dürfen nicht im API-Ordner bleiben.

## Nicht löschen

Die echten API-Endpunkte oben müssen bleiben.

## Wichtig

Nach dem Upload muss Vercel weniger Functions bauen, weil Hilfsdateien nicht mehr in `/api` liegen.
