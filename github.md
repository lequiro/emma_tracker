repo: lequiro/emma_tracker
branch: main

## Last sync
date: 2026-08-31T04:34:08Z

### Updated in this project
- Read the live app (index.html, manifest.json, service-worker.js) at tree 2fecd0d
- Rewrote the app as a Vite + React PWA under `app/`, Modernist styling
- Wrote a v2 Apps Script backend that adds the new Sheet columns non-destructively
- Generated new app icons (192 / 512 / 512 maskable) from the baby-face mark

## Screen map
| Screen / file | Built from |
| --- | --- |
| Emma Tracker.dc.html (mockup) | index.html |
| app/src/App.jsx | index.html (toggle, registrarRapido, pintarUltimos, resincronizar) |
| app/src/api.js | index.html (llamar, consultar, cola offline) |
| app/public/service-worker.js | service-worker.js |
| app/public/manifest.json | manifest.json |
| apps-script/Codigo.gs | inferred from the client's request/response shapes |
