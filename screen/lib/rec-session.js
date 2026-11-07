'use strict';
// Запись экрана в главном процессе: выбор источника, скрытое окно рекордера, плавающая панель,
// запись кусков на диск, лимиты, конвертация ffmpeg, библиотека записей.
// Само видео снимает renderer/recorder-core.js в скрытом окне; здесь только оркестровка.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cap = require('./capture');
const { formatName, uniquePath } = require('./util');
const { recFolder, freeMB, limitReached, videoBitrate } = require('./recordings');

const NAME_TEMPLATE = 'Запись_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}';

function createRecSession(deps) {
  const { electron, store, recs, T, paths, showMain, getMainWindow, notify, onTrayChange, ff } = deps;
  const { BrowserWindow, ipcMain, desktopCapturer, screen, shell, session } = electron;

  const S = { state: 'idle', mode: null, id: null, tmp: null, ws: null, recWin: null, panel: null, bytes: 0, elapsedMs: 0, paused: false,
    maxMs: 0, progress: 0, pending: null, stopReason: null, ticks: 0, freeMb: Infinity, hidMain: false, info: null, warnings: [] };
  let waiters = [];

  const tmpDir = () => path.join(paths.userData, 'rec-tmp');
  const defaultShots = () => paths.defaultShots();
  const folder = () => recFolder(store.getSettings(), defaultShots());

  const publicState = () => ({ state: S.state, mode: S.mode, elapsedMs: S.elapsedMs, bytes: S.bytes, paused: S.paused,
    maxMs: S.maxMs, progress: S.progress, warnings: S.warnings.slice() });
  function broadcast() {
    const st = publicState();
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send('rec:state', st);
    if (S.panel && !S.panel.isDestroyed()) S.panel.webContents.send('rec:state', st);
    if (onTrayChange) onTrayChange(st);
  }
  function listChanged() {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send('rec:list', recs.list().length);
  }

  // ---- сообщения от окна рекордера ----
  const fromRecorder = (e) => !!(S.recWin && !S.recWin.isDestroyed() && e && e.sender === S.recWin.webContents);
  function waitFor(ch, ms) {
    return new Promise((resolve, reject) => {
      const w = { ch, resolve, reject, timer: setTimeout(() => { waiters = waiters.filter((x) => x !== w); reject(Object.assign(new Error('timeout:' + ch), { code: 'timeout' })); }, ms) };
      waiters.push(w);
    });
  }
  function settle(ch, data, isError) {
    for (const w of waiters.slice()) {
      if (isError || w.ch === ch) { clearTimeout(w.timer); waiters = waiters.filter((x) => x !== w); isError ? w.reject(Object.assign(new Error(data && data.message || 'recorder error'), { code: 'recorder', name: data && data.name })) : w.resolve(data); }
    }
  }
  function bind() {
    ipcMain.on('rec:ready', (e) => { if (fromRecorder(e)) settle('ready', {}); });
    ipcMain.on('rec:started', (e, d) => { if (fromRecorder(e)) settle('started', d); });
    ipcMain.on('rec:error', (e, d) => {
      if (!fromRecorder(e)) return;
      if (S.state === 'recording' || S.state === 'paused') { S.stopReason = 'error'; finish(); } else settle('error', d, true);
    });
    ipcMain.on('rec:warn', (e, d) => { if (fromRecorder(e) && d && d.code) { S.warnings.push(d.code); broadcast(); } });
    ipcMain.on('rec:ended', (e) => { if (!fromRecorder(e)) return; S.stopReason = S.stopReason || 'ended'; if (S.state === 'recording' || S.state === 'paused') stop(); });
    ipcMain.on('rec:chunk', (e, ab) => {
      if (!fromRecorder(e) || !S.ws) return;
      const buf = Buffer.from(ab);
      S.bytes += buf.length;
      S.ws.write(buf);
    });
    ipcMain.on('rec:tick', (e, d) => {
      if (!fromRecorder(e) || !d) return;
      S.elapsedMs = d.elapsedMs; S.paused = !!d.paused;
      S.state = S.paused ? 'paused' : 'recording';
      S.ticks++;
      if (S.ticks % 10 === 1) S.freeMb = freeMB(folder());
      broadcast();
      const why = limitReached({ elapsedMs: S.elapsedMs, bytes: S.bytes, freeMb: S.freeMb }, store.getSettings());
      if (why && !S.stopReason) { S.stopReason = why; stop(); }
    });
    ipcMain.on('rec:stopped', (e, d) => { if (fromRecorder(e)) { S.lastStopped = d; settle('stopped', d); } });
    ipcMain.on('rec:paused', (e) => { if (fromRecorder(e)) { S.paused = true; S.state = 'paused'; broadcast(); } });
    ipcMain.on('rec:resumed', (e) => { if (fromRecorder(e)) { S.paused = false; S.state = 'recording'; broadcast(); } });
    ipcMain.on('rec:panel', (e, action) => {
      if (!S.panel || S.panel.isDestroyed() || e.sender !== S.panel.webContents) return;
      if (action === 'stop') stop(); else if (action === 'pause') togglePause();
    });

    // обработчик системного выбора источника для getDisplayMedia
    if (session && session.defaultSession && session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const p = S.pending;
        if (!p) return callback({});
        callback(Object.assign({ video: p.source }, p.audio ? { audio: 'loopback' } : {}));
      }, { useSystemPicker: false });
    }
    if (session && session.defaultSession && session.defaultSession.setPermissionRequestHandler) {
      session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' || permission === 'display-capture'));
    }
  }

  // ---- источники ----
  async function pickScreenSource(display) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    let src = sources.find((s) => String(s.display_id) === String(display.id));
    if (!src) {
      const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
      src = sources[idx >= 0 && idx < sources.length ? idx : 0];
    }
    return src || null;
  }
  async function listWindows() {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    return sources.filter((s) => s.name && s.name !== T('app.name') && s.name !== 'Recorder').map((s) => ({ id: s.id, name: s.name }));
  }

  // ---- окна ----
  function makeRecorderWindow() {
    const w = new BrowserWindow({
      show: false, width: 320, height: 240, skipTaskbar: true,
      webPreferences: { preload: paths.recPreload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    });
    w.loadFile(path.join(paths.renderer, 'recorder.html'));
    return w;
  }
  function makePanel(display) {
    const b = display.workArea || display.bounds;
    const w = new BrowserWindow({
      width: 250, height: 54, x: Math.round(b.x + b.width / 2 - 125), y: b.y + 12,
      frame: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
      focusable: false, hasShadow: true, backgroundColor: '#15171c',
      webPreferences: { preload: paths.recPreload, contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    if (w.setContentProtection) w.setContentProtection(true);   // панель не попадает в запись
    w.loadFile(path.join(paths.renderer, 'rec-panel.html'));
    w.once('ready-to-show', () => { w.showInactive ? w.showInactive() : w.show(); broadcast(); });
    return w;
  }
  function cleanupWindows() {
    for (const k of ['recWin', 'panel']) {
      try { if (S[k] && !S[k].isDestroyed()) S[k].destroy(); } catch (_) {}
      S[k] = null;
    }
  }

  // ---- запуск ----
  async function start(opts = {}) {
    if (S.state !== 'idle') return { ok: false, error: 'busy' };
    S.state = 'starting'; S.warnings = []; S.stopReason = null; S.lastStopped = null; S.bytes = 0; S.elapsedMs = 0; S.paused = false; S.ticks = 0; S.progress = 0;
    broadcast();
    const s = store.getSettings();
    const mode = ['region', 'screen', 'window'].includes(opts.mode) ? opts.mode : s.recMode;
    S.mode = mode;
    const mainWin = getMainWindow();
    const wasVisible = !!(mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized());
    try {
      const dir = folder();
      fs.mkdirSync(dir, { recursive: true });
      if (s.recMinFreeMB > 0 && freeMB(dir) < s.recMinFreeMB) throw Object.assign(new Error('disk'), { code: 'disk' });

      let hwnd = null;
      if (mode === 'window' && !opts.sourceId) hwnd = await cap.getForegroundHwnd();
      if (wasVisible && s.recHideWindow) { mainWin.hide(); S.hidMain = true; await cap.sleep(280); }

      let display, source, crop = null, width = 0, height = 0;
      if (mode === 'region') {
        const shots = [];
        for (const d of screen.getAllDisplays()) shots.push({ display: d, image: await cap.grabDisplay(electron, d) });
        const r = await cap.selectRegion(electron, shots, path.join(paths.renderer, 'overlay.html'), paths.preload, T('rec.overlay.hint'), true);
        if (!r) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
        display = r.display;
        crop = { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h, dispW: display.bounds.width, dispH: display.bounds.height };
        source = await pickScreenSource(display);
        width = Math.round(r.rect.w * (display.scaleFactor || 1)); height = Math.round(r.rect.h * (display.scaleFactor || 1));
      } else if (mode === 'screen') {
        display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        source = await pickScreenSource(display);
        width = Math.round(display.size.width * (display.scaleFactor || 1)); height = Math.round(display.size.height * (display.scaleFactor || 1));
      } else {
        display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
        source = opts.sourceId ? wins.find((x) => x.id === opts.sourceId) : (hwnd && wins.find((x) => x.id.startsWith('window:' + hwnd + ':')));
        if (!source) source = wins.find((x) => x.name && x.name !== T('app.name'));
        width = 1920; height = 1080;
      }
      if (!source) throw Object.assign(new Error('source'), { code: 'source' });

      S.id = crypto.randomUUID();
      fs.mkdirSync(tmpDir(), { recursive: true });
      S.tmp = path.join(tmpDir(), S.id + '.webm');
      S.ws = fs.createWriteStream(S.tmp);
      S.maxMs = s.recMaxMinutes > 0 ? s.recMaxMinutes * 60000 : 0;
      S.pending = { source: { id: source.id, name: source.name }, audio: s.recSystemAudio };

      S.recWin = makeRecorderWindow();
      await waitFor('ready', 15000);
      const cfg = {
        fps: s.recFps, bitrate: videoBitrate(s.recQuality, width, height, s.recFps), cursor: s.recCursor,
        sysAudio: s.recSystemAudio, sysGain: s.recSystemGain, mic: s.recMic, micGain: s.recMicGain, micDevice: s.recMicDevice,
        cam: s.recWebcam, camDevice: s.recCamDevice, camCorner: s.recCamCorner, camSize: s.recCamSize, camShape: s.recCamShape, crop
      };
      const started = waitFor('started', 20000);
      S.recWin.webContents.send('rec:cmd', 'start', cfg);
      S.info = await started;
      S.pending = null;
      S.state = 'recording';
      S.startDisplay = display;
      if (s.recPanel) S.panel = makePanel(display);
      broadcast();
      return { ok: true };
    } catch (e) {
      await abort();
      if (S.hidMain || wasVisible) showMain('record');
      S.hidMain = false;
      if (e && e.code !== 'cancelled') {
        const known = ['disk', 'source', 'timeout'].includes(e.code);
        notify(T('rec.fail.title'), known ? T('rec.err.' + e.code) : (e && e.message) || '');
      }
      return { ok: false, error: (e && e.code) || (e && e.message) };
    }
  }

  async function abort() {
    cleanupWindows();
    try { if (S.ws) { S.ws.end(); } } catch (_) {}
    const tmp = S.tmp;
    S.ws = null; S.tmp = null; S.pending = null; S.state = 'idle'; S.paused = false;
    waiters.forEach((w) => clearTimeout(w.timer)); waiters = [];
    if (tmp) setTimeout(() => { try { fs.unlinkSync(tmp); } catch (_) {} }, 300);
    broadcast();
  }

  function togglePause() {
    if (!S.recWin || S.recWin.isDestroyed()) return { ok: false };
    if (S.state === 'recording') { S.recWin.webContents.send('rec:cmd', 'pause'); return { ok: true }; }
    if (S.state === 'paused') { S.recWin.webContents.send('rec:cmd', 'resume'); return { ok: true }; }
    return { ok: false };
  }

  async function stop() {
    if (S.state !== 'recording' && S.state !== 'paused') return { ok: false };
    S.state = 'finishing'; broadcast();
    return finish();
  }

  // ---- завершение: куски -> готовый файл ----
  async function finish() {
    const s = store.getSettings();
    let result = null;
    try {
      const stopped = S.lastStopped ? Promise.resolve(S.lastStopped) : waitFor('stopped', 30000);
      if (S.recWin && !S.recWin.isDestroyed()) S.recWin.webContents.send('rec:cmd', 'stop');
      result = await stopped;
    } catch (_) { /* окно рекордера не ответило: сохраняем то, что уже на диске */ }
    await new Promise((res) => { if (S.ws) S.ws.end(res); else res(); });
    cleanupWindows();
    S.state = 'finishing'; S.progress = 0; broadcast();
    const tmp = S.tmp, id = S.id, mode = S.mode, why = S.stopReason;
    const wasHid = S.hidMain; S.hidMain = false;
    let entry = null;
    try {
      if (!tmp || !fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) throw Object.assign(new Error('empty'), { code: 'empty' });
      entry = await makeEntry(tmp, { id, mode, result, s });
      fs.unlinkSync(tmp);
    } catch (e) {
      notify(T('rec.fail.title'), e && e.code === 'empty' ? T('rec.err.empty') : (e && e.message) || '');
    }
    S.ws = null; S.tmp = null; S.state = 'idle'; S.progress = 0; S.paused = false; S.elapsedMs = 0; S.bytes = 0; S.mode = null;
    broadcast(); listChanged();
    if (entry) {
      if (s.recNotify) notify(T('rec.done.title'), T('rec.done.body', { name: path.basename(entry.file) }) + (why && ['time', 'size', 'disk'].includes(why) ? ' ' + T('rec.stopped.' + why) : ''), () => showMain('record'));
    }
    if (wasHid || entry) showMain('record');
    return { ok: !!entry, entry };
  }

  // Готовый файл из «сырого» WebM. При сбое конвертации запись не теряется: остаётся WebM.
  async function makeEntry(tmp, { id, mode, result, s }) {
    const dir = folder();
    fs.mkdirSync(dir, { recursive: true });
    const base = formatName(NAME_TEMPLATE, new Date());
    const want = s.recFormat === 'webm' ? 'webm' : 'mp4';
    let fmt = want;
    let out = uniquePath(dir, base, '.' + want, (p) => fs.existsSync(p));
    const hasAudio = result ? !!result.hasAudio : true;
    const expectSec = result ? result.elapsedMs / 1000 : 0;
    try {
      await ff.convertRecording(tmp, out, { format: want, quality: s.recQuality, hasAudio }, { onProgress: (sec) => { S.progress = expectSec ? Math.min(1, sec / expectSec) : 0; broadcast(); } });
    } catch (e) {
      try { fs.unlinkSync(out); } catch (_) {}
      fmt = 'webm';
      out = uniquePath(dir, base, '.webm', (p) => fs.existsSync(p));
      fs.copyFileSync(tmp, out);
      notify(T('rec.fail.title'), T('rec.err.convert'));
    }
    const info = (await ff.probe(out)) || {};
    const entry = {
      id, file: out, createdAt: new Date().toISOString(), mode, format: fmt,
      duration: info.duration || (result ? result.elapsedMs / 1000 : 0), width: info.width || (result && result.width) || 0, height: info.height || (result && result.height) || 0,
      hasAudio: info.hasAudio != null ? info.hasAudio : hasAudio, size: fs.statSync(out).size
    };
    try { await ff.thumbnail(out, path.join(paths.thumbDir, 'rec-' + id + '.jpg'), Math.min(1, entry.duration / 2)); } catch (_) {}
    recs.add(entry);
    return entry;
  }

  // Запись, оставшаяся после сбоя или аварийного закрытия, возвращается в библиотеку
  async function recoverLeftovers() {
    let names = [];
    try { names = fs.readdirSync(tmpDir()).filter((n) => /\.webm$/.test(n)); } catch (_) { return 0; }
    let n = 0;
    for (const name of names) {
      const f = path.join(tmpDir(), name);
      try {
        if (fs.statSync(f).size < 1000) { fs.unlinkSync(f); continue; }
        const dir = folder(); fs.mkdirSync(dir, { recursive: true });
        const out = uniquePath(dir, T('rec.recovered') + '_' + formatName('{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}', new Date()), '.webm', (p) => fs.existsSync(p));
        await ff.run(['-i', f, '-c', 'copy', out]);
        const info = (await ff.probe(out)) || {};
        const id = crypto.randomUUID();
        recs.add({ id, file: out, createdAt: new Date().toISOString(), mode: 'recovered', format: 'webm', duration: info.duration || 0,
          width: info.width || 0, height: info.height || 0, hasAudio: !!info.hasAudio, size: fs.statSync(out).size });
        try { await ff.thumbnail(out, path.join(paths.thumbDir, 'rec-' + id + '.jpg'), 0.5); } catch (_) {}
        fs.unlinkSync(f); n++;
      } catch (_) { /* оставляем файл как есть: попробуем в следующий раз */ }
    }
    if (n) listChanged();
    return n;
  }

  // ---- IPC для интерфейса ----
  function register() {
    bind();
    ipcMain.handle('rec:state', () => publicState());
    ipcMain.handle('rec:start', (_e, o) => start(o || {}));
    ipcMain.handle('rec:stop', () => stop());
    ipcMain.handle('rec:pause', () => togglePause());
    ipcMain.handle('rec:windows', () => listWindows());
    ipcMain.handle('rec:list', () => recs.list());
    ipcMain.handle('rec:thumb', (_e, id) => {
      const e = recs.find(id); if (!e) return null;
      try { return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(paths.thumbDir, 'rec-' + id + '.jpg')).toString('base64'); } catch (_) { return null; }
    });
    ipcMain.handle('rec:play', async (_e, id) => { const e = recs.find(id); if (!e || !fs.existsSync(e.file)) return false; await shell.openPath(e.file); return true; });
    ipcMain.handle('rec:show', (_e, id) => { const e = recs.find(id); if (!e) return false; shell.showItemInFolder(e.file); return true; });
    ipcMain.handle('rec:openFolder', async () => { const d = folder(); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
    ipcMain.handle('rec:delete', async (_e, id) => {
      const e = recs.find(id); if (!e) return false;
      try { if (fs.existsSync(e.file)) await shell.trashItem(e.file); } catch (_) { return false; }
      try { fs.unlinkSync(path.join(paths.thumbDir, 'rec-' + id + '.jpg')); } catch (_) {}
      recs.remove(id); listChanged(); return true;
    });
    ipcMain.handle('rec:rename', (_e, id, name) => {
      const e = recs.find(id); if (!e) return null;
      const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120);
      if (!clean) return null;
      const next = path.join(path.dirname(e.file), clean + path.extname(e.file));
      if (next === e.file) return e;
      if (fs.existsSync(next)) return null;
      try { fs.renameSync(e.file, next); } catch (_) { return null; }
      return recs.update(id, { file: next });
    });
  }

  const isActive = () => S.state !== 'idle';
  return { register, start, stop, togglePause, isActive, state: publicState, recoverLeftovers, listWindows, _S: S };
}

module.exports = { createRecSession, NAME_TEMPLATE };
