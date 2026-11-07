'use strict';
// Видеоредактор в главном процессе: выбор файлов, экспорт через ffmpeg с прогрессом, добавление результата в библиотеку.
// Файлы, которые можно монтировать: записи из библиотеки и видео, выбранные пользователем в диалоге.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { uniquePath } = require('./util');
const { buildExport } = require('./video-export');
const V = require('../renderer/video-core');

const VIDEO_EXT = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.gif'];
const OUT_EXT = { mp4: '.mp4', webm: '.webm', gif: '.gif' };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function createVideoSession(deps) {
  const { electron, recs, T, paths, getMainWindow, notify, ff, listChanged } = deps;
  const { ipcMain, dialog, nativeImage } = electron;
  const allowed = new Set();
  let current = null;       // { signal }

  const ok = (f) => allowed.has(f) || !!recs.findByFile(f);

  async function describe(file) {
    const info = await ff.probe(file);
    if (!info || !info.hasVideo) return null;
    allowed.add(file);
    return { src: file, name: path.basename(file), dur: info.duration, w: info.width, h: info.height, fps: info.fps || 30, hasAudio: info.hasAudio, url: pathToFileURL(file).href };
  }

  // Проект приходит из интерфейса: берём только известные поля нужного типа и только разрешённые файлы
  function cleanProject(raw) {
    if (!raw || !Array.isArray(raw.clips) || raw.clips.length === 0 || raw.clips.length > 300) throw Object.assign(new Error('bad project'), { code: 'bad' });
    const clips = raw.clips.map((c) => {
      if (!c || typeof c.src !== 'string' || !ok(c.src) || !fs.existsSync(c.src)) throw Object.assign(new Error('bad source'), { code: 'source' });
      if (![c.srcDur, c.inT, c.outT, c.speed, c.volume].every(isNum)) throw Object.assign(new Error('bad clip'), { code: 'bad' });
      return { id: String(c.id || ''), src: c.src, srcDur: c.srcDur, inT: Math.max(0, c.inT), outT: Math.min(c.srcDur, c.outT), speed: Math.min(4, Math.max(0.25, c.speed)),
        volume: Math.min(200, Math.max(0, c.volume)), mute: !!c.mute, hasAudio: !!c.hasAudio, w: c.w | 0, h: c.h | 0, fps: Number(c.fps) || 0 };
    });
    const overlays = (Array.isArray(raw.overlays) ? raw.overlays : []).slice(0, 200).filter((o) => o && V.OVERLAY_TYPES.includes(o.type) && isNum(o.start) && isNum(o.end)).map((o) => {
      const r = { id: String(o.id), type: o.type, start: o.start, end: o.end };
      for (const k of ['x', 'y', 'w', 'h', 'strength']) if (isNum(o[k])) r[k] = o[k];
      return r;
    });
    return { clips, overlays };
  }

  async function exportProject(payload) {
    if (current) return { ok: false, error: 'busy' };
    const win = getMainWindow();
    const sendP = (p) => { if (win && !win.isDestroyed()) win.webContents.send('vid:progress', p); };
    const tmp = path.join(paths.userData, 'vid-tmp', crypto.randomUUID());
    try {
      const project = cleanProject(payload && payload.project);
      const o = (payload && payload.opts) || {};
      const format = ['mp4', 'webm', 'gif'].includes(o.format) ? o.format : 'mp4';
      const first = project.clips[0].src;
      const base = path.basename(first, path.extname(first)) + '_' + T('vid.suffix');
      const r = await dialog.showSaveDialog(win, {
        defaultPath: uniquePath(path.dirname(first), base, OUT_EXT[format], (p) => fs.existsSync(p)),
        filters: [{ name: format.toUpperCase(), extensions: [OUT_EXT[format].slice(1)] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
      let out = r.filePath;
      if (path.extname(out).toLowerCase() !== OUT_EXT[format]) out += OUT_EXT[format];
      // исходный файл никогда не перезаписываем
      if (project.clips.some((c) => path.resolve(c.src).toLowerCase() === path.resolve(out).toLowerCase())) {
        out = uniquePath(path.dirname(out), path.basename(out, path.extname(out)) + '_' + T('vid.suffix'), OUT_EXT[format], (p) => fs.existsSync(p));
      }
      fs.mkdirSync(tmp, { recursive: true });
      const overlayFiles = {};
      const pngs = (payload && payload.overlayPng) || {};
      for (const ov of project.overlays) {
        const bytes = pngs[ov.id];
        if (ov.type !== 'blur' && bytes && bytes.length && bytes.length < 40 * 1048576) {
          const f = path.join(tmp, 'ov-' + crypto.randomBytes(4).toString('hex') + '.png');
          fs.writeFileSync(f, Buffer.from(bytes));
          overlayFiles[ov.id] = f;
        }
      }
      const script = path.join(tmp, 'graph.ffs');
      const build = buildExport(project, { format, height: [0, 1080, 720, 480].includes(o.height) ? o.height : 0, fps: o.fps, quality: o.quality, gifFps: o.gifFps, gifWidth: o.gifWidth, out, scriptPath: script, overlayFiles });
      fs.writeFileSync(script, build.filter);
      current = { signal: {} };
      sendP({ state: 'running', p: 0 });
      await ff.run(build.args, { signal: current.signal, onProgress: (sec) => sendP({ state: 'running', p: build.duration ? Math.min(1, sec / build.duration) : 0 }) });
      const info = (await ff.probe(out)) || {};
      const id = crypto.randomUUID();
      const entry = { id, file: out, createdAt: new Date().toISOString(), mode: 'edit', format, duration: info.duration || build.duration, width: info.width || build.width, height: info.height || build.height,
        hasAudio: !!info.hasAudio, size: fs.statSync(out).size };
      try { await ff.thumbnail(out, path.join(paths.thumbDir, 'rec-' + id + '.jpg'), Math.min(1, entry.duration / 2)); } catch (_) {}
      recs.add(entry);
      if (listChanged) listChanged();
      sendP({ state: 'done', p: 1 });
      notify(T('vid.done.title'), T('vid.done.body', { name: path.basename(out) }));
      return { ok: true, file: out, entry };
    } catch (e) {
      const code = (e && e.code) || 'error';
      sendP({ state: code === 'cancelled' ? 'cancelled' : 'error', p: 0 });
      if (code !== 'cancelled' && code !== 'busy') notify(T('vid.fail.title'), code === 'ffmpeg' ? T('vid.err.ffmpeg') : code === 'noffmpeg' ? T('vid.err.noffmpeg') : code === 'source' ? T('vid.err.source') : (e && e.message) || '');
      return { ok: false, error: code, message: e && e.message };
    } finally {
      current = null;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    }
  }

  function register() {
    ipcMain.handle('vid:pick', async () => {
      const win = getMainWindow();
      const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video', extensions: VIDEO_EXT.map((x) => x.slice(1)) }] });
      if (r.canceled) return [];
      const out = [];
      for (const f of r.filePaths.slice(0, 20)) { if (VIDEO_EXT.includes(path.extname(f).toLowerCase())) { const d = await describe(f); if (d) out.push(d); } }
      return out;
    });
    ipcMain.handle('vid:fromLibrary', async (_e, id) => {
      const e = recs.find(id);
      if (!e || !fs.existsSync(e.file)) return null;
      return describe(e.file);
    });
    ipcMain.handle('vid:export', (_e, payload) => exportProject(payload));
    // Кадр исходника как PNG: canvas с video из file:// «загрязняется» и не даёт сохранить картинку, поэтому кадр достаёт ffmpeg
    ipcMain.handle('vid:frame', async (_e, src, time) => {
      if (typeof src !== 'string' || !ok(src) || !fs.existsSync(src) || !isNum(time)) return null;
      const dir = path.join(paths.userData, 'vid-tmp'); fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, 'frame-' + crypto.randomBytes(5).toString('hex') + '.png');
      try { await ff.frame(src, out, Math.max(0, time)); return new Uint8Array(fs.readFileSync(out)); } catch (_) { return null; } finally { try { fs.rmSync(out, { force: true }); } catch (_) {} }
    });
    ipcMain.handle('vid:cancel', () => { if (current && current.signal.cancel) { current.signal.cancel(); return true; } return false; });
  }

  return { register, exportProject, describe, _allowed: allowed };
}

module.exports = { createVideoSession, VIDEO_EXT };
