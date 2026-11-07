'use strict';
// Редактор снимков: фигуры, текст, нумерация, размытие, негатив области, обрезка. Отмена/возврат.

(function () {
  const $ = (id) => document.getElementById(id);
  const COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000'];

  const S = {
    api: null, hooks: null,
    base: null,          // canvas с исходным (или обрезанным) изображением
    objects: [],         // нарисованные объекты
    undo: [], redo: [],
    tool: 'arrow', color: '#ef4444', lw: 4, fill: false,
    stepN: 1, cur: null, entry: null, dirty: false, textInput: null
  };

  let canvas, ctx, stage;
  const T = (k, p) => window.I18n.t(k, p);
  function zoomText() {
    $('ed-zoom').textContent = T(stage && stage.classList.contains('full') ? 'ed.zoom.full' : 'ed.zoom.window');
  }

  // ---------- рисование ----------
  function clampRect(o) {
    let x = Math.max(0, Math.floor(o.x)), y = Math.max(0, Math.floor(o.y));
    let w = Math.min(canvas.width - x, Math.ceil(o.w)), h = Math.min(canvas.height - y, Math.ceil(o.h));
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }

  function drawArrow(c, o) {
    const head = Math.max(12, o.lw * 4);
    const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
    const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
    c.strokeStyle = o.color; c.fillStyle = o.color; c.lineWidth = o.lw; c.lineCap = 'round'; c.lineJoin = 'round';
    const bx = o.x2 - Math.cos(ang) * Math.min(head * 0.8, len);
    const by = o.y2 - Math.sin(ang) * Math.min(head * 0.8, len);
    c.beginPath(); c.moveTo(o.x1, o.y1); c.lineTo(bx, by); c.stroke();
    c.beginPath();
    c.moveTo(o.x2, o.y2);
    c.lineTo(o.x2 - head * Math.cos(ang - Math.PI / 7), o.y2 - head * Math.sin(ang - Math.PI / 7));
    c.lineTo(o.x2 - head * Math.cos(ang + Math.PI / 7), o.y2 - head * Math.sin(ang + Math.PI / 7));
    c.closePath(); c.fill();
  }

  function effectBlur(c, o) {
    const r = clampRect(o);
    if (r.w < 2 || r.h < 2) return;
    const tmp = document.createElement('canvas');
    tmp.width = c.canvas.width; tmp.height = c.canvas.height;
    tmp.getContext('2d').drawImage(c.canvas, 0, 0);
    c.save();
    c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    c.filter = 'blur(' + Math.max(6, Math.round(Math.min(r.w, r.h) / 14)) + 'px)';
    c.drawImage(tmp, 0, 0);
    c.restore();
    c.filter = 'none';
  }

  function effectPixel(c, o) {
    const r = clampRect(o);
    if (r.w < 2 || r.h < 2) return;
    const bs = Math.max(6, Math.round(Math.min(r.w, r.h) / 10));
    const sw = Math.max(1, Math.round(r.w / bs)), sh = Math.max(1, Math.round(r.h / bs));
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = true;
    t.drawImage(c.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    c.restore();
  }

  function effectInvert(c, o) {
    const r = clampRect(o);
    if (r.w < 1 || r.h < 1) return;
    const id = c.getImageData(r.x, r.y, r.w, r.h);
    window.InvertCore.invertPixels(id.data, 'full', false);
    c.putImageData(id, r.x, r.y);
  }

  function drawObj(c, o) {
    c.save();
    switch (o.t) {
      case 'line':
        c.strokeStyle = o.color; c.lineWidth = o.lw; c.lineCap = 'round';
        c.beginPath(); c.moveTo(o.x1, o.y1); c.lineTo(o.x2, o.y2); c.stroke();
        break;
      case 'arrow': drawArrow(c, o); break;
      case 'rect': {
        const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1);
        c.lineWidth = o.lw; c.lineJoin = 'round';
        if (o.fill) { c.fillStyle = o.color; c.fillRect(x, y, w, h); }
        else { c.strokeStyle = o.color; c.strokeRect(x, y, w, h); }
        break;
      }
      case 'ellipse': {
        const cx = (o.x1 + o.x2) / 2, cy = (o.y1 + o.y2) / 2, rx = Math.abs(o.x2 - o.x1) / 2, ry = Math.abs(o.y2 - o.y1) / 2;
        c.lineWidth = o.lw; c.beginPath(); c.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
        if (o.fill) { c.fillStyle = o.color; c.fill(); } else { c.strokeStyle = o.color; c.stroke(); }
        break;
      }
      case 'pen':
      case 'marker': {
        c.strokeStyle = o.color; c.lineJoin = 'round';
        if (o.t === 'marker') { c.globalAlpha = 0.4; c.lineWidth = o.lw * 3.5; c.lineCap = 'square'; }
        else { c.lineWidth = o.lw; c.lineCap = 'round'; }
        c.beginPath();
        o.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        if (o.pts.length === 1) c.lineTo(o.pts[0][0] + 0.01, o.pts[0][1]);
        c.stroke();
        break;
      }
      case 'text': {
        c.fillStyle = o.color; c.textBaseline = 'top';
        c.font = '600 ' + o.size + 'px "Segoe UI", sans-serif';
        String(o.text).split('\n').forEach((ln, i) => c.fillText(ln, o.x, o.y + i * o.size * 1.2));
        break;
      }
      case 'step': {
        c.fillStyle = o.color; c.beginPath(); c.arc(o.x, o.y, o.r, 0, Math.PI * 2); c.fill();
        c.fillStyle = isLight(o.color) ? '#000' : '#fff';
        c.font = '700 ' + Math.round(o.r * 1.15) + 'px "Segoe UI", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(o.n), o.x, o.y + o.r * 0.06);
        break;
      }
      case 'blur': effectBlur(c, normRect(o)); break;
      case 'pixel': effectPixel(c, normRect(o)); break;
      case 'invert': effectInvert(c, normRect(o)); break;
    }
    c.restore();
  }

  function normRect(o) {
    if (o.w != null) return o;
    return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }

  function isLight(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
  }

  function renderTo(c, withCur) {
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(S.base, 0, 0);
    for (const o of S.objects) drawObj(c, o);
    if (withCur && S.cur) {
      if (S.cur.t === 'crop') {
        const r = normRect(S.cur);
        c.save();
        c.fillStyle = 'rgba(0,0,0,.55)';
        c.fillRect(0, 0, c.canvas.width, r.y);
        c.fillRect(0, r.y + r.h, c.canvas.width, c.canvas.height - r.y - r.h);
        c.fillRect(0, r.y, r.x, r.h);
        c.fillRect(r.x + r.w, r.y, c.canvas.width - r.x - r.w, r.h);
        c.strokeStyle = '#3b82f6'; c.lineWidth = Math.max(1, c.canvas.width / 800); c.setLineDash([8, 6]);
        c.strokeRect(r.x, r.y, r.w, r.h);
        c.restore();
      } else if (['blur', 'pixel', 'invert'].includes(S.cur.t)) {
        drawObj(c, S.cur);
        const r = normRect(S.cur);
        c.save(); c.strokeStyle = '#3b82f6'; c.lineWidth = 1; c.setLineDash([6, 4]); c.strokeRect(r.x, r.y, r.w, r.h); c.restore();
      } else drawObj(c, S.cur);
    }
  }

  function render() { renderTo(ctx, true); updateStatus(); }

  // ---------- история изменений ----------
  function snap() { return { base: S.base, objects: S.objects.slice(), stepN: S.stepN }; }
  function pushUndo() {
    S.undo.push(snap());
    if (S.undo.length > 100) S.undo.shift();
    S.redo.length = 0;
    S.dirty = true;
    updateButtons();
  }
  function restore(s) {
    S.base = s.base; S.objects = s.objects.slice(); S.stepN = s.stepN;
    if (canvas.width !== S.base.width || canvas.height !== S.base.height) {
      canvas.width = S.base.width; canvas.height = S.base.height;
    }
    S.cur = null;
    S.dirty = true;
    render(); updateButtons();
  }
  function undo() {
    if (!S.undo.length) return;
    S.redo.push(snap());
    restore(S.undo.pop());
  }
  function redo() {
    if (!S.redo.length) return;
    S.undo.push(snap());
    restore(S.redo.pop());
  }
  function updateButtons() {
    $('ed-undo').disabled = !S.undo.length;
    $('ed-redo').disabled = !S.redo.length;
  }
  function updateStatus() {
    if (!S.base) return;
    $('ed-status').textContent = T('ed.status', { w: S.base.width, h: S.base.height, tool: T('toolname.' + S.tool) }) +
      (S.dirty ? T('ed.dirty') : '') + T('ed.keys');
  }

  // ---------- мышь ----------
  function toImg(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  }

  function onDown(e) {
    if (!S.base || e.button !== 0) return;
    e.preventDefault();
    commitText();
    const p = toImg(e);
    const t = S.tool;
    if (t === 'text') { openText(e, p); return; }
    if (t === 'step') {
      pushUndo();
      S.objects.push({ t: 'step', x: p.x, y: p.y, n: S.stepN++, color: S.color, r: 10 + S.lw * 1.6 });
      render(); return;
    }
    canvas.setPointerCapture(e.pointerId);
    if (t === 'pen' || t === 'marker') S.cur = { t, pts: [[p.x, p.y]], color: S.color, lw: S.lw };
    else if (['blur', 'pixel', 'invert', 'crop'].includes(t)) S.cur = { t, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else S.cur = { t, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: S.color, lw: S.lw, fill: S.fill };
    render();
  }

  function onMove(e) {
    if (!S.cur) return;
    const p = toImg(e);
    const c = S.cur;
    if (c.pts) {
      const last = c.pts[c.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.5) c.pts.push([p.x, p.y]);
    } else {
      let x = p.x, y = p.y;
      if (e.shiftKey) {
        const dx = x - c.x1, dy = y - c.y1;
        if (c.t === 'line' || c.t === 'arrow') {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          x = c.x1 + Math.cos(ang) * len; y = c.y1 + Math.sin(ang) * len;
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          x = c.x1 + Math.sign(dx || 1) * m; y = c.y1 + Math.sign(dy || 1) * m;
        }
      }
      c.x2 = x; c.y2 = y;
    }
    render();
  }

  function onUp(e) {
    const c = S.cur;
    if (!c) return;
    S.cur = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (c.pts) { pushUndo(); S.objects.push(c); render(); return; }
    const r = normRect(c);
    if (r.w < 4 || r.h < 4) {
      // слишком маленькое — для линии/стрелки допустимо, для областей нет
      if (!(c.t === 'line' || c.t === 'arrow') || Math.hypot(c.x2 - c.x1, c.y2 - c.y1) < 4) { render(); return; }
    }
    if (c.t === 'crop') { applyCrop(r); return; }
    pushUndo();
    if (['blur', 'pixel', 'invert'].includes(c.t)) S.objects.push({ t: c.t, x: r.x, y: r.y, w: r.w, h: r.h });
    else S.objects.push(c);
    render();
  }

  function applyCrop(r) {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const w = Math.min(canvas.width - x, Math.round(r.w)), h = Math.min(canvas.height - y, Math.round(r.h));
    if (w < 2 || h < 2) { render(); return; }
    // склеиваем всё нарисованное с основой, затем режем
    const flat = document.createElement('canvas');
    flat.width = canvas.width; flat.height = canvas.height;
    renderTo(flat.getContext('2d'), false);
    const nb = document.createElement('canvas');
    nb.width = w; nb.height = h;
    nb.getContext('2d').drawImage(flat, x, y, w, h, 0, 0, w, h);
    pushUndo();
    S.base = nb; S.objects = []; S.stepN = 1;
    canvas.width = w; canvas.height = h;
    render();
  }

  // ---------- текст ----------
  function openText(e, p) {
    const sr = stage.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const size = 12 + S.lw * 3;
    const k = cr.width / canvas.width;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'txt-input';
    inp.style.left = (e.clientX - sr.left + stage.scrollLeft) + 'px';
    inp.style.top = (e.clientY - sr.top + stage.scrollTop) + 'px';
    inp.style.fontSize = Math.max(10, size * k) + 'px';
    inp.style.width = '220px';
    inp.style.color = S.color;
    inp.style.background = isLight(S.color) ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)';
    stage.appendChild(inp);
    S.textInput = { el: inp, x: p.x, y: p.y, size, color: S.color };
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commitText(); }
      if (ev.key === 'Escape') { ev.preventDefault(); cancelText(); }
    });
    inp.addEventListener('blur', () => commitText());
    inp.focus();
    setTimeout(() => { if (document.activeElement !== inp) inp.focus(); }, 0);
  }
  function cancelText() {
    const t = S.textInput;
    if (!t) return;
    S.textInput = null;
    t.el.remove();
  }
  function commitText() {
    const t = S.textInput;
    if (!t) return;
    S.textInput = null;
    const text = t.el.value.trim();
    t.el.remove();
    if (!text) return;
    pushUndo();
    S.objects.push({ t: 'text', x: t.x, y: t.y, text, color: t.color, size: t.size });
    render();
  }

  // ---------- выдача результата ----------
  function blobPng() {
    commitText();
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    renderTo(out.getContext('2d'), false);
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }
  async function bytes() {
    const b = await blobPng();
    return new Uint8Array(await b.arrayBuffer());
  }

  async function save() {
    if (!S.entry) return;
    const e = await S.api.saveEdited(S.entry.id, await bytes());
    if (e) { S.entry = e; S.dirty = false; S.hooks.toast(T('ed.saved', { p: e.file })); S.hooks.onSaved && S.hooks.onSaved(e); updateStatus(); }
    else S.hooks.toast(T('ed.saveFail'), true);
  }
  async function saveAs() {
    const name = S.entry ? S.entry.file.split(/[\\/]/).pop() : 'image.png';
    const p = await S.api.saveAs(await bytes(), name);
    if (p) S.hooks.toast(T('ed.saved', { p }));
  }
  async function copy() {
    const ok = await S.api.copyImage(await bytes());
    S.hooks.toast(ok ? T('toast.copied') : T('toast.copyFail'), !ok);
  }

  // ---------- загрузка ----------
  async function load(buf, entry) {
    const blob = new Blob([buf]);
    const bmp = await createImageBitmap(blob);
    const base = document.createElement('canvas');
    base.width = bmp.width; base.height = bmp.height;
    base.getContext('2d').drawImage(bmp, 0, 0);
    S.base = base; S.objects = []; S.undo = []; S.redo = []; S.stepN = 1; S.cur = null;
    S.entry = entry; S.dirty = false;
    cancelText();
    canvas.width = base.width; canvas.height = base.height;
    $('ed-empty').hidden = true; $('ed-wrap').hidden = false;
    render(); updateButtons();
    stage.scrollTo(0, 0);
  }

  function setTool(t) {
    commitText();
    S.tool = t;
    document.querySelectorAll('#tool-btns .tb').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = t === 'text' ? 'text' : 'crosshair';
    updateStatus();
  }

  function setColor(c) {
    S.color = c; $('ed-color').value = c;
    S.hooks.prefs({ color: S.color, width: S.lw });
  }

  function init(opts) {
    S.api = opts.api; S.hooks = opts.hooks;
    canvas = $('ed-canvas'); ctx = canvas.getContext('2d', { willReadFrequently: true }); stage = $('ed-stage');
    const prefs = opts.prefs || {};
    S.color = prefs.color || S.color; S.lw = prefs.width || S.lw;
    $('ed-color').value = S.color; $('ed-width').value = S.lw;

    const sw = $('ed-swatches');
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw'; b.style.background = c; b.title = c;
      b.addEventListener('click', () => setColor(c));
      sw.appendChild(b);
    });
    $('ed-color').addEventListener('input', (e) => setColor(e.target.value));
    $('ed-width').addEventListener('input', (e) => { S.lw = +e.target.value; S.hooks.prefs({ color: S.color, width: S.lw }); });
    $('ed-fill').addEventListener('change', (e) => { S.fill = e.target.checked; });
    document.querySelectorAll('#tool-btns .tb').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('ed-undo').addEventListener('click', undo);
    $('ed-redo').addEventListener('click', redo);
    $('ed-invert-all').addEventListener('click', () => {
      if (!S.base) return;
      commitText(); pushUndo();
      S.objects.push({ t: 'invert', x: 0, y: 0, w: canvas.width, h: canvas.height });
      render();
    });
    $('ed-zoom').addEventListener('click', () => {
      const full = stage.classList.toggle('full');
      zoomText();
    });
    $('ed-save').addEventListener('click', save);
    $('ed-saveas').addEventListener('click', saveAs);
    $('ed-copy').addEventListener('click', copy);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    document.addEventListener('keydown', (e) => {
      if (!S.base || !S.hooks.isActive()) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' && e.target.type !== 'color') return;
      if (tag === 'select') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(); }
      else if (ctrl && e.code === 'KeyC' && !String(window.getSelection()).length) { e.preventDefault(); copy(); }
    });
    updateButtons();
    zoomText();
    document.addEventListener('langchange', () => { zoomText(); if (S.base) updateStatus(); });
  }

  window.Editor = {
    init, load, hasImage: () => !!S.base, entry: () => S.entry, isDirty: () => S.dirty,
    // для тестов
    _state: S, _setTool: setTool, _undo: undo, _redo: redo, _bytes: bytes, _save: save
  };
})();
