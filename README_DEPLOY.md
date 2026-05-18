# Deploy v57-geprüft

Dieses Paket ist der geprüfte Neustand für GitHub + Vercel + Android-App.

## Nicht mischen

Nicht über alte Dateien mischen. Entweder ein neues GitHub-Repository erstellen oder im alten Repository zuerst alte doppelte Dateien löschen.

## Muss enthalten bleiben

- `.github/workflows/build-wunschportal-android.yml`
- `android-wunschportal/`
- `api/`
- `assets/`
- `index.html`
- `planer.html`
- `haus.html`
- `organisation-admin.html`
- `wunschportal.html`
- `.vercelignore`

## Darf nicht mehr enthalten sein

- `vercel.json`
- alte Einzel-Seiten wie `azoren.html`, `bali.html`, `capri.html`, `delos.html`
- alte doppelte Seiten wie `nachtwache.html`, `pikett.html`, `hausdienstplan.html`, `monatsabschluss.html`, `zeiterfassung.html`
- `tools/`
- `README_REPARATUR_*.md`

## Vercel Environment Variables

Mindestens nötig:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ULMIPOINT_ORG_ADMIN_PASSWORD`

Optional:

- `ULMIPOINT_STORE_ID`

## Nach dem Deploy prüfen

1. `/deploy-check.html` öffnen
2. `/index.html` öffnen
3. `/organisation-admin.html` öffnen und Organisation nur laden
4. `/planer.html?site=haus_1` öffnen
5. Erst speichern, wenn die Struktur sichtbar ist
