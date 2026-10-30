# Serial Scanner

Scan serial-number barcodes with the iPhone camera, collect them in a list, share the list to WhatsApp, Mail or anywhere else through the normal iOS share sheet.

Everything runs in the browser on the phone. No account, no server, no data leaves the device.

## Publish it (one time, ~10 minutes)

1. Create a new **public** repo on GitHub, e.g. `serial-scanner`.
2. Upload everything in this folder to the repo root — `index.html` must sit at the top level, not inside a sub-folder.
3. Repo → **Settings** → **Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)` → Save.
4. Wait a minute, then open `https://<your-github-name>.github.io/serial-scanner/` in **Safari** on the iPhone.
5. Share button → **Add to Home Screen**. Use the icon from then on.

The repo holds only the scanner code — no company data, nothing confidential.

## Using it

- **Start scanning** — allow camera access, hold the label inside the frame. A hit flashes green and beeps.
- Scanning the same code twice is ignored; the app says "already in the list".
- **Type a serial by hand** for labels that won't read.
- Tap any serial to correct it; tap × to remove it.
- **Finish & share** opens the iOS share sheet with:
  ```
  Scan 30 Oct 2026 — 12 items
  ABC123456789
  ABC123456790
  ```
- **Clear** empties the list (asks first). Sharing never clears it.
- The list survives locking the phone, closing the app and losing signal.

## Good to know

- Works offline after the first open — including the whole decoder.
- iOS asks for camera permission every launch for home-screen web apps. That's an Apple limitation, not a setting in the app.
- No flashlight control from the browser; use Control Centre if a label is in the dark.
- Needs iOS 16.4 or newer.
- Barcodes read: QR, DataMatrix, Code128, Code39, ITF, EAN-13, Aztec, PDF417. Trimming `FORMATS` at the top of `app.js` to just the type you use makes scanning faster.

## Updating it later

Edit the files, upload them to the repo again, and reopen the app while online — the page, script and styles refresh themselves. If you change anything in `vendor/` or `icons/`, bump `CACHE` in `sw.js` (`serial-scanner-v1` → `-v2`) so phones pick the new files up.

## Testing on a computer

```bash
python3 -m http.server 8777 --directory output/serial-scanner
```

Open `http://localhost:8777` — localhost counts as secure, so the camera works there too.

Add `?debug=1` to the URL for a file picker that runs a barcode *image* through the same decoder, for checking decoding without a camera.

## What's in here

| File | Purpose |
| --- | --- |
| `index.html` | the single page |
| `app.js` | camera, decode loop, list, share |
| `styles.css` | dark UI, large tap targets |
| `sw.js` | offline cache |
| `manifest.webmanifest`, `icons/` | home-screen icon and name |
| `vendor/` | [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 barcode decoder, self-hosted |
