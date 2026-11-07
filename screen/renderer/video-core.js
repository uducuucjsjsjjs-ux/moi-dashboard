'use strict';
// Модель видеопроекта: клипы по порядку, у каждого начало/конец в исходнике, скорость и громкость;
// поверх — наложения (текст, стрелка, размытие) по времени готового ролика. Чистая логика без DOM:
// её использует интерфейс и экспорт, поэтому она проверяется тестами на Node.

(function (root) {
  const MIN_CLIP = 0.1;       // минимальная длина клипа, с
  const MIN_OVERLAY = 0.2;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round3 = (v) => Math.round(v * 1000) / 1000;
  let seq = 1;
  const uid = (p) => p + (seq++) + Math.random().toString(36).slice(2, 6);

  const newProject = () => ({ clips: [], overlays: [] });

  function makeClip(o) {
    return { id: uid('c'), src: o.src, srcDur: o.dur, inT: 0, outT: o.dur, speed: 1, volume: 100, mute: false,
      hasAudio: !!o.hasAudio, w: o.w || 0, h: o.h || 0, fps: o.fps || 0, name: o.name || '' };
  }

  const clipDur = (c) => (c.outT - c.inT) / c.speed;
  const total = (p) => round3(p.clips.reduce((a, c) => a + clipDur(c), 0));
  function starts(p) { let t = 0; return p.clips.map((c) => { const s = t; t += clipDur(c); return s; }); }

  // Какой клип звучит в момент t (время готового ролика) и какое это время в исходнике
  function locate(p, t) {
    if (!p.clips.length) return null;
    const st = starts(p);
    const tt = clamp(t, 0, total(p));
    let i = p.clips.length - 1;
    for (let k = 0; k < p.clips.length; k++) if (tt < st[k] + clipDur(p.clips[k]) - 1e-9) { i = k; break; }
    const c = p.clips[i];
    return { index: i, start: st[i], srcTime: clamp(c.inT + (tt - st[i]) * c.speed, c.inT, c.outT), clip: c };
  }

  // Когда вырезан кусок [a, b) готового ролика, наложения сдвигаются назад
  function remapOverlays(p, a, b) {
    const len = b - a;
    const mapT = (t) => (t <= a ? t : t >= b ? t - len : a);
    p.overlays = p.overlays.map((o) => Object.assign({}, o, { start: mapT(o.start), end: mapT(o.end) }));
    clampOverlays(p);
  }

  function clampOverlays(p) {
    const T = total(p);
    p.overlays = p.overlays.map((o) => Object.assign({}, o, { start: round3(clamp(o.start, 0, T)), end: round3(clamp(o.end, 0, T)) }))
      .filter((o) => o.end - o.start >= MIN_OVERLAY - 1e-9);
  }

  const addClip = (p, c) => { p.clips.push(c); return p.clips.length - 1; };

  // Разрезать клип в момент t. Возвращает индекс правой части или -1, если рядом граница
  function splitAt(p, t) {
    const loc = locate(p, t);
    if (!loc) return -1;
    const c = loc.clip;
    const within = (t - loc.start) * c.speed;           // сколько секунд исходника от начала клипа
    if (within < MIN_CLIP || (c.outT - c.inT) - within < MIN_CLIP) return -1;
    const cut = round3(c.inT + within);
    const right = Object.assign({}, c, { id: uid('c'), inT: cut });
    c.outT = cut;
    p.clips.splice(loc.index + 1, 0, right);
    return loc.index + 1;
  }

  function removeClip(p, i) {
    if (i < 0 || i >= p.clips.length) return false;
    const st = starts(p)[i]; const d = clipDur(p.clips[i]);
    p.clips.splice(i, 1);
    remapOverlays(p, st, st + d);
    return true;
  }

  // Вырезать участок [a, b) готового ролика (например, оговорку посередине)
  function cutRange(p, a, b) {
    a = round3(a); b = round3(b);
    if (!(b - a >= MIN_CLIP)) return false;
    splitAt(p, b); splitAt(p, a);
    const st = starts(p);
    const keep = [];
    p.clips.forEach((c, i) => { const s = st[i], e = s + clipDur(c); if (!(s >= a - 1e-6 && e <= b + 1e-6)) keep.push(c); });
    if (keep.length === p.clips.length) return false;
    p.clips = keep;
    remapOverlays(p, a, b);
    return true;
  }

  function moveClip(p, i, dir) {
    const j = i + dir;
    if (i < 0 || j < 0 || i >= p.clips.length || j >= p.clips.length) return false;
    [p.clips[i], p.clips[j]] = [p.clips[j], p.clips[i]];
    return true;
  }

  function trimClip(p, i, { inT, outT }) {
    const c = p.clips[i]; if (!c) return false;
    let a = inT == null ? c.inT : inT, b = outT == null ? c.outT : outT;
    a = clamp(a, 0, c.srcDur); b = clamp(b, 0, c.srcDur);
    if (b - a < MIN_CLIP) { if (inT != null && outT == null) a = b - MIN_CLIP; else b = a + MIN_CLIP; }
    c.inT = round3(clamp(a, 0, c.srcDur - MIN_CLIP)); c.outT = round3(clamp(b, MIN_CLIP, c.srcDur));
    clampOverlays(p);
    return true;
  }

  function setSpeed(p, i, s) {
    const c = p.clips[i]; if (!c) return false;
    c.speed = clamp(Number(s) || 1, 0.25, 4);
    clampOverlays(p);
    return true;
  }
  const setVolume = (p, i, v) => { const c = p.clips[i]; if (!c) return false; c.volume = clamp(Math.round(Number(v)) || 0, 0, 200); return true; };
  const setMute = (p, i, m) => { const c = p.clips[i]; if (!c) return false; c.mute = !!m; return true; };

  // ----- наложения -----
  const OVERLAY_TYPES = ['text', 'arrow', 'blur'];
  function addOverlay(p, type, at, props) {
    if (!OVERLAY_TYPES.includes(type)) return null;
    const T = total(p);
    if (T < MIN_OVERLAY) return null;
    const start = clamp(round3(at), 0, T - MIN_OVERLAY);
    const end = Math.min(T, round3(start + 3));
    const base = { text: { x: 0.1, y: 0.1, size: 0.07, color: '#ffffff', bg: true, text: 'Текст' },
      arrow: { x1: 0.2, y1: 0.7, x2: 0.45, y2: 0.45, color: '#ef4444', width: 0.008 },
      blur: { x: 0.3, y: 0.3, w: 0.3, h: 0.2, strength: 12 } }[type];
    const o = Object.assign({ id: uid('o'), type, start, end }, base, props || {});
    p.overlays.push(o);
    return o;
  }
  function updateOverlay(p, id, patch) {
    const o = p.overlays.find((x) => x.id === id); if (!o) return null;
    Object.assign(o, patch);
    const T = total(p);
    o.start = round3(clamp(o.start, 0, T)); o.end = round3(clamp(o.end, 0, T));
    if (o.end - o.start < MIN_OVERLAY) o.end = Math.min(T, o.start + MIN_OVERLAY);
    if (o.end - o.start < MIN_OVERLAY - 1e-9) o.start = Math.max(0, o.end - MIN_OVERLAY);
    for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (k in o) o[k] = clamp(o[k], -0.2, 1.2);
    if (o.type === 'blur') { o.w = clamp(o.w, 0.02, 1); o.h = clamp(o.h, 0.02, 1); o.strength = clamp(Math.round(o.strength), 2, 40); }
    if (o.type === 'text') { o.size = clamp(o.size, 0.02, 0.3); o.text = String(o.text == null ? '' : o.text).slice(0, 300); }
    return o;
  }
  const removeOverlay = (p, id) => { const n = p.overlays.length; p.overlays = p.overlays.filter((x) => x.id !== id); return p.overlays.length < n; };

  // Размер готового кадра: как у первого клипа, чётные стороны; height — ограничение высоты (0 = как есть)
  function frameSize(p, height) {
    const c = p.clips[0];
    let w = (c && c.w) || 1280, h = (c && c.h) || 720;
    if (height && h > height) { w = Math.round(w * height / h); h = height; }
    return { w: w - (w % 2), h: h - (h % 2) };
  }

  // Подготовка к показу таймлайна: блоки клипов с началом и длиной
  function layout(p) {
    const st = starts(p);
    return p.clips.map((c, i) => ({ id: c.id, start: st[i], dur: clipDur(c) }));
  }

  const api = { MIN_CLIP, MIN_OVERLAY, SPEEDS, OVERLAY_TYPES, newProject, makeClip, clipDur, total, starts, locate, addClip, splitAt, removeClip, cutRange,
    moveClip, trimClip, setSpeed, setVolume, setMute, addOverlay, updateOverlay, removeOverlay, clampOverlays, frameSize, layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VideoCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
