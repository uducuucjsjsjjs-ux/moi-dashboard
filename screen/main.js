'use strict';

const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, clipboard, nativeImage,
  Notification, shell, screen, nativeTheme } = electron;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./lib/store');
const { formatName, uniquePath, dateSubfolder } = require('./lib/util');
const cap = require('./lib/capture');
const series = require('./lib/series');
const backup = require('./lib/backup');
const { Recordings } = require('./lib/recordings');
const { createRecSession } = require('./lib/rec-session');
const ff = require('./lib/ffmpeg');
const { createVideoSession } = require('./lib/video-session');
const I18n = require('./renderer/i18n');

// Стабильная папка данных без кириллицы: %APPDATA%\MoiScreenshot
app.setPath('userData', path.join(app.getPath('appData'), 'MoiScreenshot'));
if (app.setAppUserModelId) app.setAppUserModelId('local.moi.screenshot');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
const startedHidden = process.argv.includes('--hidden');
const HOTKEY_MODES = { region: 'region', screen: 'screen', window: 'window' };

let store = null;
let seriesState = null;
let recs = null;
let rec = null;               // сессия записи экрана
let vid = null;               // видеоредактор
let activeSeries = null;      // { folder, manifest }
let mainWindow = null;
let tray = null;
let quitting = false;
let capturing = false;
let hotkeyState = {};

// Перевод для основного процесса (трей, уведомления, диалоги)
const T = (key, params) => I18n.t(key, params, store ? store.getSettings().language : 'ru');

// ---------- одно окно программы ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (store) showMain(); });
}

function bgColor() {
  const t = store.getSettings().theme;
  const dark = t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors !== false);
  return dark ? '#0c0d10' : '#f5f6f8';
}

function showMain(nav) {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(true);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (nav) mainWindow.webContents.send('nav', nav);
}

function applyUiScale() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setZoomFactor(store.getSettings().uiScale / 100); } catch (_) {}
  }
}

function createMainWindow(forceShow) {
  const s = store.getSettings();
  const wb = s.rememberWindow ? s.windowBounds : null;
  const okBounds = wb && wb.width >= 900 && wb.height >= 600 && screen.getAllDisplays().some((d) => {
    const a = d.workArea; return wb.x + 100 > a.x && wb.x < a.x + a.width - 100 && wb.y >= a.y - 10 && wb.y < a.y + a.height - 100;
  });
  mainWindow = new BrowserWindow({
    width: okBounds ? wb.width : 1180, height: okBounds ? wb.height : 760, minWidth: 900, minHeight: 600,
    ...(okBounds ? { x: wb.x, y: wb.y } : {}),
    show: false, title: T('app.name'), autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: bgColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', applyUiScale);
  mainWindow.once('ready-to-show', () => {
    const hide = startedHidden && s.startHidden && !forceShow;
    if (!hide) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    if (!quitting && store.getSettings().closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !store.getSettings().rememberWindow) return;
      if (mainWindow.isMinimized() || (mainWindow.isMaximized && mainWindow.isMaximized())) return;
      const b = mainWindow.getBounds();
      store.setSettings({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }, 600);
  };
  if (mainWindow.on) { mainWindow.on('resize', saveBounds); mainWindow.on('move', saveBounds); }
  mainWindow.on('closed', () => { mainWindow = null; });
  // внешние ссылки открываем в браузере, а не внутри программы
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: T('tray.region'), click: () => startCapture('region') },
    { label: T('tray.screen'), click: () => startCapture('screen') },
    { label: T('tray.window'), click: () => startCapture('window') },
    { label: T('tray.series'), click: () => seriesStepHotkey() },
    { type: 'separator' },
    { label: rec && rec.isActive() ? T('tray.recStop') : T('tray.recStart'), click: () => recToggle() },
    ...(rec && rec.isActive() ? [{ label: T('tray.recPause'), click: () => rec.togglePause() }] : []),
    { type: 'separator' },
    { label: T('tray.open'), click: () => showMain() },
    { label: T('tray.history'), click: () => showMain('history') },
    { label: T('tray.invert'), click: () => showMain('invert') },
    { type: 'separator' },
    { label: T('tray.quit'), click: () => { quitting = true; app.quit(); } }
  ]);
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  if (!icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(T('app.name'));
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showMain());
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(T('app.name'));
  tray.setContextMenu(buildTrayMenu());
}

const extraNow = () => ({ recordings: recs ? recs.items : [] });

// Запись: одна клавиша включает и выключает
function recToggle() {
  if (!rec) return;
  if (rec.isActive()) rec.stop(); else rec.start({});
}

// ---------- горячие клавиши ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = store.getSettings().hotkeys;
  const handlers = {};
  for (const [name, mode] of Object.entries(HOTKEY_MODES)) handlers[name] = () => startCapture(mode);
  handlers.seriesStep = () => seriesStepHotkey();
  handlers.recToggle = () => recToggle();
  handlers.recPause = () => { if (rec) rec.togglePause(); };
  handlers.recRegion = () => { if (rec && !rec.isActive()) rec.start({ mode: 'region' }); };
  const seen = new Set();
  hotkeyState = {};
  for (const [name, fn] of Object.entries(handlers)) {
    const acc = hk[name];
    if (!acc) { hotkeyState[name] = 'off'; continue; }
    if (seen.has(acc)) { hotkeyState[name] = 'duplicate'; continue; }
    seen.add(acc);
    let ok = false;
    try { ok = globalShortcut.register(acc, fn); } catch (_) { ok = false; }
    hotkeyState[name] = ok ? 'ok' : 'busy';
  }
  return hotkeyState;
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!store.getSettings().autostart, args: ['--hidden'] });
  } catch (_) {}
}

// Что нужно пересчитать при смене настроек
function applySettingsEffects(before, after) {
  if (JSON.stringify(before.hotkeys) !== JSON.stringify(after.hotkeys)) registerHotkeys();
  if (before.autostart !== after.autostart) applyLoginItem();
  if (before.theme !== after.theme) nativeTheme.themeSource = after.theme;
  if (before.uiScale !== after.uiScale) applyUiScale();
  if (before.language !== after.language) {
    refreshTray();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(T('app.name'));
  }
}

// ---------- сохранение снимков ----------
function defaultFolder() {
  return path.join(app.getPath('pictures'), 'Скриншоты');
}

function seriesRoot() {
  return store.getSettings().seriesRoot || path.join(defaultFolder(), 'Лабораторные');
}

function encodeImage(image, ext, quality) {
  return ext === '.jpg' || ext === '.jpeg' ? image.toJPEG(quality) : image.toPNG();
}

function notify(title, body, onClick) {
  const s = store.getSettings();
  if (!s.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

function beep() {
  if (store.getSettings().sound && shell.beep) { try { shell.beep(); } catch (_) {} }
}

// Записывает изображение в историю. Возвращает запись.
function saveToHistory(image, mode, opts = {}) {
  const s = store.getSettings();
  const now = new Date();
  const ext = s.format === 'jpg' ? '.jpg' : '.png';
  const base = formatName(s.fileTemplate, now, { mode });
  const toCache = opts.forceCache || !s.autosave;
  const sub = toCache ? '' : dateSubfolder(s.dateFolders, now);
  let dir = toCache ? store.cacheDir : path.join(s.saveFolder || defaultFolder(), sub);
  let saved = !toCache;
  let error = null;
  let file;
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = uniquePath(dir, base, ext, fs.existsSync);
    fs.writeFileSync(file, encodeImage(image, ext, s.jpgQuality));
  } catch (e) {
    // папка недоступна — не теряем снимок, кладём во внутренний кэш
    error = e.message;
    dir = store.cacheDir;
    saved = false;
    fs.mkdirSync(dir, { recursive: true });
    file = uniquePath(dir, base, ext, fs.existsSync);
    fs.writeFileSync(file, encodeImage(image, ext, s.jpgQuality));
  }
  const size = image.getSize();
  const entry = {
    id: crypto.randomUUID(),
    file,
    createdAt: now.toISOString(),
    mode,
    width: size.width,
    height: size.height,
    saved
  };
  store.addHistory(entry);
  return { entry, error };
}

async function finalizeCapture(image, mode, fromUi, wasVisible) {
  const s = store.getSettings();
  const { entry, error } = saveToHistory(image, mode);
  if (s.copyToClipboard) clipboard.writeImage(image);
  beep();

  const parts = [path.basename(entry.file)];
  if (s.copyToClipboard) parts.push(T('n.done.copied'));
  if (error) parts.push(T('n.done.cache'));
  notify(T('n.done.title'), parts.join(' · '), () => showMain('editor:' + entry.id));

  if (s.openEditor) {
    showMain();
    mainWindow.webContents.send('capture:done', { id: entry.id, open: true });
  } else {
    if (wasVisible) showMain(); // окно было открыто — возвращаем его на место
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('capture:done', { id: entry.id, open: false });
  }
}

// ---------- серия для лабораторной ----------
function coded(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function seriesView() {
  if (!activeSeries) return null;
  const { folder, manifest: m } = activeSeries;
  return {
    folder,
    title: series.titleOf(m),
    prefix: m.prefix, lab: m.lab, discipline: m.discipline,
    startFigure: m.startFigure,
    nameTemplate: m.nameTemplate, captionTemplate: m.captionTemplate,
    nextStep: series.nextStepNumber(m),
    nextFigure: series.nextFigure(m),
    steps: m.steps.map((s) => {
      const file = path.join(folder, s.file);
      return { step: s.step, figure: s.figure, fileName: s.file, file, text: s.text, caption: s.caption,
        createdAt: s.createdAt, exists: fs.existsSync(file) };
    })
  };
}

function activateSeries(folder, manifest) {
  activeSeries = { folder, manifest };
  seriesState.activate(folder);
}

function loadActiveSeries() {
  const f = seriesState.active;
  if (!f) return;
  const m = fs.existsSync(f) ? series.loadManifest(f) : null;
  if (m) activeSeries = { folder: f, manifest: m };
  else seriesState.deactivate();
}

function sendSeriesChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('series:changed');
}

// Горячая клавиша шага: без начатой серии подсказываем, что делать
function seriesStepHotkey() {
  if (!activeSeries) {
    notify(T('n.noseries.title'), T('n.noseries.body'), () => showMain('series'));
    showMain('series');
    return Promise.resolve({ ok: false, error: 'noseries' });
  }
  return startCapture(store.getSettings().seriesMode, false, { series: true, retake: null });
}

async function finalizeSeries(image, ctx, wasVisible) {
  const s = store.getSettings();
  if (!activeSeries) throw coded('noseries');
  const { folder, manifest: m } = activeSeries;
  fs.mkdirSync(folder, { recursive: true });
  const size = image.getSize();
  let file, entry, stepNo, figure;

  if (ctx.retake != null) {
    const st = m.steps.find((x) => x.step === ctx.retake);
    if (!st) throw coded('nostep');
    file = path.join(folder, st.file);
    fs.writeFileSync(file, encodeImage(image, path.extname(file).toLowerCase(), s.jpgQuality));
    stepNo = st.step; figure = st.figure;
    entry = store.findHistoryByFile(file);
    if (entry) {
      try { fs.unlinkSync(path.join(store.thumbDir, entry.id + '.jpg')); } catch (_) {}
      store.updateHistoryFile(entry.id, { width: size.width, height: size.height });
    }
    series.saveManifest(folder, m);
  } else {
    const ext = s.format === 'jpg' ? '.jpg' : '.png';
    const base = series.stepBase(m.nameTemplate, { prefix: m.prefix, lab: m.lab, step: series.nextStepNumber(m) });
    file = uniquePath(folder, base, ext, fs.existsSync);
    fs.writeFileSync(file, encodeImage(image, ext, s.jpgQuality));
    const st = series.addStep(m, { file });
    series.saveManifest(folder, m);
    stepNo = st.step; figure = st.figure;
    entry = { id: crypto.randomUUID(), file, createdAt: new Date().toISOString(), mode: 'series',
      width: size.width, height: size.height, saved: true };
    store.addHistory(entry);
  }

  if (s.copyToClipboard) clipboard.writeImage(image);
  beep();
  notify(T(ctx.retake != null ? 'n.retake.title' : 'n.series.title'),
    T('n.series.body', { name: path.basename(file), n: figure }), () => showMain('series'));

  if (s.seriesOpenEditor && entry) {
    showMain();
    mainWindow.webContents.send('capture:done', { id: entry.id, open: true });
  } else if (wasVisible) {
    showMain();
  }
  sendSeriesChanged();
  return { step: stepNo, figure };
}

async function startCapture(mode, fromUi = false, ctx = null) {
  if (capturing) return { ok: false, error: 'busy' };
  capturing = true;
  const s = store.getSettings();
  const wasVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
  let hwnd = null;
  try {
    // для окна определяем активное ещё до того, как прячем свою программу
    if (mode === 'window') hwnd = await cap.getForegroundHwnd();
    let ownHwnd = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { ownHwnd = String(mainWindow.getNativeWindowHandle().readBigUInt64LE(0)); } catch (_) {}
    }
    const captureSelf = mode === 'window' && hwnd && hwnd === ownHwnd;

    if (wasVisible && !captureSelf) mainWindow.hide();
    if (s.delaySec > 0) await cap.sleep(s.delaySec * 1000);
    await cap.sleep(wasVisible ? 280 : 60); // даём окну пропасть с экрана

    let image = null;
    if (mode === 'screen') {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      image = await cap.grabDisplay(electron, d);
    } else if (mode === 'window') {
      const r = await cap.grabWindow(electron, hwnd, [T('app.name')]);
      image = r.image;
    } else {
      const displays = screen.getAllDisplays();
      const shots = [];
      for (const d of displays) shots.push({ display: d, image: await cap.grabDisplay(electron, d) });
      image = await cap.selectRegion(electron, shots, path.join(__dirname, 'renderer', 'overlay.html'),
        path.join(__dirname, 'preload.js'), T('overlay.hint'));
    }

    if (!image || image.isEmpty()) {
      if (wasVisible) showMain();
      return { ok: false, error: 'cancelled' };
    }
    if (ctx && ctx.series) await finalizeSeries(image, ctx, wasVisible);
    else await finalizeCapture(image, mode, fromUi, wasVisible);
    return { ok: true };
  } catch (e) {
    if (wasVisible) showMain();
    const known = e && (e.code === 'screen' || e.code === 'window');
    const body = known ? T('err.' + e.code) : (e && e.code === 'noseries' ? T('n.noseries.body') : (e && e.message) || '');
    if (Notification.isSupported()) new Notification({ title: T('n.fail.title'), body }).show();
    return { ok: false, error: (e && e.code) || (e && e.message) };
  } finally {
    capturing = false;
  }
}

// ---------- IPC ----------
function toBuf(b) { return Buffer.isBuffer(b) ? b : Buffer.from(b); }

function extOk(p) {
  return IMAGE_EXT.includes(path.extname(String(p)).toLowerCase());
}

function isDir(p) {
  try { return fs.statSync(String(p)).isDirectory(); } catch (_) { return false; }
}

function thumbOf(file, width) {
  try {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const w = Math.min(width, img.getSize().width);
    return 'data:image/jpeg;base64,' + img.resize({ width: w, quality: 'good' }).toJPEG(78).toString('base64');
  } catch (_) { return null; }
}

function setupIpc() {
  // --- настройки ---
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = JSON.parse(JSON.stringify(store.getSettings()));
    const s = store.setSettings(patch);
    applySettingsEffects(before, s);
    return { settings: s, hotkeys: hotkeyState };
  });
  ipcMain.handle('hotkeys:status', () => hotkeyState);
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), dataDir: app.getPath('userData'), backupDir: store.backupDir,
    defaultFolder: defaultFolder(), seriesRoot: path.join(defaultFolder(), 'Лабораторные'), packaged: app.isPackaged,
    electron: process.versions.electron || '', chrome: process.versions.chrome || '', node: process.versions.node || '',
    platform: process.platform, arch: process.arch,
    migrated: store.migrated
  }));
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // --- резервные копии, экспорт, сброс ---
  const reload = () => ({ ok: true, settings: store.getSettings(), hotkeys: hotkeyState });
  const after = (before) => { applySettingsEffects(before, store.getSettings()); registerHotkeys(); };
  const backupInfo = () => {
    const list = backup.listBackups(store.backupDir);
    const last = list[0] || null;
    return { dir: store.backupDir, count: list.length, last: last ? { name: last.name, kind: last.kind, mtime: last.mtime } : null };
  };
  ipcMain.handle('backup:info', () => backupInfo());
  ipcMain.handle('backup:create', () => {
    const file = backup.createBackup({ store, extra: extraNow(), version: app.getVersion(), kind: 'manual' });
    return { ok: true, file, info: backupInfo() };
  });
  ipcMain.handle('backup:openDir', async () => {
    fs.mkdirSync(store.backupDir, { recursive: true });
    return shell.openPath(store.backupDir);
  });
  ipcMain.handle('backup:restore', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      defaultPath: store.backupDir, properties: ['openFile'], filters: [{ name: T('dlg.backup'), extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    let data;
    try { data = backup.parseBackup(r.filePaths[0]); } catch (_) { return { ok: false, error: 'invalid' }; }
    const before = JSON.parse(JSON.stringify(store.getSettings()));
    backup.createBackup({ store, extra: extraNow(), version: app.getVersion(), kind: 'pre-restore' });
    store.replaceAll({ settings: data.settings, history: data.history });
    if (data.extra && Array.isArray(data.extra.recordings)) recs.replaceAll(data.extra.recordings);
    after(before);
    return Object.assign(reload(), { info: backupInfo() });
  });
  ipcMain.handle('settings:export', async () => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), 'moi-screenshot-settings.json'),
      filters: [{ name: T('dlg.settings'), extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
    backup.exportSettings(store, r.filePath, app.getVersion());
    return { ok: true, file: r.filePath };
  });
  ipcMain.handle('settings:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: T('dlg.settings'), extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    let st;
    try { st = backup.parseSettingsFile(r.filePaths[0]); } catch (_) { return { ok: false, error: 'invalid' }; }
    const before = JSON.parse(JSON.stringify(store.getSettings()));
    backup.createBackup({ store, extra: extraNow(), version: app.getVersion(), kind: 'pre-import' });
    store.replaceAll({ settings: st });
    after(before);
    return reload();
  });
  ipcMain.handle('settings:reset', () => {
    const before = JSON.parse(JSON.stringify(store.getSettings()));
    backup.createBackup({ store, extra: extraNow(), version: app.getVersion(), kind: 'pre-reset' });
    store.resetSettings();
    after(before);
    return reload();
  });

  // --- съёмка ---
  ipcMain.handle('capture:start', (_e, mode) => {
    if (!['region', 'screen', 'window'].includes(mode)) return { ok: false };
    // не ждём окончания: интерфейс получит событие capture:done
    startCapture(mode, true);
    return { ok: true };
  });

  // --- серия для лабораторной ---
  ipcMain.handle('series:state', () => ({ active: seriesView(), recent: seriesState.listRecent() }));
  ipcMain.handle('series:preview', (_e, o) => {
    const s = store.getSettings();
    const lab = String(o && o.lab || '').trim();
    if (!series.sanitize(lab)) return { ok: false };
    const folder = series.seriesDir(seriesRoot(), o.discipline, o.prefix, lab);
    return { ok: true, folder, exists: fs.existsSync(path.join(folder, series.MANIFEST)) };
  });
  ipcMain.handle('series:create', (_e, o) => {
    const s = store.getSettings();
    const prefix = String(o && o.prefix != null ? o.prefix : s.seriesPrefix).trim().slice(0, 12);
    const lab = String(o && o.lab || '').trim().slice(0, 12);
    if (!series.sanitize(lab)) return { ok: false, error: 'lab' };
    const folder = series.seriesDir(seriesRoot(), o.discipline, prefix, lab);
    try {
      fs.mkdirSync(folder, { recursive: true });
      let m = fs.existsSync(path.join(folder, series.MANIFEST)) ? series.loadManifest(folder) : null;
      const resumed = !!m;
      if (!m) {
        m = series.newManifest({ prefix, lab, discipline: o.discipline, startFigure: o.startFigure,
          nameTemplate: s.seriesNameTemplate, captionTemplate: s.seriesCaption });
        series.saveManifest(folder, m);
      }
      activateSeries(folder, m);
      return { ok: true, resumed, active: seriesView() };
    } catch (e) {
      return { ok: false, error: 'fs', message: e.message };
    }
  });
  ipcMain.handle('series:open', async (_e, folder) => {
    let f = folder;
    if (!f) {
      const r = await dialog.showOpenDialog(mainWindow, { defaultPath: seriesRoot(), properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
      f = r.filePaths[0];
    }
    const m = fs.existsSync(f) ? series.loadManifest(f) : null;
    if (!m) { if (folder) seriesState.forget(f); return { ok: false, error: 'nomanifest' }; }
    activateSeries(f, m);
    return { ok: true, active: seriesView() };
  });
  ipcMain.handle('series:close', () => { activeSeries = null; seriesState.deactivate(); return { ok: true }; });
  ipcMain.handle('series:step', (_e, mode) => {
    if (!activeSeries) return { ok: false, error: 'noseries' };
    const m = ['region', 'screen', 'window'].includes(mode) ? mode : store.getSettings().seriesMode;
    startCapture(m, true, { series: true, retake: null });
    return { ok: true };
  });
  ipcMain.handle('series:retake', (_e, step) => {
    if (!activeSeries || !activeSeries.manifest.steps.some((x) => x.step === step)) return { ok: false, error: 'nostep' };
    startCapture(store.getSettings().seriesMode, true, { series: true, retake: step });
    return { ok: true };
  });
  ipcMain.handle('series:caption', (_e, step, text) => {
    if (!activeSeries) return { ok: false };
    if (!series.setText(activeSeries.manifest, step, text)) return { ok: false, error: 'nostep' };
    series.saveManifest(activeSeries.folder, activeSeries.manifest);
    return { ok: true, active: seriesView() };
  });
  ipcMain.handle('series:remove', async (_e, step) => {
    if (!activeSeries) return { ok: false };
    const m = activeSeries.manifest;
    const st = m.steps.find((x) => x.step === step);
    if (!st) return { ok: false, error: 'nostep' };
    const file = path.join(activeSeries.folder, st.file);
    const h = store.findHistoryByFile(file);
    if (h) store.removeHistory(h.id);
    series.removeStep(m, step);
    series.saveManifest(activeSeries.folder, m);
    try { if (fs.existsSync(file)) await shell.trashItem(file); } catch (_) {}
    return { ok: true, active: seriesView() };
  });
  ipcMain.handle('series:thumb', (_e, step) => {
    if (!activeSeries) return null;
    const st = activeSeries.manifest.steps.find((x) => x.step === step);
    return st ? thumbOf(path.join(activeSeries.folder, st.file), 320) : null;
  });
  ipcMain.handle('series:entry', (_e, step) => {
    if (!activeSeries) return null;
    const st = activeSeries.manifest.steps.find((x) => x.step === step);
    if (!st) return null;
    const file = path.join(activeSeries.folder, st.file);
    if (!fs.existsSync(file)) return null;
    let e = store.findHistoryByFile(file);
    if (!e) {
      const size = nativeImage.createFromPath(file).getSize();
      e = store.addHistory({ id: crypto.randomUUID(), file, createdAt: st.createdAt || new Date().toISOString(),
        mode: 'series', width: size.width, height: size.height, saved: true });
    }
    return e;
  });
  ipcMain.handle('series:showFile', (_e, step) => {
    if (!activeSeries) return false;
    const st = activeSeries.manifest.steps.find((x) => x.step === step);
    if (st) shell.showItemInFolder(path.join(activeSeries.folder, st.file));
    return !!st;
  });

  // --- история ---
  ipcMain.handle('history:list', () => store.listHistory());
  ipcMain.handle('history:thumb', (_e, id) => {
    const e = store.getHistory(id);
    if (!e) return null;
    const tp = path.join(store.thumbDir, id + '.jpg');
    try {
      if (!fs.existsSync(tp)) {
        const img = nativeImage.createFromPath(e.file);
        if (img.isEmpty()) return null;
        const w = Math.min(360, img.getSize().width);
        fs.writeFileSync(tp, img.resize({ width: w, quality: 'good' }).toJPEG(78));
      }
      return 'data:image/jpeg;base64,' + fs.readFileSync(tp).toString('base64');
    } catch (_) { return null; }
  });
  ipcMain.handle('history:read', (_e, id) => {
    const e = store.getHistory(id);
    if (!e) return null;
    return { bytes: fs.readFileSync(e.file), entry: e };
  });
  ipcMain.handle('history:delete', async (_e, id) => {
    const e = store.removeHistory(id);
    if (e) {
      try {
        if (path.dirname(e.file) === store.cacheDir) fs.unlinkSync(e.file);
        else await shell.trashItem(e.file); // в корзину, а не навсегда
      } catch (_) {}
    }
    return !!e;
  });
  ipcMain.handle('history:clear', () => store.clearHistory());
  ipcMain.handle('history:show', (_e, id) => {
    const e = store.getHistory(id);
    if (e) shell.showItemInFolder(e.file);
    return !!e;
  });
  ipcMain.handle('history:copy', (_e, id) => {
    const e = store.getHistory(id);
    if (!e) return false;
    clipboard.writeImage(nativeImage.createFromPath(e.file));
    return true;
  });
  ipcMain.handle('history:addBytes', (_e, bytes, mode) => {
    const img = nativeImage.createFromBuffer(toBuf(bytes));
    if (img.isEmpty()) return null;
    return saveToHistory(img, mode || 'import').entry;
  });

  // --- редактор и файлы ---
  ipcMain.handle('editor:save', (_e, id, bytes) => {
    const e = store.getHistory(id);
    if (!e) return null;
    const img = nativeImage.createFromBuffer(toBuf(bytes));
    if (img.isEmpty()) return null;
    const s = store.getSettings();
    fs.writeFileSync(e.file, encodeImage(img, path.extname(e.file).toLowerCase(), s.jpgQuality));
    const size = img.getSize();
    try { fs.unlinkSync(path.join(store.thumbDir, id + '.jpg')); } catch (_) {}
    return store.updateHistoryFile(id, { width: size.width, height: size.height });
  });
  ipcMain.handle('file:saveAs', async (_e, bytes, suggested) => {
    const s = store.getSettings();
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(s.saveFolder || defaultFolder(), suggested || 'image.png'),
      filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
    });
    if (r.canceled || !r.filePath) return null;
    const img = nativeImage.createFromBuffer(toBuf(bytes));
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true });
    fs.writeFileSync(r.filePath, encodeImage(img, path.extname(r.filePath).toLowerCase(), s.jpgQuality));
    return r.filePath;
  });
  ipcMain.handle('clipboard:writeImage', (_e, bytes) => {
    const img = nativeImage.createFromBuffer(toBuf(bytes));
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });
  ipcMain.handle('clipboard:writeText', (_e, text) => {
    clipboard.writeText(String(text == null ? '' : text));
    return true;
  });
  ipcMain.handle('clipboard:readImage', () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toPNG();
  });

  ipcMain.handle('files:openImages', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: T('dlg.images'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('files:read', (_e, p) => {
    if (!extOk(p)) return null;
    try { return fs.readFileSync(p); } catch (_) { return null; }
  });
  ipcMain.handle('files:write', (_e, p, bytes) => {
    if (!extOk(p)) return null;
    const s = store.getSettings();
    const ext = path.extname(p).toLowerCase();
    const target = uniquePath(path.dirname(p), path.basename(p, path.extname(p)), ext, fs.existsSync);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const img = nativeImage.createFromBuffer(toBuf(bytes));
    if (img.isEmpty()) return null;
    fs.writeFileSync(target, encodeImage(img, ext, s.jpgQuality));
    return target;
  });
  // открываем только папки: интерфейс не должен запускать произвольные файлы
  ipcMain.handle('shell:openPath', (_e, p) => (isDir(p) ? shell.openPath(String(p)) : ''));
}

// ---------- запуск ----------
app.whenReady().then(() => {
  if (!gotLock) return;
  store = new Store(app.getPath('userData'));
  seriesState = new series.SeriesState(app.getPath('userData'));
  recs = new Recordings(app.getPath('userData'));
  rec = createRecSession({
    electron, store, recs, T, ff,
    paths: { userData: app.getPath('userData'), thumbDir: store.thumbDir, renderer: path.join(__dirname, 'renderer'),
      preload: path.join(__dirname, 'preload.js'), recPreload: path.join(__dirname, 'rec-preload.js'),
      defaultShots: () => defaultFolder() },
    showMain: (nav) => showMain(nav),
    getMainWindow: () => mainWindow,
    notify: (title, body, onClick) => notify(title, body, onClick),
    onTrayChange: () => refreshTray()
  });
  loadActiveSeries();
  nativeTheme.themeSource = store.getSettings().theme;
  if (store.getSettings().autoBackup) {
    try { backup.autoBackupIfDue({ store, extra: extraNow(), version: app.getVersion() }); } catch (_) {}
  }
  Menu.setApplicationMenu(null);
  setupIpc();
  rec.register();
  vid = createVideoSession({
    electron, recs, T, ff,
    paths: { userData: app.getPath('userData'), thumbDir: store.thumbDir },
    getMainWindow: () => mainWindow,
    notify: (title, body, onClick) => notify(title, body, onClick),
    listChanged: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rec:list', recs.list().length); }
  });
  vid.register();
  createMainWindow();
  createTray();
  registerHotkeys();
  applyLoginItem();
  rec.recoverLeftovers();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', (e) => {
  // не теряем идущую запись: сначала останавливаем и сохраняем, потом выходим
  if (rec && rec.isActive() && !quitting) {
    e.preventDefault();
    quitting = true;
    Promise.resolve(rec.state().state === 'finishing' ? null : rec.stop()).finally(() => setTimeout(() => app.quit(), 500));
    return;
  }
  quitting = true;
});
app.on('window-all-closed', () => {
  // при включённом «сворачивать в трей» программа продолжает жить
  if (quitting || !store || !store.getSettings().closeToTray) app.quit();
});
