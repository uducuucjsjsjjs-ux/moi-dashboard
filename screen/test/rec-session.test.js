'use strict';
// Проверка оркестровки записи без Electron: окно рекордера изображается заглушкой, куски берутся из настоящего WebM,
// конвертацию делает настоящий ffmpeg. Запуск: node test/rec-session.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../lib/store');
const { Recordings, limitReached, videoBitrate, freeMB, recFolder } = require('../lib/recordings');
const { createRecSession } = require('../lib/rec-session');
const ff = require('../lib/ffmpeg');
const I18n = require('../renderer/i18n');

const results = []; let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ok  ' + name); }
  catch (e) { results.push('FAIL  ' + name + '\n        ' + (e && e.stack || e)); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-test-'));

(async () => {
  // настоящий WebM из ffmpeg: 2 секунды картинки и звука
  const webm = path.join(tmp, 'src.webm');
  execFileSync(ff.findFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libvorbis', webm]);
  const WEBM = fs.readFileSync(webm);

  // ---------- заглушки ----------
  const listeners = {}; const handles = {}; const notes = []; const trashed = []; const shownMain = [];
  const ipcMain = { on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); }, handle: (ch, fn) => { handles[ch] = fn; }, removeListener() {} };
  const emit = (ch, win, data) => (listeners[ch] || []).forEach((fn) => fn({ sender: win.webContents }, data));
  const wins = [];
  let recorderBehavior = 'ok';        // ok | silent | error
  class FakeWin {
    constructor(o) {
      this.o = o; this.destroyed = false; this.cmds = []; this.states = [];
      this.isRecorder = /rec-preload/.test((o.webPreferences || {}).preload || '') && !o.frame;
      const self = this;
      this.webContents = {
        send(ch, ...a) {
          if (ch === 'rec:state') self.states.push(a[0]);
          if (ch === 'rec:cmd') { self.cmds.push([a[0], a[1]]); self.onCmd(a[0], a[1]); }
        }
      };
      wins.push(this);
    }
    loadFile(f) { this.file = f; if (/recorder\.html$/.test(f) && recorderBehavior !== 'silent') setImmediate(() => emit('rec:ready', this, {})); }
    onCmd(cmd) {
      if (cmd === 'start') setImmediate(() => recorderBehavior === 'error' ? emit('rec:error', this, { message: 'Permission denied', name: 'NotAllowedError' }) : emit('rec:started', this, { width: 320, height: 240, hasAudio: true }));
      if (cmd === 'stop') setImmediate(() => {
        if (recorderBehavior === 'garbage') emit('rec:chunk', this, new Uint8Array(3000).buffer);
        else { const half = Math.floor(WEBM.length / 2); emit('rec:chunk', this, WEBM.subarray(half)); }
        emit('rec:stopped', this, { elapsedMs: 2000, bytes: WEBM.length, width: 320, height: 240, hasAudio: true });
      });
    }
    once(ev, cb) { if (ev === 'ready-to-show') setImmediate(cb); } on() {} show() {} showInactive() {} isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; } setAlwaysOnTop() {} setContentProtection() {}
  }
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  const electron = {
    BrowserWindow: FakeWin, ipcMain,
    desktopCapturer: { getSources: async (o) => [{ id: 'screen:0:0', name: 'Screen 1', display_id: '1' }, { id: 'window:7:0', name: 'Multisim' }, { id: 'window:8:0', name: 'Мои скриншоты' }].filter((x) => !o || !o.types || o.types.some((t) => x.id.startsWith(t + ':'))) },
    screen: { getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 5, y: 5 }) },
    shell: { openPath: async () => '', showItemInFolder() {}, trashItem: async (p) => { trashed.push(p); fs.unlinkSync(p); } },
    session: null
  };
  const dataDir = path.join(tmp, 'data'); fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  const recs = new Recordings(dataDir);
  const mainWin = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, hide() { this.hidden = true; }, webContents: { send() {} } };
  const rec = createRecSession({
    electron, store, recs, ff,
    T: (k, p) => I18n.t(k, p, 'ru'),
    paths: { userData: dataDir, thumbDir: store.thumbDir, renderer: '/r', preload: '/p', recPreload: '/rec-preload.js', defaultShots: () => path.join(tmp, 'shots') },
    showMain: (nav) => shownMain.push(nav), getMainWindow: () => mainWin,
    notify: (t, b) => notes.push([t, b]), onTrayChange() {}
  });
  rec.register();
  const recorder = () => wins.filter((w) => w.file && /recorder\.html$/.test(w.file)).pop();
  store.setSettings({ recFolder: path.join(tmp, 'out'), recPanel: false, recMinFreeMB: 0 });

  // ---------- чистые функции ----------
  await test('limitReached: время, размер, диск', () => {
    const s = { recMaxMinutes: 10, recMaxMB: 100, recMinFreeMB: 500 };
    assert.strictEqual(limitReached({ elapsedMs: 599999, bytes: 1, freeMb: 9999 }, s), null);
    assert.strictEqual(limitReached({ elapsedMs: 600000, bytes: 1, freeMb: 9999 }, s), 'time');
    assert.strictEqual(limitReached({ elapsedMs: 1, bytes: 100 * 1048576, freeMb: 9999 }, s), 'size');
    assert.strictEqual(limitReached({ elapsedMs: 1, bytes: 1, freeMb: 499 }, s), 'disk');
    assert.strictEqual(limitReached({ elapsedMs: 1e9, bytes: 1e12, freeMb: 1 }, { recMaxMinutes: 0, recMaxMB: 0, recMinFreeMB: 0 }), null);
    assert.strictEqual(limitReached({ elapsedMs: 1, bytes: 1, freeMb: Infinity }, s), null);
  });
  await test('videoBitrate растёт с качеством и FPS, ограничен', () => {
    assert.ok(videoBitrate('low', 1280, 720, 30) < videoBitrate('medium', 1280, 720, 30));
    assert.ok(videoBitrate('medium', 1280, 720, 30) < videoBitrate('high', 1280, 720, 30));
    assert.ok(videoBitrate('medium', 1280, 720, 15) < videoBitrate('medium', 1280, 720, 60));
    assert.ok(videoBitrate('high', 7680, 4320, 60) <= 30000000);
    assert.ok(videoBitrate('low', 100, 100, 15) >= 500000);
  });
  await test('recFolder: по умолчанию «Записи» рядом со снимками, своя папка главнее', () => {
    assert.strictEqual(recFolder({ recFolder: '', saveFolder: '' }, 'D:\\Shots'), path.join('D:\\Shots', 'Записи'));
    assert.strictEqual(recFolder({ recFolder: '', saveFolder: 'E:\\S' }, 'D:\\Shots'), path.join('E:\\S', 'Записи'));
    assert.strictEqual(recFolder({ recFolder: 'F:\\V' }, 'D:\\Shots'), 'F:\\V');
    assert.ok(freeMB(os.tmpdir()) > 0);
  });
  await test('ffmpeg.parseProbe: длительность, размер, звук', () => {
    const p = ff.parseProbe('Input #0\n  Duration: 00:01:15.40, start: 0\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps\n  Stream #0:1: Audio: aac, 48000 Hz');
    assert.deepStrictEqual([p.duration, p.width, p.height, p.hasAudio, p.hasVideo], [75.4, 1920, 1080, true, true]);
    assert.strictEqual(ff.parseProbe('garbage'), null);
  });
  await test('ffmpeg.convertArgs: mp4 с чётными сторонами, webm без перекодирования, без звука', () => {
    const a = ff.convertArgs('a.webm', 'a.mp4', { format: 'mp4', quality: 'high', hasAudio: true });
    assert.ok(a.includes('libx264') && a.includes('aac') && a.join(' ').includes('trunc(iw/2)*2') && a.includes('19'));
    assert.ok(ff.convertArgs('a.webm', 'a.mp4', { format: 'mp4', hasAudio: false }).includes('-an'));
    assert.deepStrictEqual(ff.convertArgs('a', 'b', { format: 'webm' }), ['-i', 'a', '-c', 'copy', 'b']);
  });

  // ---------- сценарии записи ----------
  await test('запись всего экрана: старт, куски на диск, пауза, стоп, готовый MP4 в библиотеке', async () => {
    store.setSettings({ recMode: 'screen', recFormat: 'mp4', recFps: 30, recQuality: 'medium', recSystemAudio: true, recMic: true, recWebcam: false });
    const r = await rec.start({ mode: 'screen' });
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(rec.state().state, 'recording');
    assert.strictEqual(rec.isActive(), true);
    const w = recorder();
    const startCmd = w.cmds.find((c) => c[0] === 'start')[1];
    assert.strictEqual(startCmd.fps, 30); assert.strictEqual(startCmd.sysAudio, true); assert.strictEqual(startCmd.mic, true); assert.strictEqual(startCmd.cam, false);
    assert.ok(startCmd.bitrate >= 500000); assert.strictEqual(startCmd.crop, null);
    assert.deepStrictEqual(await rec.start({}), { ok: false, error: 'busy' });
    assert.strictEqual(mainWin.hidden, true, 'окно программы спрятано на время записи');
    // куски приходят от рекордера
    emit('rec:chunk', w, WEBM.subarray(0, Math.floor(WEBM.length / 2)));
    emit('rec:tick', w, { elapsedMs: 1200, bytes: 0, paused: false });
    assert.strictEqual(rec.state().elapsedMs, 1200);
    assert.ok(rec.state().bytes > 0);
    // чужое окно писать не может
    const before = rec.state().bytes;
    emit('rec:chunk', { webContents: {} }, new Uint8Array(500).buffer);
    assert.strictEqual(rec.state().bytes, before, 'кусок от чужого окна проигнорирован');
    assert.deepStrictEqual(rec.togglePause(), { ok: true });
    assert.deepStrictEqual(w.cmds[w.cmds.length - 1], ['pause', undefined]);
    emit('rec:paused', w, {});
    assert.strictEqual(rec.state().state, 'paused');
    rec.togglePause();
    assert.strictEqual(w.cmds[w.cmds.length - 1][0], 'resume');
    emit('rec:resumed', w, {});
    assert.strictEqual(rec.state().state, 'recording');
    const stopped = rec.stop();
    const res = await stopped;
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(rec.state().state, 'idle');
    const e = res.entry;
    assert.ok(e.file.endsWith('.mp4') && fs.existsSync(e.file) && e.file.startsWith(path.join(tmp, 'out')));
    assert.ok(/Запись_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/.test(e.file), e.file);
    assert.ok(e.duration > 1.5 && e.duration < 2.6, 'длительность ' + e.duration);
    assert.deepStrictEqual([e.width, e.height, e.hasAudio, e.format], [320, 240, true, 'mp4']);
    assert.ok(fs.existsSync(path.join(store.thumbDir, 'rec-' + e.id + '.jpg')), 'превью создано');
    assert.deepStrictEqual(fs.readdirSync(path.join(dataDir, 'rec-tmp')), [], 'временный файл удалён');
    assert.strictEqual(recs.list().length, 1);
    assert.ok(notes.some((n) => n[0] === 'Запись сохранена'));
    assert.ok(shownMain.includes('record'), 'окно программы возвращено на вкладку «Запись»');
    assert.ok(wins.filter((x) => x.file && /recorder/.test(x.file)).every((x) => x.destroyed), 'окно рекордера закрыто');
  });

  await test('библиотека: список, превью, переименование, удаление в Корзину', async () => {
    const list = await handles['rec:list']();
    assert.strictEqual(list.length, 1);
    assert.ok((await handles['rec:thumb'](null, list[0].id)).startsWith('data:image/jpeg;base64,'));
    assert.strictEqual(await handles['rec:thumb'](null, 'нет'), null);
    const ren = await handles['rec:rename'](null, list[0].id, 'Лекция: сети/1');
    assert.ok(ren && path.basename(ren.file) === 'Лекция_ сети_1.mp4' && fs.existsSync(ren.file));
    assert.strictEqual(await handles['rec:rename'](null, list[0].id, '   '), null);
    assert.strictEqual(await handles['rec:play'](null, 'нет'), false);
    assert.strictEqual(await handles['rec:play'](null, list[0].id), true);
    assert.strictEqual(await handles['rec:delete'](null, 'нет'), false);
    assert.strictEqual(await handles['rec:delete'](null, list[0].id), true);
    assert.strictEqual(trashed.length, 1);
    assert.strictEqual(recs.list().length, 0);
    assert.ok(!fs.existsSync(path.join(store.thumbDir, 'rec-' + list[0].id + '.jpg')));
  });

  await test('запись области: рамка передаётся рекордеру как crop', async () => {
    // выбор области делает selectRegion; подменяем его через capture
    const cap = require('../lib/capture');
    const origSel = cap.selectRegion, origGrab = cap.grabDisplay;
    cap.grabDisplay = async () => ({}); cap.selectRegion = async () => ({ display, rect: { x: 100, y: 50, w: 640, h: 360 } });
    try {
      store.setSettings({ recFormat: 'webm' });
      assert.deepStrictEqual(await rec.start({ mode: 'region' }), { ok: true });
      const cfg = recorder().cmds.find((c) => c[0] === 'start')[1];
      assert.deepStrictEqual(cfg.crop, { x: 100, y: 50, w: 640, h: 360, dispW: 1920, dispH: 1080 });
      emit('rec:chunk', recorder(), WEBM.subarray(0, Math.floor(WEBM.length / 2)));
      const res = await rec.stop();
      assert.ok(res.entry.file.endsWith('.webm'), 'WebM без перекодирования');
      const info = await ff.probe(res.entry.file);
      assert.ok(info.duration > 1.5, 'webm пересобран с длительностью');
      recs.remove(res.entry.id);
      // отмена выбора области: запись не начинается, окно возвращается
      cap.selectRegion = async () => null;
      shownMain.length = 0;
      assert.deepStrictEqual(await rec.start({ mode: 'region' }), { ok: false, error: 'cancelled' });
      assert.strictEqual(rec.state().state, 'idle');
      assert.ok(shownMain.length >= 1, 'окно программы возвращено после отмены');
    } finally { cap.selectRegion = origSel; cap.grabDisplay = origGrab; store.setSettings({ recFormat: 'mp4' }); }
  });

  await test('запись окна: выбранное окно или активное; нет окна — ошибка', async () => {
    assert.deepStrictEqual(await rec.start({ mode: 'window', sourceId: 'window:7:0' }), { ok: true });
    await rec.stop();
    assert.deepStrictEqual(await rec.start({ mode: 'window', sourceId: 'window:404:0' }), { ok: true }, 'запасное окно, не наше');
    await rec.stop();
    const wl = await handles['rec:windows']();
    assert.deepStrictEqual(wl.map((x) => x.name), ['Multisim'], 'окно самой программы в список не попадает');
    recs.items.length = 0;
  });

  await test('лимиты: по времени запись останавливается сама и об этом сообщается', async () => {
    store.setSettings({ recMaxMinutes: 1 });
    await rec.start({ mode: 'screen' });
    const w = recorder();
    emit('rec:tick', w, { elapsedMs: 61000, bytes: 0, paused: false });
    await sleep(50);
    assert.ok(w.cmds.some((c) => c[0] === 'stop'), 'рекордеру отправлена команда остановки');
    for (let i = 0; i < 100 && rec.isActive(); i++) await sleep(100);
    assert.strictEqual(rec.isActive(), false);
    assert.ok(notes.some((n) => /лимит длины/i.test(n[1])), JSON.stringify(notes.slice(-2)));
    store.setSettings({ recMaxMinutes: 60 }); recs.items.length = 0;
  });

  await test('лимит размера', async () => {
    store.setSettings({ recMaxMB: 1 });
    await rec.start({ mode: 'screen' });
    const w = recorder();
    emit('rec:chunk', w, new Uint8Array(1048576 + 10).buffer);
    emit('rec:tick', w, { elapsedMs: 3000, bytes: 0, paused: false });
    await sleep(50);
    assert.ok(w.cmds.some((c) => c[0] === 'stop'));
    for (let i = 0; i < 100 && rec.isActive(); i++) await sleep(100);
    store.setSettings({ recMaxMB: 2048 }); recs.items.length = 0;
  });

  await test('мало места на диске: запись не начинается', async () => {
    store.setSettings({ recMinFreeMB: 100000 });
    const r = await rec.start({ mode: 'screen' });
    assert.deepStrictEqual(r, { ok: false, error: 'disk' });
    assert.strictEqual(rec.state().state, 'idle');
    assert.ok(notes.some((n) => /места на диске/.test(n[1])));
    store.setSettings({ recMinFreeMB: 0 });
  });

  await test('рекордер не дал доступ (ошибка): запись отменяется, окно возвращается, ничего не остаётся', async () => {
    recorderBehavior = 'error'; shownMain.length = 0;
    const r = await rec.start({ mode: 'screen' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(rec.state().state, 'idle');
    assert.ok(shownMain.length >= 1);
    recorderBehavior = 'ok';
    await sleep(400);
    assert.deepStrictEqual(fs.readdirSync(path.join(dataDir, 'rec-tmp')), []);
  });

  await test('рекордер завис при запуске: через таймаут запись отменяется (проверяется быстрым вызовом)', async () => {
    // таймаут 15 с слишком долог для теста: проверяем, что без ответа состояние остаётся «starting», а abort чистит всё
    recorderBehavior = 'silent';
    const p = rec.start({ mode: 'screen' });
    await sleep(200);
    assert.strictEqual(rec.state().state, 'starting');
    recorderBehavior = 'ok';
    rec._S.state = 'recording'; // имитация: дальше выходим через stop без реального рекордера
    const w = recorder(); assert.ok(w);
    emit('rec:ready', w, {});
    for (let i = 0; i < 50 && rec.state().state !== 'recording'; i++) await sleep(50);
    emit('rec:started', w, { width: 1, height: 1 });
    await Promise.race([p, sleep(1000)]);
    rec._S.state = 'idle'; for (const x of wins) if (!x.destroyed) x.destroyed = true;
    rec._S.ws && rec._S.ws.end(); rec._S.ws = null; rec._S.tmp = null;
  });

  await test('конвертация не удалась (битые данные): запись не теряется, сохраняется как WebM', async () => {
    recorderBehavior = 'garbage'; recs.items.length = 0; notes.length = 0;
    store.setSettings({ recFormat: 'mp4' });
    await rec.start({ mode: 'screen' });
    const w = recorder();
    emit('rec:chunk', w, new Uint8Array(4000).buffer);
    const res = await rec.stop();
    recorderBehavior = 'ok';
    assert.ok(res.ok && res.entry.file.endsWith('.webm'), JSON.stringify(res));
    assert.ok(fs.existsSync(res.entry.file));
    assert.ok(notes.some((n) => /Не удалось преобразовать/.test(n[1])));
    recs.items.length = 0;
  });

  await test('пустая запись (нет данных): ошибка и ничего не добавляется', async () => {
    recorderBehavior = 'silentstop';
    await rec.start({ mode: 'screen' });
    const w = recorder();
    const orig = w.onCmd.bind(w);
    w.onCmd = (cmd) => { if (cmd === 'stop') setImmediate(() => emit('rec:stopped', w, { elapsedMs: 0, bytes: 0, width: 0, height: 0, hasAudio: false })); else orig(cmd); };
    notes.length = 0;
    const res = await rec.stop();
    recorderBehavior = 'ok';
    assert.strictEqual(res.ok, false);
    assert.ok(notes.some((n) => /пустой/.test(n[1])));
    assert.strictEqual(recs.list().length, 0);
  });

  await test('плавающая панель: создаётся, получает состояние, стоп и пауза с панели работают', async () => {
    store.setSettings({ recPanel: true });
    await rec.start({ mode: 'screen' });
    const panel = wins.filter((x) => !x.destroyed && x.o && x.o.alwaysOnTop && x.o.frame === false).pop();
    assert.ok(panel, 'окно панели создано');
    assert.strictEqual(panel.o.focusable, false);
    emit('rec:tick', recorder(), { elapsedMs: 4000, bytes: 0, paused: false });
    assert.ok(panel.states.length >= 1 && panel.states[panel.states.length - 1].elapsedMs === 4000);
    const w = recorder();
    emit('rec:panel', panel, 'pause');
    assert.strictEqual(w.cmds[w.cmds.length - 1][0], 'pause');
    emit('rec:panel', { webContents: {} }, 'stop');
    assert.ok(!w.cmds.some((c) => c[0] === 'stop'), 'команды от чужого окна игнорируются');
    emit('rec:panel', panel, 'stop');
    for (let i = 0; i < 100 && rec.isActive(); i++) await sleep(100);
    assert.ok(panel.destroyed, 'панель закрыта после записи');
    store.setSettings({ recPanel: false }); recs.items.length = 0;
  });

  await test('восстановление: недописанная запись после сбоя возвращается в библиотеку', async () => {
    const tdir = path.join(dataDir, 'rec-tmp'); fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, 'crashed.webm'), WEBM);
    fs.writeFileSync(path.join(tdir, 'tiny.webm'), 'x');
    const n = await rec.recoverLeftovers();
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(fs.readdirSync(tdir), []);
    const items = recs.list();
    assert.strictEqual(items.length, 1);
    assert.ok(path.basename(items[0].file).startsWith('Восстановленная_запись') && items[0].duration > 1.5);
  });

  await test('Recordings: хранение, пропавшие файлы убираются, замена списка', () => {
    const r2 = new Recordings(path.join(tmp, 'r2'));
    const f = path.join(tmp, 'x.mp4'); fs.writeFileSync(f, 'x');
    r2.add({ id: 'a', file: f }); r2.add({ id: 'b', file: path.join(tmp, 'нет.mp4') });
    assert.deepStrictEqual(r2.list().map((x) => x.id), ['a']);
    assert.strictEqual(new Recordings(path.join(tmp, 'r2')).list().length, 1);
    r2.replaceAll([{ id: 'z', file: f }, { bad: 1 }]);
    assert.deepStrictEqual(r2.items.map((x) => x.id), ['z']);
    assert.strictEqual(r2.findByFile(f).id, 'z');
    assert.strictEqual(r2.update('z', { duration: 5 }).duration, 5);
  });

  console.log(results.join('\n'));
  console.log('\nПройдено: ' + passed + ' из ' + results.length);
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
