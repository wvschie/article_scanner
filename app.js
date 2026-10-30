/* Artikel Scanner — barcode scannen, aantal en naam invullen, lijst delen als Excel.
   Alles draait in de browser: geen server, geen netwerk tijdens gebruik. */
(function () {
  'use strict';

  var FORMATS = ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'ITF', 'EAN13', 'Aztec', 'PDF417'];
  var STORAGE_KEY = 'artikel-scanner:items:v2';
  var LEGACY_KEY = 'serial-scanner:list:v1';
  var NAMES_KEY = 'artikel-scanner:namen:v1';
  var DECODE_INTERVAL_MS = 160;   // ~6 pogingen per seconde
  var REPEAT_IGNORE_MS = 2500;    // zelfde code voor de lens = één scan
  var MAX_DECODE_WIDTH = 1400;    // maximale breedte die naar de decoder gaat

  var el = {
    camera: document.getElementById('cameraBox'),
    video: document.getElementById('video'),
    flash: document.getElementById('flash'),
    idleText: document.getElementById('idleText'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    status: document.getElementById('status'),
    manualForm: document.getElementById('manualForm'),
    manualInput: document.getElementById('manualInput'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    count: document.getElementById('count'),
    shareBtn: document.getElementById('shareBtn'),
    clearBtn: document.getElementById('clearBtn'),
    toast: document.getElementById('toast'),
    backdrop: document.getElementById('sheetBackdrop'),
    entryForm: document.getElementById('entryForm'),
    entryTitle: document.getElementById('entryTitle'),
    entryCode: document.getElementById('entryCode'),
    entryName: document.getElementById('entryName'),
    entryQty: document.getElementById('entryQty'),
    entryCancel: document.getElementById('entryCancel'),
    qtyMinus: document.getElementById('qtyMinus'),
    qtyPlus: document.getElementById('qtyPlus'),
    knownNames: document.getElementById('knownNames'),
    debugFile: document.getElementById('debugFile')
  };

  var items = load();
  var names = loadNames();
  var editing = null;             // artikelnummer dat nu in het venster staat
  var stream = null;
  var scanning = false;
  var decodeTimer = null;
  var busy = false;
  var lastHit = { text: '', at: 0 };
  var wakeLock = null;
  var audioCtx = null;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  /* ---------- decoder ---------- */

  ZXingWASM.prepareZXingModule({
    overrides: {
      locateFile: function (path, prefix) {
        if (path.slice(-5) === '.wasm') {
          return new URL('./vendor/zxing_reader.wasm', document.baseURI).href;
        }
        return prefix + path;
      }
    }
  });

  function decode(imageData) {
    return ZXingWASM.readBarcodes(imageData, {
      formats: FORMATS,
      tryHarder: true,
      maxNumberOfSymbols: 1
    });
  }

  /* ---------- opslag ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
      // Lijst uit een oudere versie overnemen.
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        var old = JSON.parse(legacy);
        if (Array.isArray(old)) {
          return old.map(function (entry) {
            return { code: entry.value || '', name: '', qty: 1, at: entry.at || Date.now() };
          }).filter(function (entry) { return entry.code; });
        }
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      toast('Kon de lijst niet opslaan op dit apparaat', 'warn');
    }
  }

  function loadNames() {
    try {
      var raw = localStorage.getItem(NAMES_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function rememberName(code, name) {
    if (!name) return;
    names[code] = name;
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    } catch (err) { /* onthouden is extra, niet noodzakelijk */ }
  }

  function fillKnownNames() {
    var unique = {};
    Object.keys(names).forEach(function (code) { unique[names[code]] = true; });
    items.forEach(function (item) { if (item.name) unique[item.name] = true; });
    el.knownNames.textContent = '';
    Object.keys(unique).forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      el.knownNames.append(option);
    });
  }

  /* ---------- lijst ---------- */

  function find(code) {
    return items.find(function (item) { return item.code === code; });
  }

  function remove(code) {
    items = items.filter(function (item) { return item.code !== code; });
    save();
    render();
  }

  function totalPieces() {
    return items.reduce(function (sum, item) { return sum + (Number(item.qty) || 0); }, 0);
  }

  function render(highlight) {
    el.list.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      if (item.code === highlight) li.className = 'new';

      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'row-main';
      main.title = 'Tik om aan te passen';

      var code = document.createElement('span');
      code.className = 'serial';
      code.textContent = item.code;

      var name = document.createElement('span');
      name.className = 'row-name' + (item.name ? '' : ' missing');
      name.textContent = item.name || 'geen naam';

      main.append(code, name);
      main.addEventListener('click', function () { openEntry(item, 'edit'); });

      var qty = document.createElement('span');
      qty.className = 'qty';
      qty.textContent = String(item.qty);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.setAttribute('aria-label', item.code + ' verwijderen');
      del.textContent = '×';
      del.addEventListener('click', function () { remove(item.code); });

      li.append(main, qty, del);
      el.list.append(li);
    });

    el.count.textContent = String(items.length);
    el.empty.classList.toggle('hidden', items.length > 0);
    el.shareBtn.disabled = items.length === 0;
    el.clearBtn.disabled = items.length === 0;
    fillKnownNames();
  }

  /* ---------- invulvenster ---------- */

  function openEntry(prefill, mode) {
    editing = mode === 'edit' ? prefill.code : null;
    el.entryTitle.textContent = mode === 'edit' ? 'Artikel aanpassen' : 'Artikel toevoegen';
    el.entryCode.value = prefill.code || '';
    el.entryName.value = prefill.name || names[prefill.code] || '';
    el.entryQty.value = String(prefill.qty || 1);
    el.backdrop.classList.remove('hidden');

    // Meteen naar het veld dat nog leeg is.
    var target = el.entryName.value ? el.entryQty : el.entryName;
    try { target.focus({ preventScroll: true }); target.select && target.select(); } catch (err) { /* iOS opent het toetsenbord pas bij een tik */ }
  }

  function closeEntry() {
    el.backdrop.classList.add('hidden');
    editing = null;
    lastHit = { text: '', at: Date.now() };   // niet meteen opnieuw op dezelfde code springen
  }

  function entryOpen() {
    return !el.backdrop.classList.contains('hidden');
  }

  function saveEntry(event) {
    event.preventDefault();
    var code = el.entryCode.value.trim();
    var name = el.entryName.value.trim();
    var qty = Math.max(1, Math.round(Number(el.entryQty.value) || 1));

    if (!code) {
      toast('Vul een artikelnummer in', 'warn');
      el.entryCode.focus();
      return;
    }

    var clash = find(code);
    if (clash && clash.code !== editing) {
      toast('Dit artikelnummer staat al in de lijst', 'warn');
      return;
    }

    if (editing) {
      var item = find(editing);
      if (item) {
        item.code = code;
        item.name = name;
        item.qty = qty;
      }
    } else {
      items.unshift({ code: code, name: name, qty: qty, at: Date.now() });
    }

    rememberName(code, name);
    save();
    render(code);
    closeEntry();
    el.status.textContent = code + (name ? ' — ' + name : '') + ' — ' + qty + ' stuks';
  }

  /* ---------- meldingen ---------- */

  function toast(message, kind) {
    el.toast.textContent = message;
    el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.className = 'toast'; }, 1800);
  }

  function beep() {
    try {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1120;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (err) { /* geluid is meegenomen, niet nodig */ }
  }

  function flash() {
    el.flash.classList.remove('on');
    void el.flash.offsetWidth;
    el.flash.classList.add('on');
  }

  /* ---------- camera ---------- */

  async function start() {
    if (scanning) return;
    el.startBtn.disabled = true;
    el.status.textContent = 'Camera starten…';

    // In de tik aangemaakt, anders laat iOS later geen geluid toe.
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (err) { /* zonder geluid verder */ }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
    } catch (err) {
      el.startBtn.disabled = false;
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        el.idleText.textContent =
          'Camera geblokkeerd. In Safari: aA-menu → Website-instellingen → Camera → Sta toe, ' +
          'daarna de pagina herladen. Je kunt artikelnummers ook hieronder intypen.';
        el.status.textContent = 'Geen toestemming voor de camera.';
      } else if (err && err.name === 'NotFoundError') {
        el.idleText.textContent = 'Geen camera op dit apparaat. Typ artikelnummers hieronder in.';
        el.status.textContent = 'Geen camera beschikbaar.';
      } else {
        el.idleText.textContent = 'Camera start niet: ' + (err && err.name ? err.name : 'onbekende fout');
        el.status.textContent = 'Camerafout.';
      }
      return;
    }

    el.video.srcObject = stream;
    try { await el.video.play(); } catch (err) { /* het autoplay-attribuut vangt dit op */ }

    scanning = true;
    el.startBtn.disabled = false;
    el.camera.classList.add('live');
    el.stopBtn.classList.remove('hidden');
    el.status.textContent = 'Houd de barcode in het kader.';
    requestWakeLock();
    tick();
  }

  function stop() {
    scanning = false;
    clearTimeout(decodeTimer);
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    el.video.srcObject = null;
    el.camera.classList.remove('live');
    el.stopBtn.classList.add('hidden');
    el.status.textContent = 'Camera uit.';
    releaseWakeLock();
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { /* optioneel */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  /* Alleen het deel van het beeld dat binnen het kader op het scherm valt. */
  function grabFrame() {
    var video = el.video;
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh) return null;

    var box = video.getBoundingClientRect();
    var scale = Math.max(box.width / vw, box.height / vh) || 1;   // object-fit: cover
    var visibleW = Math.min(vw, box.width / scale);
    var visibleH = Math.min(vh, box.height / scale);
    var originX = (vw - visibleW) / 2;
    var originY = (vh - visibleH) / 2;

    // Komt overeen met .frame in styles.css (links 7,5%, boven 22,5%, 85% x 55%).
    var sx = originX + visibleW * 0.075;
    var sy = originY + visibleH * 0.225;
    var sw = visibleW * 0.85;
    var sh = visibleH * 0.55;

    var ratio = Math.min(1, MAX_DECODE_WIDTH / sw);
    canvas.width = Math.max(1, Math.round(sw * ratio));
    canvas.height = Math.max(1, Math.round(sh * ratio));
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  async function tick() {
    if (!scanning) return;
    if (!busy && !entryOpen() && document.visibilityState === 'visible') {
      busy = true;
      try {
        var frame = grabFrame();
        if (frame) handle(await decode(frame));
      } catch (err) {
        el.status.textContent = 'Probleem met de decoder: ' + (err && err.message ? err.message : err);
      } finally {
        busy = false;
      }
    }
    decodeTimer = setTimeout(tick, DECODE_INTERVAL_MS);
  }

  function handle(results) {
    if (!results || !results.length) return;
    var hit = results.find(function (r) { return r.text && r.isValid !== false; });
    if (!hit) return;

    var now = Date.now();
    if (hit.text === lastHit.text && now - lastHit.at < REPEAT_IGNORE_MS) return;
    lastHit = { text: hit.text, at: now };

    flash();
    beep();

    var existing = find(hit.text);
    if (existing) {
      el.status.textContent = hit.text + ' staat al in de lijst — aantal aanpassen.';
      openEntry(existing, 'edit');
    } else {
      el.status.textContent = 'Gescand: ' + hit.text + ' (' + hit.format + ')';
      openEntry({ code: hit.text, name: names[hit.text] || '', qty: 1 }, 'new');
    }
  }

  /* ---------- delen ---------- */

  function stamp() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(now.getDate()) + '-' + pad(now.getMonth() + 1) + '-' + now.getFullYear();
  }

  function rows() {
    // Oudste scan eerst, net als de volgorde waarin je loopt.
    return items.slice().reverse().map(function (item) {
      return [item.code, item.name || '', Number(item.qty) || 0];
    });
  }

  function workbook() {
    return window.buildXlsx({
      sheetName: 'Artikelen',
      headers: ['Art nummer', 'Art naam', 'Aantal'],
      rows: rows(),
      widths: [22, 34, 10]
    });
  }

  function plainText() {
    var date = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
    var header = 'Scan ' + date + ' — ' + items.length +
      (items.length === 1 ? ' artikel' : ' artikelen') + ', ' + totalPieces() + ' stuks';
    var lines = rows().map(function (row) {
      return row[0] + (row[1] ? ' — ' + row[1] : '') + ' — ' + row[2] + 'x';
    });
    return header + '\n' + lines.join('\n');
  }

  function download(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function share() {
    if (!items.length) return;
    var filename = 'Artikelen ' + stamp() + '.xlsx';
    var file;
    try {
      file = new File([workbook()], filename, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    } catch (err) {
      file = null;
    }

    // 1. Excel-bestand via het deelvenster — de normale weg op de iPhone.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;   // deelvenster gesloten
      }
    }

    // 2. Wel een deelvenster, maar geen bestanden: dan de lijst als tekst.
    var text = plainText();
    if (navigator.share) {
      try {
        await navigator.share({ text: text });
        toast('Excel delen kan hier niet — lijst als tekst verstuurd', 'warn');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    // 3. Geen deelvenster (meestal een computer): bestand opslaan.
    if (file && download(file, filename)) {
      toast('Excel-bestand opgeslagen');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Lijst gekopieerd naar het klembord');
    } catch (err) {
      toast('Delen en kopiëren lukt niet op dit apparaat', 'error');
    }
  }

  /* ---------- koppelen ---------- */

  el.startBtn.addEventListener('click', start);
  el.stopBtn.addEventListener('click', stop);
  el.shareBtn.addEventListener('click', share);
  el.entryForm.addEventListener('submit', saveEntry);
  el.entryCancel.addEventListener('click', closeEntry);

  el.backdrop.addEventListener('click', function (event) {
    if (event.target === el.backdrop) closeEntry();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && entryOpen()) closeEntry();
  });

  function bumpQty(delta) {
    var next = Math.max(1, Math.round(Number(el.entryQty.value) || 1) + delta);
    el.entryQty.value = String(next);
  }
  el.qtyMinus.addEventListener('click', function () { bumpQty(-1); });
  el.qtyPlus.addEventListener('click', function () { bumpQty(1); });

  el.clearBtn.addEventListener('click', function () {
    if (!items.length) return;
    if (!confirm('Alle ' + items.length + ' artikelen verwijderen?')) return;
    items = [];
    save();
    render();
    toast('Lijst gewist');
  });

  el.manualForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var code = el.manualInput.value.trim();
    if (!code) return;
    var existing = find(code);
    if (existing) {
      toast('Staat al in de lijst — aantal aanpassen', 'warn');
      openEntry(existing, 'edit');
    } else {
      openEntry({ code: code, name: names[code] || '', qty: 1 }, 'new');
    }
    el.manualInput.value = '';
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && scanning) requestWakeLock();
  });

  window.addEventListener('pagehide', function () {
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is meegenomen */ });
    });
  }

  /* Afbeelding door dezelfde decoder halen — testen zonder camera: ?debug=1 */
  if (new URLSearchParams(location.search).has('debug')) {
    el.debugFile.classList.remove('hidden');
    el.debugFile.addEventListener('change', async function () {
      var file = el.debugFile.files && el.debugFile.files[0];
      if (!file) return;
      try {
        var bitmap = await createImageBitmap(file);
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        ctx.drawImage(bitmap, 0, 0);
        var results = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
        lastHit = { text: '', at: 0 };
        if (results && results.length) {
          handle(results);
        } else {
          el.status.textContent = 'Geen barcode gevonden in die afbeelding.';
        }
      } catch (err) {
        el.status.textContent = 'Afbeelding lezen mislukt: ' + err;
      }
    });
  }

  render();
})();
