'use strict';
// Видеоредактор: клипы на таймлайне, обрезка, вырезание, скорость, звук, надписи/стрелки/размытие, экспорт.
// Модель — renderer/video-core.js, рисование наложений — video-draw.js. Проект живёт в памяти (не сохраняется между запусками).
(function () {
  const V = window.VideoCore, D = window.VideoDraw;
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);
  const S = { ctx: null, p: V.newProject(), t: 0, playing: false, sel: null, selOv: null, focus: 'clip', markIn: null, markOut: null,
    zoom: 1, undo: [], redo: [], loadedSrc: null, loadTok: 0, exporting: false, raf: 0, frameBox: { w: 640, h: 360 } };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60).toFixed(1); };
  const video = () => $('vd-video');
  const idxOf = (id) => S.p.clips.findIndex((c) => c.id === id);
  const selIdx = () => idxOf(S.sel);
  const selOvObj = () => S.p.overlays.find((o) => o.id === S.selOv) || null;
  const total = () => V.total(S.p);

  // ---------- undo ----------
  function snap() { return JSON.stringify({ p: S.p, sel: S.sel, selOv: S.selOv }); }
  function pushUndo() { S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; syncUndo(); }
  function restore(js) { const o = JSON.parse(js); S.p = o.p; S.sel = o.sel; S.selOv = o.selOv; S.markIn = S.markOut = null; afterEdit(); }
  function undo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); syncUndo(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); syncUndo(); }
  function syncUndo() { $('vd-undo').disabled = !S.undo.length; $('vd-redo').disabled = !S.redo.length; }

  // ---------- воспроизведение ----------
  function whereAt(t) { return V.locate(S.p, t); }

  async function loadSrc(clip) {
    if (S.loadedSrc === clip.src) return;
    const tok = ++S.loadTok;
    const v = video();
    S.loadedSrc = clip.src;
    await new Promise((res) => {
      const done = () => { v.removeEventListener('loadedmetadata', done); v.removeEventListener('error', done); res(); };
      v.addEventListener('loadedmetadata', done); v.addEventListener('error', done);
      v.src = clip.url;
    });
    if (tok !== S.loadTok) return;
  }

  function applyClipAudio(c) {
    const v = video();
    v.playbackRate = c.speed;
    v.volume = clamp(c.volume / 100, 0, 1);
    v.muted = !!c.mute || !c.hasAudio;
  }

  async function seek(t, keepPlaying) {
    const T0 = total();
    S.t = clamp(t, 0, T0);
    const loc = whereAt(S.t);
    drawHead(); drawOverlays();
    if (!loc) return;
    const my = ++S.seekTok || (S.seekTok = 1);
    S.seekTok = my;
    await loadSrc(loc.clip);
    if (S.seekTok !== my) return;
    applyClipAudio(loc.clip);
    const v = video();
    if (Math.abs(v.currentTime - loc.srcTime) > 0.03) v.currentTime = loc.srcTime;
    if (!keepPlaying) v.pause();
  }

  async function play() {
    if (!S.p.clips.length) return;
    if (S.t >= total() - 0.05) await seek(0, true); else await seek(S.t, true);
    S.playing = true;
    try { await video().play(); } catch (_) { S.playing = false; }
    syncPlayBtn();
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(tick);
  }
  function pause() { S.playing = false; video().pause(); cancelAnimationFrame(S.raf); syncPlayBtn(); }
  function syncPlayBtn() { $('vd-play').firstElementChild.textContent = S.playing ? T('vd.pause') : T('vd.play'); }

  async function tick() {
    if (!S.playing) return;
    const v = video();
    const loc = whereAt(S.t);
    if (loc) {
      const c = loc.clip;
      if (v.currentTime >= c.outT - 0.02 || v.ended) {
        const next = loc.index + 1;
        if (next >= S.p.clips.length) { S.t = total(); pause(); drawHead(); drawOverlays(); return; }
        const st = V.starts(S.p)[next];
        await seek(st + 0.001, true);
        if (S.playing) { try { await v.play(); } catch (_) {} }
      } else {
        S.t = clamp(loc.start + (v.currentTime - c.inT) / c.speed, loc.start, loc.start + V.clipDur(c));
      }
    }
    drawHead(); drawOverlays(); updateTime();
    S.raf = requestAnimationFrame(tick);
  }

  function updateTime() { $('vd-cur').textContent = fmt(S.t); $('vd-tot').textContent = fmt(total()); }

  // ---------- кадр и наложения ----------
  function fitFrame() {
    const c = S.p.clips[0]; if (!c) return;
    const sz = V.frameSize(S.p, 0);
    const st = $('vd-stage');
    const maxW = Math.max(200, st.clientWidth - 2), maxH = st.clientHeight - 2;
    const k = Math.min(maxW / sz.w, maxH / sz.h);
    const w = Math.max(40, Math.floor(sz.w * k)), h = Math.max(40, Math.floor(sz.h * k));
    S.frameBox = { w, h };
    const f = $('vd-frame'); f.style.width = w + 'px'; f.style.height = h + 'px';
    const cv = $('vd-ovc'); cv.width = w; cv.height = h;
  }

  const active = (o) => S.t >= o.start - 1e-6 && S.t <= o.end + 1e-6;

  function drawOverlays() {
    const { w, h } = S.frameBox;
    const cv = $('vd-ovc'); const c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const layer = $('vd-ovl'); layer.textContent = '';
    const boxes = {};
    for (const o of S.p.overlays) {
      if (o.type === 'blur') continue;
      if (active(o)) boxes[o.id] = D.drawOverlay(c, o, w, h);
    }
    for (const o of S.p.overlays) {
      const isSel = o.id === S.selOv;
      if (o.type === 'blur') {
        if (!active(o) && !isSel) continue;
        const d = el('div', 'vd-blur');
        Object.assign(d.style, { left: o.x * w + 'px', top: o.y * h + 'px', width: o.w * w + 'px', height: o.h * h + 'px', backdropFilter: active(o) ? 'blur(' + Math.max(1, Math.round(o.strength * h / 360)) + 'px)' : 'none',
          outline: isSel ? '2px solid var(--accent)' : 'none', opacity: active(o) ? 1 : 0.4 });
        d.dataset.ov = o.id;
        d.addEventListener('pointerdown', (e) => startDrag(e, o, 'move'));
        layer.appendChild(d);
        if (isSel) { const hn = el('div', 'vd-pt'); hn.style.left = (o.x + o.w) * w + 'px'; hn.style.top = (o.y + o.h) * h + 'px'; hn.addEventListener('pointerdown', (e) => startDrag(e, o, 'resize')); layer.appendChild(hn); }
      } else if (o.type === 'text') {
        const bx = boxes[o.id] || (isSel ? { x: o.x * w, y: o.y * h, w: 60, h: o.size * h * 1.5 } : null);
        if (!bx) continue;
        const d = el('div', 'vd-txt-hit');
        Object.assign(d.style, { left: bx.x + 'px', top: bx.y + 'px', width: bx.w + 'px', height: bx.h + 'px', outline: isSel ? '2px dashed var(--accent)' : 'none' });
        d.dataset.ov = o.id;
        d.addEventListener('pointerdown', (e) => startDrag(e, o, 'move'));
        layer.appendChild(d);
        if (isSel) { const hn = el('div', 'vd-pt'); hn.style.left = bx.x + bx.w + 'px'; hn.style.top = bx.y + bx.h + 'px'; hn.addEventListener('pointerdown', (e) => startDrag(e, o, 'resize')); layer.appendChild(hn); }
      } else if (o.type === 'arrow' && isSel) {
        for (const k of ['1', '2']) {
          const hn = el('div', 'vd-pt'); hn.style.left = o['x' + k] * w + 'px'; hn.style.top = o['y' + k] * h + 'px';
          hn.addEventListener('pointerdown', (e) => startDrag(e, o, 'p' + k)); layer.appendChild(hn);
        }
      }
      if (o.type === 'arrow' && !isSel && active(o)) {
        const d = el('div', 'vd-txt-hit');
        const bx = boxes[o.id] || { x: 0, y: 0, w: 0, h: 0 };
        Object.assign(d.style, { left: bx.x - 6 + 'px', top: bx.y - 6 + 'px', width: bx.w + 12 + 'px', height: bx.h + 12 + 'px' });
        d.addEventListener('pointerdown', (e) => { e.preventDefault(); selectOv(o.id); });
        layer.appendChild(d);
      }
    }
    // выбранный блок поверх остальных должен получать клики: сам он стоит позже в DOM только если рисуется последним
  }

  function startDrag(e, o, mode) {
    e.preventDefault(); e.stopPropagation();
    if (S.selOv !== o.id) selectOv(o.id);
    pushUndo();
    const { w, h } = S.frameBox;
    const x0 = e.clientX, y0 = e.clientY, orig = JSON.parse(JSON.stringify(o));
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / w, dy = (ev.clientY - y0) / h;
      const cur = S.p.overlays.find((q) => q.id === o.id); if (!cur) return;
      if (o.type === 'arrow') {
        if (mode === 'p1') V.updateOverlay(S.p, o.id, { x1: orig.x1 + dx, y1: orig.y1 + dy });
        else if (mode === 'p2') V.updateOverlay(S.p, o.id, { x2: orig.x2 + dx, y2: orig.y2 + dy });
      } else if (o.type === 'blur') {
        if (mode === 'move') V.updateOverlay(S.p, o.id, { x: orig.x + dx, y: orig.y + dy });
        else V.updateOverlay(S.p, o.id, { w: orig.w + dx, h: orig.h + dy });
      } else if (o.type === 'text') {
        if (mode === 'move') V.updateOverlay(S.p, o.id, { x: orig.x + dx, y: orig.y + dy });
        else V.updateOverlay(S.p, o.id, { size: orig.size + dy * 0.6 });
      }
      drawOverlays(); syncOvPanel(true);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  // ---------- таймлайн ----------
  function pps() {
    const w = $('vd-scroll').clientWidth - 24;
    return Math.max(8, (w / Math.max(total(), 1)) * S.zoom);
  }
  const timeAtX = (x) => clamp((x) / pps(), 0, total());

  function drawTimeline() {
    const P = pps(), Tt = total();
    const track = $('vd-track');
    track.style.width = Math.max($('vd-scroll').clientWidth - 2, Tt * P + 24) + 'px';
    // линейка
    const ruler = $('vd-ruler'); ruler.textContent = '';
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const step = steps.find((s) => s * P >= 70) || 3600;
    for (let t = 0; t <= Tt + step; t += step) {
      const k = el('div', 'vd-tick', t >= 60 ? Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0') : (Math.round(t * 10) / 10) + ' c');
      k.style.left = t * P + 'px'; ruler.appendChild(k);
    }
    // клипы
    const lane = $('vd-lane-clips'); lane.textContent = '';
    const st = V.starts(S.p);
    S.p.clips.forEach((c, i) => {
      const d = el('div', 'vd-clip' + (c.id === S.sel ? ' sel' : ''));
      d.style.left = st[i] * P + 'px'; d.style.width = Math.max(6, V.clipDur(c) * P - 2) + 'px';
      d.dataset.clip = c.id;
      d.append(el('div', null, c.name || ('#' + (i + 1))), el('small', null, fmt(V.clipDur(c)) + (c.speed !== 1 ? ' · ×' + c.speed : '') + (c.mute ? ' · 🔇' : '')));
      const hl = el('div', 'vd-h l'), hr = el('div', 'vd-h r');
      hl.addEventListener('pointerdown', (e) => trimDrag(e, c, 'in'));
      hr.addEventListener('pointerdown', (e) => trimDrag(e, c, 'out'));
      d.append(hl, hr);
      d.addEventListener('pointerdown', (e) => { if (e.target !== hl && e.target !== hr) { selectClip(c.id); } });
      lane.appendChild(d);
    });
    // наложения
    const ol = $('vd-lane-ov'); ol.textContent = '';
    const rowEnd = [], rows = {};
    for (const o of S.p.overlays.slice().sort((a, b) => a.start - b.start)) {
      let r = rowEnd.findIndex((e) => e <= o.start + 1e-6); if (r < 0) { r = rowEnd.length; rowEnd.push(0); } rowEnd[r] = o.end; rows[o.id] = r;
    }
    ol.style.height = Math.max(44, rowEnd.length * 26 + 6) + 'px';
    $('vd-track').style.height = (98 + Math.max(44, rowEnd.length * 26 + 6) + 8) + 'px';
    for (const o of S.p.overlays) {
      const d = el('div', 'vd-ob ' + o.type + (o.id === S.selOv ? ' sel' : ''), o.type === 'text' ? (o.text || '').split('\n')[0] : T('vd.add.' + o.type));
      d.style.left = o.start * P + 'px'; d.style.width = Math.max(12, (o.end - o.start) * P) + 'px'; d.style.top = ((rows[o.id] || 0) * 26 + 4) + 'px';
      const hl = el('div', 'vd-h l'), hr = el('div', 'vd-h r');
      d.append(hl, hr);
      hl.addEventListener('pointerdown', (e) => ovTimeDrag(e, o, 'l'));
      hr.addEventListener('pointerdown', (e) => ovTimeDrag(e, o, 'r'));
      d.addEventListener('pointerdown', (e) => { if (e.target === d) ovTimeDrag(e, o, 'move'); });
      ol.appendChild(d);
    }
    // метки
    const r = $('vd-range');
    if (S.markIn != null && S.markOut != null && S.markOut > S.markIn) {
      r.hidden = false; r.style.left = S.markIn * P + 'px'; r.style.width = (S.markOut - S.markIn) * P + 'px';
    } else r.hidden = true;
    $('vd-marks').textContent = (S.markIn != null ? T('vd.mark.in', { t: fmt(S.markIn) }) : '') + (S.markOut != null ? ' ' + T('vd.mark.out', { t: fmt(S.markOut) }) : '');
    drawHead();
  }

  function drawHead() { $('vd-head').style.left = S.t * pps() + 'px'; updateTime(); }

  function trackX(e) { const r = $('vd-track').getBoundingClientRect(); return e.clientX - r.left; }

  function scrub(e) {
    if (e.target.closest('.vd-h, .vd-ob')) return;
    pause();
    const go = (ev) => seek(timeAtX(trackX(ev)));
    go(e);
    const mv = (ev) => go(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function trimDrag(e, c, side) {
    e.preventDefault(); e.stopPropagation();
    pause();
    selectClip(c.id);
    pushUndo();
    const x0 = e.clientX, P = pps(), i = idxOf(c.id), o0 = { inT: c.inT, outT: c.outT };
    const mv = (ev) => {
      const ds = ((ev.clientX - x0) / P) * c.speed;
      V.trimClip(S.p, i, side === 'in' ? { inT: o0.inT + ds } : { outT: o0.outT + ds });
      drawTimeline(); updateTime(); fillClipPanel();
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); S.t = clamp(S.t, 0, total()); seek(S.t); afterEdit(true); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function ovTimeDrag(e, o, mode) {
    e.preventDefault(); e.stopPropagation();
    selectOv(o.id);
    pushUndo();
    const x0 = e.clientX, P = pps(), a = o.start, b = o.end, Tt = total();
    const mv = (ev) => {
      const d = (ev.clientX - x0) / P;
      if (mode === 'move') { const len = b - a; const s = clamp(a + d, 0, Tt - len); V.updateOverlay(S.p, o.id, { start: s, end: s + len }); }
      else if (mode === 'l') V.updateOverlay(S.p, o.id, { start: Math.min(a + d, b - V.MIN_OVERLAY) });
      else V.updateOverlay(S.p, o.id, { end: Math.max(b + d, a + V.MIN_OVERLAY) });
      drawTimeline(); syncOvPanel(true); drawOverlays();
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  // ---------- выбор ----------
  function selectClip(id) { S.sel = id; S.focus = 'clip'; drawTimeline(); fillClipPanel(); }
  function selectOv(id) { S.selOv = id; S.focus = 'ov'; drawTimeline(); syncOvPanel(); drawOverlays(); }

  // ---------- панели ----------
  function fillClipPanel() {
    const i = selIdx(), c = S.p.clips[i];
    $('vd-clip-none').hidden = !!c; $('vd-clip-box').hidden = !c;
    if (!c) return;
    $('vd-clip-name').textContent = (c.name || '') + ' · ' + fmt(c.inT) + ' – ' + fmt(c.outT);
    $('vd-speed').value = String(c.speed);
    $('vd-vol').value = c.volume; $('vd-vol-v').textContent = c.volume + '%';
    $('vd-mute').checked = c.mute;
    $('vd-vol').disabled = $('vd-mute').disabled = !c.hasAudio;
    $('vd-left').disabled = i <= 0; $('vd-right').disabled = i >= S.p.clips.length - 1;
  }

  function syncOvPanel(soft) {
    const o = selOvObj();
    $('vd-ov-none').hidden = !!o; $('vd-ov-box').hidden = !o;
    if (!o) return;
    const isT = o.type === 'text', isA = o.type === 'arrow', isB = o.type === 'blur';
    $('vd-ov-text-row').hidden = !isT; $('vd-ov-bg-row').hidden = !isT; $('vd-ov-color-row').hidden = isB;
    const sz = $('vd-ov-size');
    if (isT) { sz.min = 2; sz.max = 30; $('vd-ov-size-l').textContent = T('vd.ov.size'); if (!soft || document.activeElement !== sz) sz.value = Math.round(o.size * 100); }
    if (isA) { sz.min = 2; sz.max = 30; $('vd-ov-size-l').textContent = T('vd.ov.width'); if (!soft || document.activeElement !== sz) sz.value = Math.round(o.width * 1000); }
    if (isB) { sz.min = 2; sz.max = 40; $('vd-ov-size-l').textContent = T('vd.ov.strength'); if (!soft || document.activeElement !== sz) sz.value = o.strength; }
    if (isT && document.activeElement !== $('vd-ov-text')) $('vd-ov-text').value = o.text;
    if (!isB) $('vd-ov-color').value = o.color;
    $('vd-ov-bg').checked = !!o.bg;
    if (document.activeElement !== $('vd-ov-start')) $('vd-ov-start').value = o.start.toFixed(1);
    if (document.activeElement !== $('vd-ov-end')) $('vd-ov-end').value = o.end.toFixed(1);
  }

  // ---------- правки ----------
  // Любая правка проекта заканчивается этим: обновить выбор, таймлайн, панели и кадр
  function afterEdit(keepSeek) {
    if (!S.p.clips.length) {
      pause(); S.t = 0; S.sel = null; S.selOv = null; S.loadedSrc = null; video().removeAttribute('src');
      $('vd-main').hidden = true; $('vd-empty').hidden = false; syncUndo(); return;
    }
    $('vd-main').hidden = false; $('vd-empty').hidden = true;
    if (!S.p.clips.some((c) => c.id === S.sel)) S.sel = S.p.clips[0].id;
    if (S.selOv && !selOvObj()) S.selOv = null;
    S.t = clamp(S.t, 0, total());
    fitFrame(); drawTimeline(); fillClipPanel(); syncOvPanel(); updateEstimate();
    if (!keepSeek) seek(S.t); else drawOverlays();
    syncUndo();
  }

  function edit(fn) { pushUndo(); const r = fn(); afterEdit(); return r; }

  async function addFiles(list) {
    if (!list || !list.length) return;
    pushUndo();
    for (const f of list) {
      const c = V.makeClip({ src: f.src, dur: f.dur, hasAudio: f.hasAudio, w: f.w, h: f.h, fps: f.fps, name: f.name });
      c.url = f.url;
      V.addClip(S.p, c);
      S.sel = c.id;
    }
    $('vd-main').hidden = false; $('vd-empty').hidden = true;
    afterEdit();
  }

  async function pick() { addFiles(await S.ctx.api.vidPick()); }

  function openLibrary() {
    const box = $('vd-lib-list'); box.textContent = '';
    S.ctx.api.recList().then((list) => {
      if (!list || !list.length) { box.textContent = T('vd.lib.empty'); return; }
      list.forEach((e) => {
        const b = el('button', 'vd-lib-item');
        b.append(el('b', null, String(e.file).split(/[\\/]/).pop()), el('span', 'muted', fmt(e.duration || 0)));
        b.addEventListener('click', async () => {
          $('vd-libmodal').hidden = true;
          const d = await S.ctx.api.vidFromLibrary(e.id);
          if (!d) { S.ctx.toast(T('vd.err.open'), true); return; }
          addFiles([d]);
        });
        box.appendChild(b);
      });
    });
    $('vd-libmodal').hidden = false;
  }

  async function openFromLibrary(id) {
    const d = await S.ctx.api.vidFromLibrary(id);
    if (!d) { S.ctx.toast(T('vd.err.open'), true); return; }
    S.ctx.go('video');
    addFiles([d]);
  }

  // разрезание: снимок для undo делаем до изменения
  function split() {
    if (!S.p.clips.length) return;
    pause();
    const before = snap();
    const i = V.splitAt(S.p, S.t);
    if (i < 0) { S.ctx.toast(T('vd.split.near'), true); return; }
    S.undo.push(before); S.redo = []; S.sel = S.p.clips[i].id; afterEdit(true);
  }

  function cut() {
    if (S.markIn == null || S.markOut == null || S.markOut - S.markIn < V.MIN_CLIP) { S.ctx.toast(T('vd.cut.need'), true); return; }
    pause();
    const before = snap();
    if (!V.cutRange(S.p, S.markIn, S.markOut)) { S.ctx.toast(T('vd.cut.need'), true); return; }
    S.undo.push(before); S.redo = []; S.markIn = S.markOut = null;
    S.t = Math.min(S.t, total()); afterEdit();
  }

  function del() {
    if (S.focus === 'ov' && selOvObj()) { edit(() => V.removeOverlay(S.p, S.selOv)); S.selOv = null; afterEdit(); return; }
    const i = selIdx(); if (i < 0) return;
    pause(); edit(() => V.removeClip(S.p, i));
  }

  function addOv(type) {
    if (!S.p.clips.length) return;
    pushUndo();
    const o = V.addOverlay(S.p, type, S.t);
    if (o) { S.selOv = o.id; S.focus = 'ov'; }
    afterEdit(true);
  }

  // ---------- оценка и экспорт ----------
  function updateEstimate() {
    if (!S.p.clips.length) return;
    const sz = V.frameSize(S.p, +$('vd-res').value);
    $('vd-est').textContent = T('vd.est', { d: fmt(total()), w: sz.w, h: sz.h });
  }
  function syncFmt() {
    const g = $('vd-fmt').value === 'gif';
    document.querySelector('.vd-vid-opts').hidden = g; document.querySelector('.vd-gif-opts').hidden = !g;
    updateEstimate();
  }

  async function doExport() {
    if (S.exporting || !S.p.clips.length) return;
    pause();
    const fmtV = $('vd-fmt').value;
    const height = +$('vd-res').value;
    const sz = V.frameSize(S.p, height);
    const png = {};
    for (const o of S.p.overlays) {
      if (o.type === 'blur') continue;
      const b = await D.renderOverlayPng(o, sz.w, sz.h);
      if (b) png[o.id] = b;
    }
    S.exporting = true; setExporting(true, 0);
    const r = await S.ctx.api.vidExport({ project: JSON.parse(JSON.stringify(S.p)), overlayPng: png,
      opts: { format: fmtV, height, fps: +$('vd-fps').value, quality: $('vd-q').value, gifFps: +$('vd-giffps').value, gifWidth: +$('vd-gifw').value } });
    S.exporting = false; setExporting(false);
    if (r && r.ok) S.ctx.toast(T('vd.saved', { name: String(r.file).split(/[\\/]/).pop() }));
    else if (r && r.error !== 'cancelled') S.ctx.toast(T(r && r.error === 'ffmpeg' ? 'vd.err.ffmpeg' : r && r.error === 'noffmpeg' ? 'vd.err.noffmpeg' : 'vd.err.export'), true);
  }
  function setExporting(on, p) {
    $('vd-bar').hidden = !on; $('vd-cancel').hidden = !on; $('vd-export').disabled = on;
    $('vd-bar-i').style.width = Math.round((p || 0) * 100) + '%';
  }

  async function framePng() {
    if (!S.p.clips.length) return;
    pause();
    const loc = whereAt(S.t);
    const sz = V.frameSize(S.p, 0);
    const cv = document.createElement('canvas'); cv.width = sz.w; cv.height = sz.h;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, sz.w, sz.h);
    const raw = loc && await S.ctx.api.vidFrame(loc.clip.src, loc.srcTime);
    if (!raw) { S.ctx.toast(T('vd.err.frame'), true); return; }
    const img = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const k = Math.min(sz.w / img.width, sz.h / img.height), dw = img.width * k, dh = img.height * k;
    c.drawImage(img, (sz.w - dw) / 2, (sz.h - dh) / 2, dw, dh);
    for (const o of S.p.overlays) {
      if (!active(o)) continue;
      if (o.type === 'blur') D.drawBlur(c, cv, o, sz.w, sz.h); else D.drawOverlay(c, o, sz.w, sz.h);
    }
    const bytes = await D.toBytes(cv);
    const base = String((S.p.clips[0].name || 'frame')).replace(/\.[^.]+$/, '');
    const f = await S.ctx.api.saveAs(bytes, base + '_' + Math.round(S.t * 10) / 10 + 's.png');
    if (f) S.ctx.toast(T('vd.frame.saved'));
  }

  // ---------- привязка ----------
  function bindPanel() {
    $('vd-speed').innerHTML = '';
    V.SPEEDS.forEach((s) => { const o = el('option', null, '×' + s); o.value = String(s); $('vd-speed').appendChild(o); });
    $('vd-speed').addEventListener('change', () => { const i = selIdx(); if (i >= 0) { pause(); edit(() => V.setSpeed(S.p, i, +$('vd-speed').value)); } });
    $('vd-vol').addEventListener('input', () => { $('vd-vol-v').textContent = $('vd-vol').value + '%'; });
    $('vd-vol').addEventListener('change', () => { const i = selIdx(); if (i >= 0) edit(() => V.setVolume(S.p, i, +$('vd-vol').value)); });
    $('vd-mute').addEventListener('change', () => { const i = selIdx(); if (i >= 0) edit(() => V.setMute(S.p, i, $('vd-mute').checked)); });
    $('vd-left').addEventListener('click', () => { const i = selIdx(); if (i > 0) edit(() => V.moveClip(S.p, i, -1)); });
    $('vd-right').addEventListener('click', () => { const i = selIdx(); if (i >= 0) edit(() => V.moveClip(S.p, i, 1)); });
    $('vd-trim-in').addEventListener('click', () => { const l = whereAt(S.t), i = selIdx(); if (l && i === l.index) { pause(); const t = S.t; edit(() => V.trimClip(S.p, i, { inT: l.srcTime })); S.t = Math.max(0, V.starts(S.p)[i]); seek(S.t); void t; } else S.ctx.toast(T('vd.trim.need'), true); });
    $('vd-trim-out').addEventListener('click', () => { const l = whereAt(S.t), i = selIdx(); if (l && i === l.index) { pause(); edit(() => V.trimClip(S.p, i, { outT: l.srcTime })); } else S.ctx.toast(T('vd.trim.need'), true); });

    const upd = (patch, undoOnce) => { const o = selOvObj(); if (!o) return; if (undoOnce) pushUndo(); V.updateOverlay(S.p, o.id, patch); drawTimeline(); drawOverlays(); };
    let ovTypedUndo = false;
    const firstType = () => { if (!ovTypedUndo) { pushUndo(); ovTypedUndo = true; setTimeout(() => { ovTypedUndo = false; }, 1500); } };
    $('vd-ov-text').addEventListener('input', () => { firstType(); upd({ text: $('vd-ov-text').value }); });
    $('vd-ov-color').addEventListener('input', () => { firstType(); upd({ color: $('vd-ov-color').value }); });
    $('vd-ov-bg').addEventListener('change', () => upd({ bg: $('vd-ov-bg').checked }, true));
    $('vd-ov-size').addEventListener('input', () => {
      const o = selOvObj(); if (!o) return; firstType(); const v = +$('vd-ov-size').value;
      upd(o.type === 'text' ? { size: v / 100 } : o.type === 'arrow' ? { width: v / 1000 } : { strength: v });
    });
    $('vd-ov-start').addEventListener('change', () => upd({ start: +$('vd-ov-start').value }, true));
    $('vd-ov-end').addEventListener('change', () => upd({ end: +$('vd-ov-end').value }, true));
    $('vd-ov-del').addEventListener('click', () => { S.focus = 'ov'; del(); });
    $('vd-add-text').addEventListener('click', () => addOv('text'));
    $('vd-add-arrow').addEventListener('click', () => addOv('arrow'));
    $('vd-add-blur').addEventListener('click', () => addOv('blur'));
    ['vd-fmt', 'vd-res'].forEach((id) => $(id).addEventListener('change', syncFmt));
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!$('page-video').classList.contains('active') || S.p.clips.length === 0) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      let used = true;
      if (ctrl && e.code === 'KeyZ') (e.shiftKey ? redo : undo)();
      else if (ctrl && e.code === 'KeyY') redo();
      else if (ctrl) used = false;
      else if (e.code === 'Space') (S.playing ? pause : play)();
      else if (e.code === 'KeyS') split();
      else if (e.code === 'KeyI') { S.markIn = S.t; if (S.markOut != null && S.markOut <= S.markIn) S.markOut = null; drawTimeline(); }
      else if (e.code === 'KeyO') { S.markOut = S.t; if (S.markIn != null && S.markIn >= S.markOut) S.markIn = null; drawTimeline(); }
      else if (e.code === 'KeyX') cut();
      else if (e.code === 'Delete' || e.code === 'Backspace') del();
      else if (e.code === 'ArrowLeft') { pause(); seek(S.t - (e.shiftKey ? 1 : 0.1)); }
      else if (e.code === 'ArrowRight') { pause(); seek(S.t + (e.shiftKey ? 1 : 0.1)); }
      else if (e.code === 'Home') { pause(); seek(0); }
      else if (e.code === 'End') { pause(); seek(total()); }
      else used = false;
      if (used) e.preventDefault();
    });
  }

  function init(ctx) {
    S.ctx = ctx;
    bindPanel(); bindKeys();
    $('vd-add').addEventListener('click', pick);
    $('vd-addlib').addEventListener('click', openLibrary);
    $('vd-lib-close').addEventListener('click', () => { $('vd-libmodal').hidden = true; });
    $('vd-libmodal').addEventListener('click', (e) => { if (e.target === $('vd-libmodal')) $('vd-libmodal').hidden = true; });
    $('vd-play').addEventListener('click', () => (S.playing ? pause() : play()));
    $('vd-undo').addEventListener('click', undo); $('vd-redo').addEventListener('click', redo);
    $('vd-split').addEventListener('click', split);
    $('vd-markin').addEventListener('click', () => { S.markIn = S.t; if (S.markOut != null && S.markOut <= S.markIn) S.markOut = null; drawTimeline(); });
    $('vd-markout').addEventListener('click', () => { S.markOut = S.t; if (S.markIn != null && S.markIn >= S.markOut) S.markIn = null; drawTimeline(); });
    $('vd-cut').addEventListener('click', cut);
    $('vd-del').addEventListener('click', () => { S.focus = 'clip'; del(); });
    $('vd-zoom').addEventListener('input', () => { S.zoom = +$('vd-zoom').value; drawTimeline(); });
    $('vd-track').addEventListener('pointerdown', scrub);
    $('vd-export').addEventListener('click', doExport);
    $('vd-cancel').addEventListener('click', () => ctx.api.vidCancel());
    $('vd-frame-png').addEventListener('click', framePng);
    ctx.api.onVidProgress((p) => { if (S.exporting) setExporting(true, p && p.p); });
    window.addEventListener('resize', () => { if (!$('vd-main').hidden) { fitFrame(); drawTimeline(); drawOverlays(); } });
    video().addEventListener('seeked', () => { if (!$('vd-main').hidden) drawOverlays(); });
    document.addEventListener('langchange', () => { syncPlayBtn(); fillClipPanel(); syncOvPanel(); drawTimeline(); updateEstimate(); });
    syncUndo(); syncFmt();
  }

  function show() { if (S.p.clips.length) { $('vd-main').hidden = false; $('vd-empty').hidden = true; fitFrame(); drawTimeline(); drawOverlays(); } else { $('vd-main').hidden = true; $('vd-empty').hidden = false; } }
  function leave() { pause(); }

  window.VideoTab = { init, show, leave, openFromLibrary, _state: S, _seek: seek };
})();
