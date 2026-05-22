# ULMIPOINT v108 Organisation GET-Laden

Ersetzt nur:

- `api/org-structure.js`

## Repariert

Der Planer lädt die Organisation aktuell über:

- `GET /api/org-structure`

Bisher hat die API aber nur `POST` erlaubt. Dadurch konnte die Startseite die Gruppen nicht sehen, obwohl sie in der Organisation vorhanden waren.

Mit v108 gilt:

- `GET /api/org-structure` lädt die Organisation
- `POST /api/org-structure` bleibt wie bisher für Laden/Speichern
- Es werden weiterhin keine Gruppen automatisch erzeugt

## Nach Upload

1. Vercel Deploy abwarten
2. Planer neu laden
3. Haus öffnen
4. Bereiche sollten aus der Organisation erscheinen
