'use strict';
// Проверки логики без Electron: утилиты, хранилище, негатив, и обработчики main.js на заглушке Electron.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ok  ' + name); }
  catch (e) { results.push('FAIL  ' + name + '\n        ' + (e && e.stack || e)); process.exitCode = 1; }
}

const util = require('../lib/util');
const { Store } = require('../lib/store');
const core = require('../renderer/invert-core');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-test-'));

(async () => {
  await test('formatName: шаблон по умолчанию и запрещённые символы', () => {
    const d = new Date(2026, 9, 4, 7, 5, 9);
    assert.strictEqual(util.formatName(undefined, d), 'Снимок_2026-10-04_07-05-09');
    assert.strictEqual(util.formatName('a:b/{mode}?', d, { mode: 'x' }), 'a_b_x_');
    assert.strictEqual(util.formatName('   ', d), 'screenshot');
  });

  await test('uniquePath: добавляет (2), (3)', () => {
    const taken = new Set([path.join('d', 'a.png'), path.join('d', 'a (2).png')]);
    assert.strictEqual(util.uniquePath('d', 'a', '.png', (p) => taken.has(p)), path.join('d', 'a (3).png'));
  });

  await test('keyToAccelerator: сочетания, одиночные клавиши и модификаторы', () => {
    assert.strictEqual(util.keyToAccelerator({ code: 'PrintScreen' }), 'PrintScreen');
    assert.strictEqual(util.keyToAccelerator({ ctrlKey: true, altKey: true, code: 'KeyS' }), 'Ctrl+Alt+S');
    assert.strictEqual(util.keyToAccelerator({ ctrlKey: true, shiftKey: true, code: 'Digit1' }), 'Ctrl+Shift+1');
    assert.strictEqual(util.keyToAccelerator({ code: 'F9' }), 'F9');
    assert.strictEqual(util.keyToAccelerator({ code: 'KeyA' }), null);      // буква без модификатора
    assert.strictEqual(util.keyToAccelerator({ ctrlKey: true, code: 'ControlLeft' }), null); // только модификатор
  });

  await test('cropRectToImage: масштаб 125% и обрезка по границам', () => {
    assert.deepStrictEqual(util.cropRectToImage({ x: 10, y: 20, w: 100, h: 50 }, 1.25, 1920, 1080),
      { x: 13, y: 25, width: 125, height: 63 });
    const r = util.cropRectToImage({ x: 1900, y: 1070, w: 100, h: 100 }, 1, 1920, 1080);
    assert.strictEqual(r.width, 20); assert.strictEqual(r.height, 10);
  });

  await test('mergeSettings: значения по умолчанию, мусор отбрасывается', () => {
    const s = util.mergeSettings({ format: 'bmp', delaySec: 99, hotkeys: { region: 'F8' }, autosave: 'yes', jpgQuality: 5 });
    assert.strictEqual(s.format, 'png');
    assert.strictEqual(s.delaySec, 30);
    assert.strictEqual(s.hotkeys.region, 'F8');
    assert.strictEqual(s.hotkeys.screen, 'Ctrl+PrintScreen');
    assert.strictEqual(s.autosave, true);
    assert.strictEqual(s.jpgQuality, 40);
  });

  await test('invertPixels: полный негатив, альфа не меняется, двойной негатив = оригинал', () => {
    const a = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128, 10, 200, 30, 0]);
    const orig = Uint8ClampedArray.from(a);
    core.invertPixels(a, 'full', false);
    assert.deepStrictEqual(Array.from(a), [255, 255, 255, 255, 0, 0, 0, 128, 245, 55, 225, 0]);
    core.invertPixels(a, 'full', false);
    assert.deepStrictEqual(Array.from(a), Array.from(orig));
  });

  await test('invertPixels: режим яркости сохраняет оттенок, белое -> чёрное', () => {
    const a = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    core.invertPixels(a, 'lightness', false);
    assert.deepStrictEqual(Array.from(a.slice(0, 3)), [0, 0, 0]);
    assert.deepStrictEqual(Array.from(a.slice(4, 7)), [255, 255, 255]);
    // чисто красный (L=0.5) остаётся красным
    assert.deepStrictEqual(Array.from(a.slice(8, 11)), [255, 0, 0]);
    const b = new Uint8ClampedArray([200, 50, 50, 255]); // тёмно-светлый красный: оттенок красный
    core.invertPixels(b, 'lightness', false);
    const [h] = core.rgbToHsl(b[0], b[1], b[2]);
    assert.ok(h < 0.02 || h > 0.98, 'оттенок остался красным, h=' + h);
  });

  await test('invertPixels: серый режим даёт одинаковые каналы', () => {
    const a = new Uint8ClampedArray([200, 100, 50, 255]);
    core.invertPixels(a, 'full', true);
    assert.strictEqual(a[0], a[1]); assert.strictEqual(a[1], a[2]);
  });

  await test('Store: настройки, история, очистка, повреждённый JSON', () => {
    const dir = path.join(tmp, 'store');
    const st = new Store(dir);
    assert.strictEqual(st.getSettings().format, 'png');
    st.setSettings({ format: 'jpg', hotkeys: { region: 'F8' } });
    const st2 = new Store(dir);
    assert.strictEqual(st2.getSettings().format, 'jpg');
    assert.strictEqual(st2.getSettings().hotkeys.region, 'F8');
    assert.strictEqual(st2.getSettings().hotkeys.window, 'Alt+PrintScreen');

    const f1 = path.join(st2.cacheDir, 'a.png'); fs.writeFileSync(f1, 'x');
    const f2 = path.join(tmp, 'user.png'); fs.writeFileSync(f2, 'y');
    st2.addHistory({ id: 'a', file: f1, createdAt: 'x', mode: 'region', width: 1, height: 1 });
    st2.addHistory({ id: 'b', file: f2, createdAt: 'x', mode: 'screen', width: 1, height: 1 });
    assert.strictEqual(st2.listHistory().length, 2);
    assert.strictEqual(st2.listHistory()[0].id, 'b'); // новые сверху
    fs.unlinkSync(f2); // файл удалили вручную
    assert.strictEqual(st2.listHistory().length, 1);
    st2.clearHistory();
    assert.strictEqual(st2.listHistory().length, 0);
    assert.ok(!fs.existsSync(f1), 'файл из внутреннего кэша удалён');

    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
    fs.writeFileSync(path.join(dir, 'history.json'), '{broken');
    const st3 = new Store(dir);
    assert.strictEqual(st3.getSettings().format, 'png');
    assert.deepStrictEqual(st3.listHistory(), []);
  });

  // ---------- main.js на заглушке Electron ----------
  const handlers = {};
  const calls = { registered: [], clipboardImg: 0, trashed: [], shown: [], notifications: 0, windows: [] };
  const fakeImg = (buf) => ({
    _buf: buf, isEmpty: () => !buf || !buf.length, toPNG: () => buf, toJPEG: () => buf,
    getSize: () => ({ width: 4, height: 3 }), resize: () => fakeImg(buf), crop: () => fakeImg(buf)
  });
  class FakeWin {
    constructor(o) { this.o = o; this.webContents = { send() {}, setWindowOpenHandler() {}, once() {}, on() {} }; calls.windows.push(this); this._v = false; }
    loadFile() {} once() {} on() {} show() { this._v = true; } hide() { this._v = false; } focus() {} isVisible() { return this._v; }
    setTitle() {} isMinimized() { return false; } restore() {} isDestroyed() { return false; } destroy() {} setAlwaysOnTop() {} setMenuBarVisibility() {}
    getNativeWindowHandle() { return Buffer.alloc(8); }
  }
  const readyCbs = [];
  const fakeElectron = {
    app: {
      setPath() {}, getPath: (k) => path.join(tmp, 'app-' + k), requestSingleInstanceLock: () => true, on() {}, quit() {},
      whenReady: () => ({ then: (cb) => { readyCbs.push(cb); } }), isPackaged: false, getVersion: () => '1.0.0',
      setLoginItemSettings() {}, setAppUserModelId() {}
    },
    BrowserWindow: FakeWin,
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    Menu: { buildFromTemplate: (t) => t, setApplicationMenu() {} },
    globalShortcut: {
      register: (acc) => { if (acc === 'F1') return false; calls.registered.push(acc); return true; },
      unregisterAll() { calls.registered.length = 0; }
    },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeListener() {} },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmp, 'saved', 'out.jpg') }),
      showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(tmp, 'in.png')] })
    },
    clipboard: { writeImage() { calls.clipboardImg++; }, readImage: () => fakeImg(Buffer.alloc(0)) },
    nativeImage: { createFromBuffer: (b) => fakeImg(Buffer.from(b)), createFromPath: (p) => fakeImg(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0)) },
    Notification: class { static isSupported() { return true; } constructor() { calls.notifications++; } on() {} show() {} },
    shell: { beep() {}, openPath: async () => '', showItemInFolder: (p) => calls.shown.push(p), trashItem: async (p) => { calls.trashed.push(p); fs.unlinkSync(p); }, openExternal() {} },
    screen: { getAllDisplays: () => [], getDisplayNearestPoint: () => ({}), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    nativeTheme: { themeSource: 'dark' },
    desktopCapturer: {}
  };
  const origLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : origLoad.call(this, req, ...rest); };
  require('../main.js');
  Module._load = origLoad;
  readyCbs.forEach((cb) => cb());
  const PNG = Buffer.from('89504e470d0a1a0a' + '00'.repeat(20), 'hex');

  await test('main: регистрируются горячие клавиши, статус «занято» для недоступных', async () => {
    assert.deepStrictEqual(calls.registered.sort(), ['Alt+PrintScreen', 'Ctrl+PrintScreen', 'Ctrl+Shift+A', 'Ctrl+Shift+P', 'Ctrl+Shift+PrintScreen', 'Ctrl+Shift+R', 'PrintScreen']);
    const r = await handlers['settings:set'](null, { hotkeys: { region: 'F1', screen: 'F2', window: 'F2' } });
    assert.strictEqual(r.hotkeys.region, 'busy');
    assert.strictEqual(r.hotkeys.screen, 'ok');
    assert.strictEqual(r.hotkeys.window, 'duplicate');
    await handlers['settings:set'](null, { hotkeys: { region: 'PrintScreen', screen: 'Ctrl+PrintScreen', window: 'Alt+PrintScreen', seriesStep: 'Ctrl+Shift+PrintScreen', recToggle: 'Ctrl+Shift+R', recPause: 'Ctrl+Shift+P', recRegion: 'Ctrl+Shift+A' } });
  });

  let entry;
  await test('main: addBytes кладёт снимок в историю (автосохранение в папку)', async () => {
    const folder = path.join(tmp, 'shots');
    await handlers['settings:set'](null, { saveFolder: folder, autosave: true, format: 'png' });
    entry = await handlers['history:addBytes'](null, PNG, 'region');
    assert.ok(entry && fs.existsSync(entry.file));
    assert.strictEqual(path.dirname(entry.file), folder);
    assert.ok(entry.file.endsWith('.png'));
    assert.strictEqual((await handlers['history:list']()).length, 1);
    const entry2 = await handlers['history:addBytes'](null, PNG, 'region');
    assert.notStrictEqual(entry2.file, entry.file);
    await handlers['history:delete'](null, entry2.id);
  });

  await test('main: autosave выключен -> файл во внутреннем кэше', async () => {
    await handlers['settings:set'](null, { autosave: false });
    const e = await handlers['history:addBytes'](null, PNG, 'screen');
    assert.ok(e.file.includes(path.join('MoiScreenshot') ) || e.file.includes('cache'));
    assert.strictEqual(e.saved, false);
    await handlers['history:delete'](null, e.id);
    assert.ok(!fs.existsSync(e.file));
    await handlers['settings:set'](null, { autosave: true });
  });

  await test('main: папка недоступна -> снимок не теряется', async () => {
    const blocker = path.join(tmp, 'blocker'); fs.writeFileSync(blocker, 'file');
    await handlers['settings:set'](null, { saveFolder: path.join(blocker, 'sub') });
    const e = await handlers['history:addBytes'](null, PNG, 'region');
    assert.ok(e && fs.existsSync(e.file));
    assert.strictEqual(e.saved, false);
    await handlers['history:delete'](null, e.id);
    await handlers['settings:set'](null, { saveFolder: path.join(tmp, 'shots') });
  });

  await test('main: editor:save, history:read, thumb, copy, show', async () => {
    const r = await handlers['editor:save'](null, entry.id, new Uint8Array(PNG));
    assert.strictEqual(r.id, entry.id);
    const rd = await handlers['history:read'](null, entry.id);
    assert.ok(Buffer.compare(Buffer.from(rd.bytes), PNG) === 0);
    const th = await handlers['history:thumb'](null, entry.id);
    assert.ok(th.startsWith('data:image/jpeg;base64,'));
    assert.strictEqual(await handlers['history:copy'](null, entry.id), true);
    await handlers['history:show'](null, entry.id);
    assert.deepStrictEqual(calls.shown, [entry.file]);
    assert.strictEqual(await handlers['history:read'](null, 'нет-такого'), null);
  });

  await test('main: files:write — расширение проверяется, имя не перезаписывает существующее', async () => {
    const dir = path.join(tmp, 'neg'); fs.mkdirSync(dir);
    const p1 = await handlers['files:write'](null, path.join(dir, 'a_negative.png'), PNG);
    const p2 = await handlers['files:write'](null, path.join(dir, 'a_negative.png'), PNG);
    assert.ok(p1 && p2 && p1 !== p2);
    assert.strictEqual(await handlers['files:write'](null, path.join(dir, 'evil.exe'), PNG), null);
    assert.strictEqual(await handlers['files:read'](null, path.join(dir, 'evil.exe')), null);
    assert.ok(Buffer.isBuffer(await handlers['files:read'](null, p1)));
  });

  await test('main: file:saveAs пишет выбранный путь; clipboard:writeImage', async () => {
    const p = await handlers['file:saveAs'](null, new Uint8Array(PNG), 'x.png');
    assert.ok(fs.existsSync(p));
    assert.strictEqual(await handlers['clipboard:writeImage'](null, new Uint8Array(PNG)), true);
    assert.strictEqual(await handlers['clipboard:readImage'](), null);
  });

  await test('main: удаление из пользовательской папки идёт через корзину', async () => {
    await handlers['history:delete'](null, entry.id);
    assert.ok(calls.trashed.includes(entry.file));
    assert.strictEqual((await handlers['history:list']()).length, 0);
  });

  await test('capture:start отвергает неизвестный режим', async () => {
    assert.deepStrictEqual(await handlers['capture:start'](null, 'rm -rf'), { ok: false });
  });


  // ================= новое в 0.1.0 =================
  const backup = require('../lib/backup');
  const series = require('../lib/series');
  const I18n = require('../renderer/i18n');
  const Shared = require('../renderer/shared');

  await test('миграция настроек 0.0.x → схема 2: данные сохранены, копия старого файла рядом', () => {
    const dir = path.join(tmp, 'mig'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ format: 'jpg', hotkeys: { region: 'F8' }, saveFolder: 'D:\\Мои' }));
    const st = new Store(dir);
    assert.ok(st.migrated && st.migrated.from === 1 && st.migrated.to === util.SETTINGS_SCHEMA);
    assert.strictEqual(st.getSettings().format, 'jpg');
    assert.strictEqual(st.getSettings().saveFolder, 'D:\\Мои');
    assert.strictEqual(st.getSettings().hotkeys.region, 'F8');
    assert.strictEqual(st.getSettings().theme, 'dark');
    const copy = path.join(dir, 'backups', 'settings-before-migration-v1.json');
    assert.ok(fs.existsSync(copy));
    assert.strictEqual(JSON.parse(fs.readFileSync(copy, 'utf8')).format, 'jpg');
    assert.strictEqual(new Store(dir).migrated, null, 'повторно не мигрирует');
  });

  await test('mergeSettings: тема, язык, масштаб, акцент, лимит истории проверяются', () => {
    const s = util.mergeSettings({ theme: 'neon', language: 'de', uiScale: 77, accent: 'red', historyLimit: 5, dateFolders: 'year', seriesMode: 'x' });
    assert.strictEqual(s.theme, 'dark'); assert.strictEqual(s.language, 'ru'); assert.strictEqual(s.uiScale, 100);
    assert.strictEqual(s.accent, '#7c9cff'); assert.ok([100, 500, 2000].includes(s.historyLimit));
    assert.strictEqual(s.dateFolders, 'none'); assert.strictEqual(s.seriesMode, 'region');
    const ok = util.mergeSettings({ theme: 'light', language: 'en', uiScale: 125, accent: '#22c55e', historyLimit: 100 });
    assert.deepStrictEqual([ok.theme, ok.language, ok.uiScale, ok.accent, ok.historyLimit], ['light', 'en', 125, '#22c55e', 100]);
  });

  await test('миграция 0.1.0 → схема 3: новые поля записи получают значения, прежние настройки целы', () => {
    const dir = path.join(tmp, 'mig3'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ _v: 2, theme: 'light', accent: '#22c55e', hotkeys: { region: 'F8', screen: 'Ctrl+PrintScreen', window: 'Alt+PrintScreen', seriesStep: 'Ctrl+Shift+PrintScreen' }, seriesPrefix: 'ЛБ' }));
    const st = new Store(dir);
    assert.ok(st.migrated && st.migrated.from === 2 && st.migrated.to === 3);
    assert.ok(fs.existsSync(path.join(dir, 'backups', 'settings-before-migration-v2.json')));
    const s = st.getSettings();
    assert.strictEqual(s.theme, 'light'); assert.strictEqual(s.accent, '#22c55e'); assert.strictEqual(s.seriesPrefix, 'ЛБ'); assert.strictEqual(s.hotkeys.region, 'F8');
    assert.strictEqual(s.hotkeys.recToggle, 'Ctrl+Shift+R'); assert.strictEqual(s.recFps, 30); assert.strictEqual(s.recFormat, 'mp4'); assert.strictEqual(s.recFolder, '');
    assert.strictEqual(s.animations, true); assert.strictEqual(s.rememberWindow, true);
  });

  await test('mergeSettings: параметры записи проверяются и ограничиваются', () => {
    const s = util.mergeSettings({ recFps: 24, recQuality: 'ultra', recFormat: 'avi', recSystemGain: 900, recMicGain: -5, recCamSize: 99, recCamCorner: 'x', recMaxMinutes: 99999, recMaxMB: -1, recMode: 'all', windowBounds: { x: 10, y: 20, width: 1200, height: 800 } });
    assert.deepStrictEqual([s.recFps, s.recQuality, s.recFormat, s.recSystemGain, s.recMicGain, s.recCamSize, s.recCamCorner, s.recMaxMinutes, s.recMaxMB, s.recMode],
      [30, 'medium', 'mp4', 200, 0, 40, 'br', 600, 0, 'screen']);
    assert.deepStrictEqual(s.windowBounds, { x: 10, y: 20, width: 1200, height: 800 });
    assert.deepStrictEqual(util.mergeSettings({ windowBounds: 'мусор' }).windowBounds, { x: -1, y: -1, width: 0, height: 0 });
    const ok = util.mergeSettings({ recFps: 60, recQuality: 'high', recFormat: 'webm', recMode: 'region', recCamShape: 'rect', recMaxMinutes: 0 });
    assert.deepStrictEqual([ok.recFps, ok.recQuality, ok.recFormat, ok.recMode, ok.recCamShape, ok.recMaxMinutes], [60, 'high', 'webm', 'region', 'rect', 0]);
  });

  await test('backups: записи входят в копию и возвращаются при восстановлении', () => {
    const st = new Store(path.join(tmp, 'bkrec'));
    const f = backup.createBackup({ store: st, version: '0.2.0', kind: 'manual', extra: { recordings: [{ id: 'r', file: 'x.mp4' }] } });
    assert.deepStrictEqual(backup.parseBackup(f).extra.recordings, [{ id: 'r', file: 'x.mp4' }]);
  });

  await test('dateSubfolder: месяц, день, без папок', () => {
    const d = new Date(2026, 9, 4);
    assert.strictEqual(util.dateSubfolder('month', d), '2026-10');
    assert.strictEqual(util.dateSubfolder('day', d), '2026-10-04');
    assert.strictEqual(util.dateSubfolder('none', d), '');
  });

  await test('Store: лимит истории обрезает старые записи', () => {
    const st = new Store(path.join(tmp, 'lim'));
    for (let i = 0; i < 120; i++) {
      const f = path.join(st.cacheDir, i + '.png'); fs.writeFileSync(f, 'x');
      st.addHistory({ id: 'i' + i, file: f, createdAt: 'x', mode: 'region', width: 1, height: 1 });
    }
    st.setSettings({ historyLimit: 100 });
    assert.strictEqual(st.listHistory().length, 100);
    assert.strictEqual(st.listHistory()[0].id, 'i119');
  });

  await test('резервные копии: создание, хранение по 10 на вид, автокопия раз в сутки', () => {
    const st = new Store(path.join(tmp, 'bk'));
    st.setSettings({ format: 'jpg' });
    const f = backup.createBackup({ store: st, version: '0.1.0', kind: 'manual' });
    assert.ok(fs.existsSync(f));
    assert.strictEqual(backup.parseBackup(f).settings.format, 'jpg');
    for (let i = 0; i < 14; i++) backup.createBackup({ store: st, version: '0.1.0', kind: 'manual', now: new Date(2026, 0, 1, 0, 0, i) });
    assert.strictEqual(backup.listBackups(st.backupDir).filter((b) => b.kind === 'manual').length, 10);
    const now = new Date();
    assert.ok(backup.autoBackupIfDue({ store: st, version: '0.1.0' }, now));
    assert.strictEqual(backup.autoBackupIfDue({ store: st, version: '0.1.0' }, now), null);
    assert.ok(backup.autoBackupIfDue({ store: st, version: '0.1.0' }, new Date(now.getTime() + 25 * 3600 * 1000)));
  });

  await test('резервные копии: битый файл отвергается, экспорт и импорт настроек', () => {
    const bad = path.join(tmp, 'bad.json'); fs.writeFileSync(bad, '{"x":1}');
    assert.throws(() => backup.parseBackup(bad), /invalid/);
    assert.throws(() => backup.parseSettingsFile(bad), /invalid/);
    const st = new Store(path.join(tmp, 'ex')); st.setSettings({ theme: 'light' });
    const out = path.join(tmp, 'exp.json');
    backup.exportSettings(st, out, '0.1.0');
    assert.strictEqual(backup.parseSettingsFile(out).theme, 'light');
    const st2 = new Store(path.join(tmp, 'ex2')); st2.replaceAll({ settings: backup.parseSettingsFile(out) });
    assert.strictEqual(st2.getSettings().theme, 'light');
  });

  await test('серия: имена, подписи, сквозная нумерация, пересчёт после удаления', () => {
    assert.strictEqual(Shared.stepBase('{prefix}{lab}_шаг{step}', { prefix: 'ЛР', lab: '5', step: 3 }), 'ЛР5_шаг3');
    assert.strictEqual(Shared.captionFor('Рисунок {n} — {text}', 4, 'Схема'), 'Рисунок 4 — Схема');
    assert.strictEqual(Shared.captionFor('Рисунок {n} — {text}', 4, ''), 'Рисунок 4');
    const m = series.newManifest({ prefix: 'ЛР', lab: '5', startFigure: 3, nameTemplate: '{prefix}{lab}_шаг{step}', captionTemplate: 'Рисунок {n} — {text}' });
    series.addStep(m, { file: 'ЛР5_шаг1.png' }); series.addStep(m, { file: 'ЛР5_шаг2.png' }); series.addStep(m, { file: 'ЛР5_шаг3.png' });
    assert.deepStrictEqual(m.steps.map((s) => s.figure), [3, 4, 5]);
    series.setText(m, 2, '  Схема   усилителя ');
    assert.strictEqual(m.steps[1].caption, 'Рисунок 4 — Схема усилителя');
    series.removeStep(m, 1);
    assert.deepStrictEqual(m.steps.map((s) => [s.step, s.figure]), [[2, 3], [3, 4]]);
    assert.strictEqual(series.nextStepNumber(m), 4);
    assert.strictEqual(series.nextFigure(m), 5);
    assert.strictEqual(series.titleOf(m), 'ЛР5');
  });

  await test('серия: manifest из чужих рук не выводит за пределы папки, мусор отвергается', () => {
    const m = series.validate({ kind: 'moi-screenshot-series', steps: [{ step: 1, file: '..\\..\\evil.png' }, { step: 'x', file: 'a.png' }, { step: 2, file: '../up/b.png' }] });
    assert.deepStrictEqual(m.steps.map((s) => s.file), [path.basename('..\\..\\evil.png'), 'b.png']);
    assert.strictEqual(series.validate({ kind: 'other', steps: [] }), null);
    assert.strictEqual(series.validate(null), null);
  });

  await test('серия: папка серии <корень>\\<дисциплина>\\<приставка><номер>, запрещённые символы убираются', () => {
    assert.strictEqual(series.seriesDir('R', 'Схема/техника', 'ЛР', '5'), path.join('R', Shared.sanitize('Схема/техника'), 'ЛР5'));
    assert.strictEqual(series.seriesDir('R', '', 'ЛР', '5'), path.join('R', 'ЛР5'));
    assert.ok(!/[\\/:*?"<>|]/.test(Shared.sanitize('a:b*c')));
  });

  await test('SeriesState: активная, недавние, забывание', () => {
    const dir = path.join(tmp, 'ss'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'ЛР1'); fs.mkdirSync(f);
    const m = series.newManifest({ prefix: 'ЛР', lab: '1' }); series.saveManifest(f, m);
    const a = new series.SeriesState(dir); a.activate(f);
    const b = new series.SeriesState(dir);
    assert.strictEqual(b.active, f);
    assert.strictEqual(b.listRecent().length, 1);
    b.forget(f);
    assert.strictEqual(new series.SeriesState(dir).listRecent().length, 0);
  });

  await test('main: серия — создание, продолжение, подписи, удаление, закрытие', async () => {
    await handlers['settings:set'](null, { seriesRoot: path.join(tmp, 'labs') });
    assert.deepStrictEqual(await handlers['series:create'](null, { lab: '   ' }), { ok: false, error: 'lab' });
    const r = await handlers['series:create'](null, { prefix: 'ЛР', lab: '5', discipline: 'Схемотехника', startFigure: 3 });
    assert.ok(r.ok && !r.resumed);
    assert.strictEqual(r.active.title, 'ЛР5 · Схемотехника');
    assert.strictEqual(r.active.nextFigure, 3);
    const folder = r.active.folder;
    assert.ok(fs.existsSync(path.join(folder, 'series.json')));
    // шаги добавляем так же, как это делает съёмка: файл + запись в манифесте
    const m = series.loadManifest(folder);
    for (let i = 1; i <= 2; i++) { fs.writeFileSync(path.join(folder, 'ЛР5_шаг' + i + '.png'), PNG); series.addStep(m, { file: 'ЛР5_шаг' + i + '.png' }); }
    series.saveManifest(folder, m);
    await handlers['series:close']();
    assert.strictEqual((await handlers['series:state']()).active, null);
    const o = await handlers['series:open'](null, folder);
    assert.ok(o.ok); assert.strictEqual(o.active.steps.length, 2);
    assert.deepStrictEqual(o.active.steps.map((s) => s.figure), [3, 4]);
    const c = await handlers['series:caption'](null, 2, 'Схема усилителя');
    assert.strictEqual(c.active.steps[1].caption, 'Рисунок 4 — Схема усилителя');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(folder, 'series.json'), 'utf8')).steps[1].text, 'Схема усилителя');
    assert.strictEqual((await handlers['series:caption'](null, 99, 'x')).ok, false);
    const e = await handlers['series:entry'](null, 1);
    assert.ok(e && e.file.endsWith('ЛР5_шаг1.png'));
    assert.ok((await handlers['series:thumb'](null, 1)));
    const d = await handlers['series:remove'](null, 1);
    assert.deepStrictEqual(d.active.steps.map((s) => [s.step, s.figure]), [[2, 3]]);
    assert.ok(calls.trashed.some((p) => p.endsWith('ЛР5_шаг1.png')));
    assert.strictEqual(d.active.nextStep, 3);
    // повторное «создание» той же серии продолжает её
    const again = await handlers['series:create'](null, { prefix: 'ЛР', lab: '5', discipline: 'Схемотехника', startFigure: 1 });
    assert.ok(again.resumed && again.active.steps.length === 1);
    assert.strictEqual((await handlers['series:retake'](null, 99)).ok, false);
    await handlers['series:close']();
    assert.deepStrictEqual(await handlers['series:step'](null, 'region'), { ok: false, error: 'noseries' });
    const bad = await handlers['series:open'](null, path.join(tmp, 'нет-такой'));
    assert.strictEqual(bad.error, 'nomanifest');
  });

  await test('main: настройки — сброс, копии и app:info', async () => {
    await handlers['settings:set'](null, { theme: 'light', language: 'en', accent: '#22c55e' });
    const info = await handlers['app:info']();
    assert.ok(info.version && info.backupDir && info.seriesRoot && info.electron !== undefined);
    const b = await handlers['backup:create']();
    assert.ok(b.ok);
    assert.ok((await handlers['backup:info']()).count >= 1);
    await handlers['settings:reset']();
    assert.strictEqual((await handlers['settings:get']()).theme, 'dark');
    const all = fs.readdirSync(tmp, { recursive: true }).map(String);
    assert.ok(all.some((n) => n.endsWith('_pre-reset.json')), 'перед сбросом сделана копия');
  });

  await test('i18n: наборы ключей ru и en совпадают, нет пустых строк', () => {
    const d = I18n.DICT;
    const ru = Object.keys(d.ru), en = Object.keys(d.en);
    assert.deepStrictEqual(ru.filter((k) => !en.includes(k)), [], 'нет перевода на английский');
    assert.deepStrictEqual(en.filter((k) => !ru.includes(k)), [], 'нет русской строки');
    assert.deepStrictEqual(ru.filter((k) => !String(d.ru[k]).trim() || !String(d.en[k]).trim()), []);
  });

  await test('i18n: все ключи из разметки и кода существуют; параметры подставляются', () => {
    const d = I18n.DICT;
    const have = new Set(Object.keys(d.ru));
    const files = ['index.html', 'overlay.html', 'app.js', 'settings.js', 'series.js', 'editor.js', 'invert.js', 'overlay.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8'))
      .concat(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'));
    const used = new Set();
    for (const t of files) {
      for (const m of t.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)) used.add(m[1]);
      for (const m of t.matchAll(/\bT\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    const dyn = [...used].filter((k) => k.endsWith('.'));   // ключи, собираемые в коде: T('mode.' + x)
    assert.ok(dyn.every((p) => [...have].some((k) => k.startsWith(p))), 'нет ключей с префиксом');
    const missing = [...used].filter((k) => !k.endsWith('.') && !have.has(k));
    assert.deepStrictEqual(missing, [], 'ключи без перевода: ' + missing.join(', '));
    assert.strictEqual(I18n.t('ser.next', { step: 1, fig: 3 }, 'ru'), 'Следующий шаг: 1 · рисунок 3');
    assert.strictEqual(I18n.t('ser.next', { step: 1, fig: 3 }, 'en'), 'Next step: 1 · figure 3');
  });

  await test('CHANGELOG.md соответствует renderer/changelog.js, версия совпадает с package.json', () => {
    const { CHANGELOG } = require('../renderer/changelog');
    const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    for (const v of CHANGELOG) assert.ok(md.includes('## ' + v.v + ' '), 'нет версии ' + v.v);
    assert.strictEqual(CHANGELOG[0].v, require('../package.json').version);
    assert.ok(CHANGELOG.slice(1).every((v) => v.beta) && CHANGELOG[0].beta);
  });

  console.log(results.join('\n'));
  console.log('\nПройдено: ' + passed + ' из ' + results.length);
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
