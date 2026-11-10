# Tests

## Automated

```bash
npm install
npm test
```

- `host.test.mjs` registers the host plugin with a mock Cordis context, starts a real HTTP server and exercises the routes with real `fetch` requests.
- `client.test.mjs` stubs the module loader and DOM, imports `client.js`, runs the real `apply()` and renders the slot with `react-dom/server`.

Neither test opens a screen selector or moves the mouse.

## Windows native selector

```powershell
npm run test:native
```

Runs three real Win32 tests and will briefly take over the screen and cursor:

- `win/selector-esc.ps1` — Escape cancels with exit code 2 and no PNG.
- `win/selector-drag.ps1` — real mouse drag produces a non-trivial PNG.
- `win/selector-hide.ps1` — a real foreground window is hidden, the sidecar HWND is recorded, and Escape restores and focuses it.

## Manual DSH UI capture

To test the full DSH UI path, start `drag-external.ps1` first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/win/drag-external.ps1
```

It waits for a freshly started `scissors.exe`, finds its overlay and simulates a real mouse drag. While it waits, open DSH, click the scissors button and choose “截图”. The normal DSH request then returns the captured PNG and inserts the attachment into the composer.
