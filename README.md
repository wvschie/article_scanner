# Artikel Scanner

Scan article barcodes with the iPhone camera, fill in the article name and quantity, and share the list as an Excel file through the normal iOS share sheet.

The interface is in Dutch. Everything runs in the browser on the phone — no account, no server, no data leaves the device.

## Publish it (one time, ~10 minutes)

1. Create a new **public** repo on GitHub, e.g. `artikel-scanner`.
2. Upload everything in this folder to the repo root — `index.html` must sit at the top level, not inside a sub-folder.
3. Repo → **Settings** → **Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)` → Save.
4. Wait a minute, then open `https://<your-github-name>.github.io/artikel-scanner/` in **Safari** on the iPhone.
5. Share button → **Add to Home Screen**. Use the icon from then on.

The repo holds only the scanner code — no company data, nothing confidential.

## Using it

- **Start scannen** — allow camera access, hold the label inside the frame.
- Every hit flashes green, beeps, and opens a dialog with three fields:
  - **Artikelnummer** — filled in from the barcode, editable
  - **Artikelnaam** — free text, with − / + buttons and suggestions from names used before
  - **Aantal** — defaults to 1
- Scanning stops while the dialog is open, so nothing is read behind your back.
- Scanning an article that is already in the list reopens it with its current name and quantity, so you can correct the count instead of getting a duplicate.
- Names are remembered per article number, also across sessions — the second time you scan the same part, the name is already filled in.
- Tap any row to change it, × to remove it.
- **Klaar & delen** opens the iOS share sheet with `Artikelen <date>.xlsx`:

  | Art nummer | Art naam | Aantal |
  | --- | --- | --- |
  | SN-QR-8842001 | Navigatie-unit X200 | 4 |

  Oldest scan first, quantities as real numbers so Excel can sum them.
- **Wissen** empties the list (asks first). Sharing never clears it.
- The list survives locking the phone, closing the app and losing signal.

If a device can't share files, the app falls back to sharing the list as text, and on a computer it saves the Excel file instead.

## Good to know

- Works offline after the first open — including the decoder and the Excel export.
- iOS asks for camera permission every launch for home-screen web apps. That's an Apple limitation, not a setting in the app.
- No flashlight control from the browser; use Control Centre if a label is in the dark.
- Needs iOS 16.4 or newer.
- Barcodes read: QR, DataMatrix, Code128, Code39, ITF, EAN-13, Aztec, PDF417. Trimming `FORMATS` at the top of `app.js` to just the type you use makes scanning faster.

## Updating it later

Edit the files, upload them to the repo again, and reopen the app while online — the page, scripts and styles refresh themselves. If you change anything in `vendor/` or `icons/`, bump `CACHE` in `sw.js` (`artikel-scanner-v2` → `-v3`) so phones pick the new files up.

## Testing on a computer

```bash
python3 -m http.server 8777 --directory output/serial-scanner
```

Open `http://localhost:8777` — localhost counts as secure, so the camera works there too.

Add `?debug=1` to the URL for a file picker that runs a barcode *image* through the same decoder, for checking the flow without a camera.

## What's in here

| File | Purpose |
| --- | --- |
| `index.html` | the single page |
| `app.js` | camera, decode loop, entry dialog, list, share |
| `xlsx.js` | writes the .xlsx file, no libraries |
| `styles.css` | dark UI, large tap targets |
| `sw.js` | offline cache |
| `manifest.webmanifest`, `icons/` | home-screen icon and name |
| `vendor/` | [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 barcode decoder, self-hosted |
