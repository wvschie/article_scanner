/* Serial Scanner — camera barcode capture, list, share. No backend, no network at runtime. */
(function () {
  'use strict';

  var FORMATS = ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'ITF', 'EAN13', 'Aztec', 'PDF417'];
  var STORAGE_KEY = 'serial-scanner:list:v1';
  var DECODE_INTERVAL_MS = 160;   // ~6 attempts per second
  var REPEAT_IGNORE_MS = 2500;    // same code in front of the lens = one scan
  var MAX_DECODE_WIDTH = 1400;    // cap the pixels handed to the decoder

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
    debugFile: document.getElementById('debugFile')
  };

  var items = load();
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

  /* ---------- storage ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      toast('Could not save the list on this device', 'warn');
    }
  }

  /* ---------- list ---------- */

  function has(value) {
    return items.some(function (item) { return item.value === value; });
  }

  function add(value, source) {
    value = (value || '').trim();
    if (!value) return false;
    if (has(value)) {
      toast('Already in the list', 'warn');
      return false;
    }
    items.unshift({ value: value, at: Date.now(), source: source || 'scan' });
    save();
    render(value);
    return true;
  }

  function remove(value) {
    items = items.filter(function (item) { return item.value !== value; });
    save();
    render();
  }

  function time(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function render(highlight) {
    el.list.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      if (item.value === highlight) li.className = 'new';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'serial';
      btn.textContent = item.value;
      btn.title = 'Tap to edit';
      btn.addEventListener('click', function () { edit(li, item); });

      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = time(item.at);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.setAttribute('aria-label', 'Remove ' + item.value);
      del.textContent = '×';
      del.addEventListener('click', function () { remove(item.value); });

      li.append(btn, meta, del);
      el.list.append(li);
    });

    el.count.textContent = String(items.length);
    el.empty.classList.toggle('hidden', items.length > 0);
    el.shareBtn.disabled = items.length === 0;
    el.clearBtn.disabled = items.length === 0;
  }

  function edit(li, item) {
    var input = document.createElement('input');
    input.className = 'serial';
    input.value = item.value;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    li.replaceChild(input, li.firstChild);
    input.focus();
    input.select();

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      var next = input.value.trim();
      if (next && next !== item.value && has(next)) {
        toast('Already in the list', 'warn');
      } else if (next) {
        item.value = next;
        save();
      }
      render();
    }
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { done = true; render(); }
    });
  }

  /* ---------- feedback ---------- */

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
    } catch (err) { /* sound is a nicety */ }
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
    el.status.textContent = 'Starting camera…';

    // Created inside the tap so iOS lets it make sound later.
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (err) { /* no audio, carry on */ }

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
          'Camera blocked. In Safari: aA menu → Website Settings → Camera → Allow, then reload. ' +
          'You can still add serials by hand below.';
        el.status.textContent = 'Camera permission denied.';
      } else if (err && err.name === 'NotFoundError') {
        el.idleText.textContent = 'No camera found on this device. Add serials by hand below.';
        el.status.textContent = 'No camera available.';
      } else {
        el.idleText.textContent = 'Camera could not start: ' + (err && err.name ? err.name : 'unknown error');
        el.status.textContent = 'Camera error.';
      }
      return;
    }

    el.video.srcObject = stream;
    try { await el.video.play(); } catch (err) { /* autoplay attribute covers this */ }

    scanning = true;
    el.startBtn.disabled = false;
    el.camera.classList.add('live');
    el.stopBtn.classList.remove('hidden');
    el.status.textContent = 'Hold the barcode inside the frame.';
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
    el.status.textContent = 'Camera off.';
    releaseWakeLock();
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { /* optional */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  /* Region of interest: the part of the source frame sitting inside the on-screen guide. */
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

    // Matches .frame in styles.css (left 7.5%, top 22.5%, 85% x 55%).
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
    if (!busy && document.visibilityState === 'visible') {
      busy = true;
      try {
        var frame = grabFrame();
        if (frame) handle(await decode(frame));
      } catch (err) {
        el.status.textContent = 'Decoder problem: ' + (err && err.message ? err.message : err);
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

    if (add(hit.text, hit.format)) {
      flash();
      beep();
      el.status.textContent = 'Added ' + hit.text + ' (' + hit.format + ')';
    }
  }

  /* ---------- share ---------- */

  function buildText() {
    var date = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    var header = 'Scan ' + date + ' — ' + items.length + ' item' + (items.length === 1 ? '' : 's');
    var lines = items.slice().reverse().map(function (item) { return item.value; });
    return header + '\n' + lines.join('\n');
  }

  async function share() {
    if (!items.length) return;
    var text = buildText();

    if (navigator.share) {
      try {
        await navigator.share({ text: text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;   // user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (err) {
      toast('Could not share or copy on this device', 'error');
    }
  }

  /* ---------- wiring ---------- */

  el.startBtn.addEventListener('click', start);
  el.stopBtn.addEventListener('click', stop);
  el.shareBtn.addEventListener('click', share);

  el.clearBtn.addEventListener('click', function () {
    if (!items.length) return;
    if (!confirm('Delete all ' + items.length + ' serials?')) return;
    items = [];
    save();
    render();
    toast('List cleared');
  });

  el.manualForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (add(el.manualInput.value, 'manual')) {
      el.manualInput.value = '';
      el.status.textContent = 'Added by hand.';
    }
    el.manualInput.focus();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && scanning) requestWakeLock();
  });

  window.addEventListener('pagehide', function () {
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is a bonus */ });
    });
  }

  /* Decode an image file through the same path — for testing without a camera: ?debug=1 */
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
          el.status.textContent = 'No barcode found in that image.';
        }
      } catch (err) {
        el.status.textContent = 'Image decode failed: ' + err;
      }
    });
  }

  render();
})();
