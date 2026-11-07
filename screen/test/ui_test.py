"""Проверка интерфейса в Chromium с подставным api (без Electron).
Запуск: python3 test/ui_test.py   (нужны playwright и PIL)
"""
import base64, io, os, sys, time, tempfile, subprocess
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('UI_SHOTS', '/home/claude/ui-shots')
os.makedirs(SHOTS, exist_ok=True)


def make_png():
    im = Image.new('RGBA', (400, 300), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    d.rectangle((40, 40, 140, 140), fill=(0, 0, 0, 255))
    d.rectangle((200, 60, 360, 200), fill=(0, 0, 255, 255))
    d.rectangle((20, 220, 120, 280), fill=(255, 0, 0, 128))  # полупрозрачный красный
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()


PNG = make_png()
PNG_B64 = base64.b64encode(PNG).decode()

INIT = r"""
(() => {
  const b64 = '%PNG%';
  const bytes = () => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const calls = { capture: [], setSettings: [], saved: {}, saveAs: [], copied: 0, written: [], deleted: [], added: [], shown: [],
    seriesStep: [], seriesRetake: [], seriesRemove: [], seriesCaption: [], backupCreate: 0, backupRestore: 0, exportS: 0, importS: 0,
    resetS: 0, text: [], opened: [], seriesCreate: [], seriesOpen: [] };
  window.__calls = calls;
  const DEF_HK = { region: 'PrintScreen', screen: 'Ctrl+PrintScreen', window: 'Alt+PrintScreen', seriesStep: 'Ctrl+Shift+PrintScreen', recToggle: 'Ctrl+Shift+R', recPause: 'Ctrl+Shift+P', recRegion: 'Ctrl+Shift+A' };
  let settings = {
    saveFolder: '', format: 'png', jpgQuality: 92, fileTemplate: 'Снимок_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}', dateFolders: 'none',
    autosave: true, copyToClipboard: true, openEditor: true, notify: true, sound: false, delaySec: 0,
    hotkeys: Object.assign({}, DEF_HK),
    animations: true, rememberWindow: true,
    recFolder: '', recMode: 'screen', recFormat: 'mp4', recFps: 30, recQuality: 'medium', recCursor: true, recSystemAudio: true, recSystemGain: 100,
    recMic: false, recMicGain: 100, recMicDevice: '', recWebcam: false, recCamDevice: '', recCamCorner: 'br', recCamSize: 20, recCamShape: 'circle',
    recPanel: true, recHideWindow: true, recMaxMinutes: 60, recMaxMB: 2048, recMinFreeMB: 1024, recNotify: true,
    language: 'ru', theme: 'dark', accent: '#7c9cff', uiScale: 100, autostart: false, startHidden: false, closeToTray: true,
    historyLimit: 500, autoBackup: true,
    seriesMode: 'region', seriesPrefix: 'ЛР', seriesNameTemplate: '{prefix}{lab}_шаг{step}', seriesCaption: 'Рисунок {n} — {text}',
    seriesRoot: '', seriesOpenEditor: false, editor: { color: '#ef4444', width: 4 }
  };
  const hk = { region: 'ok', screen: 'ok', window: 'busy', seriesStep: 'ok', recToggle: 'ok', recPause: 'ok', recRegion: 'busy' };
  const entry = (id, mode) => ({ id, file: 'C:\\Users\\me\\Pictures\\Скриншоты\\Снимок_' + id + '.png', createdAt: new Date().toISOString(), mode, width: 400, height: 300, saved: true });
  let hist = [entry('h1', 'region'), entry('h2', 'screen')];
  const thumb = 'data:image/png;base64,' + b64;
  window.__files = { 'C:\\pics\\a.png': bytes(), 'C:\\pics\\b.jpg': bytes() };
  window.__clip = null;

  // ----- серия -----
  let ser = null; let recent = [{ folder: 'D:\\Labs\\ЛР3', title: 'ЛР3 · АСОС', steps: 4 }];
  const S = () => window.Shared;
  const view = () => {
    if (!ser) return null;
    ser.steps.forEach((s, i) => { s.figure = ser.startFigure + i; s.caption = S().captionFor(settings.seriesCaption, s.figure, s.text); });
    return { folder: ser.folder, title: ser.prefix + ser.lab + (ser.discipline ? ' · ' + ser.discipline : ''), prefix: ser.prefix, lab: ser.lab,
      discipline: ser.discipline, startFigure: ser.startFigure, nextStep: ser.steps.reduce((a, s) => Math.max(a, s.step), 0) + 1,
      nextFigure: ser.startFigure + ser.steps.length,
      steps: ser.steps.map(s => ({ step: s.step, figure: s.figure, fileName: s.file, file: ser.folder + '\\' + s.file, text: s.text, caption: s.caption, createdAt: '', exists: true })) };
  };
  let fireSeries = () => {};
  window.__simStep = () => {
    const n = ser.steps.reduce((a, s) => Math.max(a, s.step), 0) + 1;
    ser.steps.push({ step: n, file: S().stepBase(settings.seriesNameTemplate, { prefix: ser.prefix, lab: ser.lab, step: n }) + '.png', text: '' });
    fireSeries();
  };
  let lastBackup = null;

  // ----- запись -----
  let recState = { state: 'idle', elapsedMs: 0, bytes: 0, paused: false, maxMs: 0, progress: 0, warnings: [] };
  let recList = [{ id: 'r1', file: 'C:\\Rec\\Запись_1.mp4', createdAt: new Date().toISOString(), mode: 'screen', format: 'mp4', duration: 75.4, width: 1920, height: 1080, hasAudio: true, size: 5242880 }];
  window.__setRecList = (l) => { recList = l; };
  let fireRec = () => {}, fireRecList = () => {};
  window.__setRec = (st) => { recState = Object.assign(recState, st); fireRec(recState); };
  window.__rc = { start: [], stop: 0, pause: 0, play: [], show: [], del: [], opened: 0, windows: 0 };
  window.api = {
    recState: async () => recState,
    recStart: async (o) => { window.__rc.start.push(o); window.__setRec({ state: 'recording', elapsedMs: 0, mode: o.mode }); return { ok: true }; },
    recStop: async () => { window.__rc.stop++; window.__setRec({ state: 'finishing', progress: 0.4 }); return { ok: true }; },
    recPause: async () => { window.__rc.pause++; window.__setRec({ paused: !recState.paused, state: recState.paused ? 'recording' : 'paused' }); return { ok: true }; },
    recWindows: async () => { window.__rc.windows++; return [{ id: 'window:1:0', name: 'Multisim' }, { id: 'window:2:0', name: 'Word' }]; },
    recList: async () => recList.slice(),
    recThumb: async () => thumb,
    recPlay: async (id) => { window.__rc.play.push(id); return true; },
    recShow: async (id) => { window.__rc.show.push(id); return true; },
    recOpenFolder: async () => { window.__rc.opened++; return ''; },
    recDelete: async (id) => { window.__rc.del.push(id); recList = recList.filter(x => x.id !== id); return true; },
    recRename: async () => null,
    onRecState: (cb) => { fireRec = cb; return () => {}; },
    onRecList: (cb) => { fireRecList = cb; return () => {}; },
    getSettings: async () => JSON.parse(JSON.stringify(settings)),
    setSettings: async (p) => {
      calls.setSettings.push(JSON.parse(JSON.stringify(p)));
      for (const k of Object.keys(p)) {
        if ((k === 'hotkeys' || k === 'editor') && p[k]) settings[k] = Object.assign({}, settings[k], p[k]); else settings[k] = p[k];
      }
      return { settings: JSON.parse(JSON.stringify(settings)), hotkeys: hk };
    },
    chooseFolder: async () => 'D:\\Shots', chooseOutFolder: async () => 'D:\\Out',
    hotkeyStatus: async () => hk,
    appInfo: async () => ({ version: '0.2.0', dataDir: 'C:\\Users\\me\\AppData\\Roaming\\MoiScreenshot', backupDir: 'C:\\Users\\me\\AppData\\Roaming\\MoiScreenshot\\backups',
      defaultFolder: 'C:\\Users\\me\\Pictures\\Скриншоты', seriesRoot: 'C:\\Users\\me\\Pictures\\Скриншоты\\Лабораторные', packaged: true,
      electron: '33.4.11', chrome: '130.0.6723.191', node: '20.18.1', platform: 'win32', arch: 'x64', migrated: null }),
    exportSettings: async () => { calls.exportS++; return { ok: true, file: 'C:\\Docs\\moi-screenshot-settings.json' }; },
    importSettings: async () => { calls.importS++; return { ok: true }; },
    resetSettings: async () => { calls.resetS++; return { ok: true }; },
    backupInfo: async () => ({ dir: 'x', count: lastBackup ? 1 : 0, last: lastBackup }),
    backupCreate: async () => { calls.backupCreate++; lastBackup = { name: 'backup-x_manual.json', kind: 'manual', mtime: Date.now() }; return { ok: true, info: { dir: 'x', count: 1, last: lastBackup } }; },
    backupRestore: async () => { calls.backupRestore++; return { ok: true }; },
    backupOpenDir: async () => { calls.opened.push('backups'); return ''; },
    capture: async (m) => { calls.capture.push(m); return { ok: true }; },
    onCaptured: (cb) => { window.__fireCaptured = cb; return () => {}; },
    onNavigate: (cb) => { window.__fireNav = cb; return () => {}; },
    onSeriesChanged: (cb) => { fireSeries = cb; return () => {}; },
    seriesState: async () => ({ active: view(), recent }),
    seriesPreview: async (o) => ({ ok: !!S().sanitize(o.lab), folder: 'C:\\Labs\\' + (o.discipline ? o.discipline + '\\' : '') + o.prefix + o.lab, exists: false }),
    seriesCreate: async (o) => {
      calls.seriesCreate.push(o);
      if (!S().sanitize(o.lab)) return { ok: false, error: 'lab' };
      ser = { folder: 'C:\\Labs\\' + (o.discipline ? o.discipline + '\\' : '') + o.prefix + o.lab, prefix: o.prefix, lab: o.lab, discipline: o.discipline || '', startFigure: o.startFigure, steps: [] };
      return { ok: true, resumed: false, active: view() };
    },
    seriesOpen: async (folder) => {
      calls.seriesOpen.push(folder || null);
      ser = { folder: folder || 'D:\\Labs\\ЛР3', prefix: 'ЛР', lab: '3', discipline: 'АСОС', startFigure: 1, steps: [{ step: 1, file: 'ЛР3_шаг1.png', text: 'Схема' }] };
      return { ok: true, active: view() };
    },
    seriesClose: async () => { ser = null; return { ok: true }; },
    seriesStep: async (mode) => { calls.seriesStep.push(mode); setTimeout(() => window.__simStep(), 20); return { ok: true }; },
    seriesRetake: async (step) => { calls.seriesRetake.push(step); return { ok: true }; },
    seriesCaption: async (step, text) => { calls.seriesCaption.push([step, text]); const s = ser.steps.find(x => x.step === step); s.text = text.trim(); return { ok: true, active: view() }; },
    seriesRemove: async (step) => { calls.seriesRemove.push(step); ser.steps = ser.steps.filter(x => x.step !== step); return { ok: true, active: view() }; },
    seriesThumb: async () => thumb,
    seriesEntry: async (step) => ({ id: 'h1' }),
    seriesShowFile: async (step) => { calls.shown.push('step' + step); return true; },
    history: async () => hist.slice(),
    thumb: async () => thumb,
    readImage: async (id) => { const e = hist.find(x => x.id === id); return e ? { bytes: bytes(), entry: e } : null; },
    deleteHistory: async (id) => { calls.deleted.push(id); hist = hist.filter(x => x.id !== id); return true; },
    clearHistory: async () => { hist = []; return 2; },
    showInFolder: async (id) => { calls.shown.push(id); return true; },
    copyHistory: async () => true,
    saveEdited: async (id, b) => { calls.saved[id] = Array.from(b); return hist.find(x => x.id === id); },
    vidPick: async () => { calls.vidPick = (calls.vidPick || 0) + 1; return (window.__vidFiles || []).slice(0, 1); },
    vidFromLibrary: async (id) => (window.__vidFiles || [])[1] || null,
    vidExport: async (payload) => { window.__vidExport = payload; if (window.__fireVid) { window.__fireVid({ state: 'running', p: 0.4 }); } return { ok: true, file: 'D:\\x\\out.mp4' }; },
    vidFrame: async () => bytes(),
    vidCancel: async () => true,
    onVidProgress: (cb) => { window.__fireVid = cb; return () => {}; },
    saveAs: async (b, name) => { calls.saveAs.push({ n: b.length, name }); window.__lastSaveAs = Array.from(b); return 'D:\\x\\' + name; },
    copyImage: async (b) => { calls.copied++; window.__lastCopy = Array.from(b); return true; },
    copyText: async (t) => { calls.text.push(t); return true; },
    addToHistory: async (b, mode) => { const e = entry('n' + (hist.length + 1), mode); calls.added.push({ mode, n: b.length }); hist.unshift(e); window.__lastAdded = Array.from(b); return e; },
    openImages: async () => ['C:\\pics\\a.png', 'C:\\pics\\b.jpg'],
    readFile: async (p) => window.__files[p] || null,
    writeFile: async (p, b) => { calls.written.push({ p, data: Array.from(b) }); return p; },
    readClipboardImage: async () => window.__clip,
    pathForFile: (f) => 'C:\\dropped\\' + f.name,
    openFolder: async (p) => { calls.opened.push(p); return ''; }
  };
  window.overlayApi = {
    onInit: (cb) => { window.__ovInit = cb; return () => {}; },
    done: (r) => { window.__ovDone = r; }, cancel: () => { window.__ovCancel = (window.__ovCancel || 0) + 1; }
  };
})();
""".replace('%PNG%', PNG_B64)

results = []


def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('  ok  ' if cond else 'FAIL  ') + name + (('  -> ' + str(extra)) if (extra and not cond) else ''))


def waitf(pg, expr, timeout=8.0):
    """Ожидание условия опросом через evaluate (wait_for_function не работает при строгой CSP страницы)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if pg.evaluate(expr): return True
        except Exception:
            pass
        time.sleep(0.05)
    raise AssertionError('timeout waiting for: ' + expr)


def px(page, sel, x, y):
    return page.evaluate("""([sel,x,y]) => Array.from(document.querySelector(sel).getContext('2d').getImageData(x,y,1,1).data)""", [sel, x, y])


def near(a, b, tol=6):
    return all(abs(i - j) <= tol for i, j in zip(a, b))


def img_to_screen(page, ix, iy):
    box = page.locator('#ed-canvas').bounding_box()
    w, h = page.evaluate("[document.getElementById('ed-canvas').width, document.getElementById('ed-canvas').height]")
    return box['x'] + ix * box['width'] / w, box['y'] + iy * box['height'] / h


def drag(page, a, b, steps=8):
    x1, y1 = img_to_screen(page, *a); x2, y2 = img_to_screen(page, *b)
    page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=steps); page.mouse.up()


def tool(page, name):
    page.click(f'[data-tool="{name}"]')


def decode(arr):
    return Image.open(io.BytesIO(bytes(arr))).convert('RGBA')


def nav(page, name):
    page.click(f'#nav button[data-page="{name}"]')


def tab(page, name):
    nav(page, 'settings')
    page.click(f'#set-tabs button[data-tab="{name}"]')


def css(page, expr):
    return page.evaluate(expr)


def bg(page):
    return page.evaluate("getComputedStyle(document.body).backgroundColor")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error',) else None)
    page.on('dialog', lambda d: d.accept())  # confirm() в программе: всегда «ОК»
    page.add_init_script(INIT)
    page.goto('file://' + ROOT + '/renderer/index.html')
    waitf(page, 'window.__app')

    # ================= запуск и навигация =================
    check('страница загрузилась без ошибок', not errors, errors)
    check('версия показана в боковой панели', '0.2.0' in page.inner_text('#ver'))
    for pg in ['capture', 'series', 'editor', 'history', 'invert', 'settings']:
        nav(page, pg)
        check(f'вкладка «{pg}» открывается', page.evaluate(f"document.getElementById('page-{pg}').classList.contains('active')"))

    # ================= оформление: тема, акцент =================
    check('тёмная тема: фон из палитры проекта #0c0d10', bg(page) == 'rgb(12, 13, 16)', bg(page))
    check('акцент по умолчанию #7c9cff', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == '#7c9cff')
    check('текст на акценте тёмный (контраст)', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim()") == '#0c0d10')
    tab(page, 'general')
    page.select_option('#set-theme', 'light')
    check('светлая тема меняет фон', bg(page) == 'rgb(244, 245, 248)', bg(page))
    check('тема сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.theme === 'light')"))
    page.select_option('#set-theme', 'system')
    check('«как в Windows» при тёмной системе = тёмная', bg(page) == 'rgb(12, 13, 16)', bg(page))
    page.emulate_media(color_scheme='light')
    waitf(page, "getComputedStyle(document.body).backgroundColor === 'rgb(244, 245, 248)'")
    check('«как в Windows»: смена системной темы на светлую подхватывается на лету', True)
    page.emulate_media(color_scheme='dark')
    waitf(page, "getComputedStyle(document.body).backgroundColor === 'rgb(12, 13, 16)'")
    check('«как в Windows»: и обратно на тёмную', True)
    page.select_option('#set-theme', 'dark')
    page.click('#set-accent-sw .sw:nth-child(3)')  # #22c55e
    check('цвет акцента применяется сразу', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == '#22c55e')
    check('цвет акцента сохраняется в настройках', page.evaluate("window.__calls.setSettings.some(s => s.accent === '#22c55e')"))
    check('выбранный образец акцента подсвечен', page.evaluate("document.querySelector('#set-accent-sw .sw.on').dataset.c") == '#22c55e')
    page.evaluate("document.getElementById('set-accent').value='#fff3a0'; document.getElementById('set-accent').dispatchEvent(new Event('input'))")
    check('светлый акцент: текст на кнопках остаётся тёмным', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim()") == '#0c0d10')
    page.evaluate("document.getElementById('set-accent').value='#1a237e'; document.getElementById('set-accent').dispatchEvent(new Event('input'))")
    check('тёмный акцент: текст на кнопках становится белым', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim()") == '#ffffff')
    page.click('#set-accent-reset')
    check('сброс акцента', css(page, "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == '#7c9cff')
    page.screenshot(path=SHOTS + '/10-settings-general.png')

    # ================= язык =================
    page.select_option('#set-lang', 'en')
    check('язык EN: боковое меню переведено', page.inner_text('#nav button[data-page="capture"]') == 'Capture' and page.inner_text('#nav button[data-page="settings"]') == 'Settings')
    check('язык EN: вкладки настроек переведены', page.inner_text('#set-tabs button[data-tab="changelog"]') == "What's new")
    check('язык EN: <html lang="en">', page.evaluate("document.documentElement.lang") == 'en')
    check('язык EN: заголовок страницы', page.title() == 'My Screenshots', page.title())
    check('язык EN: подсказки (title) переведены', page.evaluate("document.querySelector('[data-tool=\"arrow\"]').title") == '↗ Arrow')
    nav(page, 'series')
    check('язык EN: страница серии', page.inner_text('#page-series h1') == 'Lab series' and page.get_attribute('#ser-lab', 'placeholder') == 'for example, 5')
    nav(page, 'capture')
    check('язык EN: вкладка снимка', page.inner_text('#page-capture h1') == 'Take a screenshot')
    check('язык сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.language === 'en')"))
    tab(page, 'changelog')
    check('язык EN: «Что нового» на английском', 'added' in page.inner_text('#changelog').lower() and 'Record tab' in page.inner_text('#changelog'))
    page.screenshot(path=SHOTS + '/11-changelog-en.png')
    page.select_option('#set-lang', 'ru') if page.is_visible('#set-lang') else None
    nav(page, 'settings'); page.click('#set-tabs button[data-tab="general"]')
    page.select_option('#set-lang', 'ru')
    check('возврат на русский', page.inner_text('#nav button[data-page="capture"]') == 'Снимок' and page.title() == 'Мои скриншоты')

    # масштаб
    page.select_option('#set-scale', '125')
    check('масштаб интерфейса сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.uiScale === 125)"))
    page.select_option('#set-scale', '100')
    # чекбоксы «Программа»
    for sel, key in [('#set-autostart', 'autostart'), ('#set-starthidden', 'startHidden'), ('#set-sound', 'sound')]:
        page.check(sel)
        check(f'настройка «{key}» сохраняется', page.evaluate(f"window.__calls.setSettings.some(s => s.{key} === true)"))
        page.uncheck(sel)
    page.uncheck('#set-notify')
    check('«уведомления» связаны с галочкой на вкладке «Снимок»', page.evaluate("window.__calls.setSettings.some(s => s.notify === false)")
          and not page.is_checked('[data-quick="notify"]'))
    page.check('#set-notify')

    # ================= вкладки настроек =================
    for t_ in ['general', 'capture', 'series', 'data', 'about', 'changelog']:
        page.click(f'#set-tabs button[data-tab="{t_}"]')
        ok = page.evaluate(f"document.getElementById('pane-{t_}').classList.contains('active') && document.querySelectorAll('.tabpane.active').length === 1")
        check(f'вкладка настроек «{t_}» показывается одна', ok)

    # ---- съёмка: горячие клавиши и сохранение ----
    page.click('#set-tabs button[data-tab="capture"]')
    check('бейджи горячих клавиш: работает/занято', page.inner_text('[data-hk-status="region"]') == 'работает' and page.inner_text('[data-hk-status="window"]') == 'занято')
    page.evaluate('window.__calls.setSettings.length = 0')
    page.focus('[data-hk-field="screen"]'); page.keyboard.press('Control+Shift+KeyS')
    check('запись сочетания клавиш', page.evaluate("window.__calls.setSettings.some(s => s.hotkeys && s.hotkeys.screen === 'Ctrl+Shift+S')") and page.input_value('[data-hk-field="screen"]') == 'Ctrl+Shift+S', page.input_value('[data-hk-field="screen"]'))
    page.focus('[data-hk-field="window"]'); page.keyboard.press('Backspace')
    check('Backspace очищает сочетание', page.evaluate("window.__calls.setSettings.some(s => s.hotkeys && s.hotkeys.window === '')"))
    page.focus('[data-hk-field="region"]'); page.keyboard.press('KeyA')
    check('одиночная буква не принимается', page.evaluate("!window.__calls.setSettings.some(s => s.hotkeys && s.hotkeys.region === 'A')"))
    page.click('#set-hk-reset')
    waitf(page, "document.querySelector('[data-hk-field=\"screen\"]').value === 'Ctrl+PrintScreen'")
    check('«вернуть клавиши по умолчанию»', page.input_value('[data-hk-field="window"]') == 'Alt+PrintScreen' and page.input_value('[data-hk-field="seriesStep"]') == 'Ctrl+Shift+PrintScreen')
    page.select_option('#set-format', 'jpg')
    check('JPG включает ползунок качества', not page.is_disabled('#set-quality'))
    page.fill('#set-template', 'Shot_{yyyy}_{mode}')
    check('пример имени файла обновляется', page.inner_text('#set-example').startswith('Shot_20') and page.inner_text('#set-example').endswith('_region.jpg'), page.inner_text('#set-example'))
    page.click('#set-folder-btn'); waitf(page, "window.__calls.setSettings.some(s => s.saveFolder === 'D:\\\\Shots')")
    check('выбор папки сохранения', page.input_value('#set-folder') == 'D:\\Shots')
    page.select_option('#set-datefolders', 'month')
    check('подпапки по дате сохраняются', page.evaluate("window.__calls.setSettings.some(s => s.dateFolders === 'month')"))
    page.select_option('#set-format', 'png'); page.fill('#set-template', 'Снимок_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}')
    page.screenshot(path=SHOTS + '/12-settings-capture.png')

    # ---- серия: настройки ----
    page.click('#set-tabs button[data-tab="series"]')
    check('пример имени и подписи серии', page.inner_text('#set-series-example') == 'ЛР5_шаг3.png · Рисунок 3 — Схема', page.inner_text('#set-series-example'))
    page.fill('#set-series-caption', 'Рис. {n}. {text}')
    check('пример подписи следует за шаблоном', page.inner_text('#set-series-example').endswith('Рис. 3. Схема'), page.inner_text('#set-series-example'))
    page.fill('#set-series-name', '{prefix}-{lab}-{step}')
    check('пример имени следует за шаблоном', page.inner_text('#set-series-example').startswith('ЛР-5-3.png'), page.inner_text('#set-series-example'))
    page.fill('#set-series-caption', 'Рисунок {n} — {text}'); page.fill('#set-series-name', '{prefix}{lab}_шаг{step}')
    page.select_option('#set-series-mode', 'window')
    check('режим шага серии сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.seriesMode === 'window')"))
    page.select_option('#set-series-mode', 'region')
    page.check('#set-series-editor')
    check('«открывать редактор после шага» сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.seriesOpenEditor === true)"))
    page.uncheck('#set-series-editor')
    page.click('#set-series-root-btn'); waitf(page, "window.__calls.setSettings.some(s => s.seriesRoot === 'D:\\\\Shots')")
    check('папка серий выбирается', page.input_value('#set-series-root') == 'D:\\Shots')
    page.click('#set-series-root-reset')
    check('папка серий сбрасывается', 'Лабораторные' in page.input_value('#set-series-root'))
    page.screenshot(path=SHOTS + '/13-settings-series.png')

    # ---- данные и копии ----
    page.click('#set-tabs button[data-tab="data"]')
    check('папка данных показана', 'MoiScreenshot' in page.inner_text('#set-datadir'))
    check('«копий пока нет»', page.inner_text('#set-lastbackup') == 'пока нет')
    page.click('#set-backup-now'); waitf(page, 'window.__calls.backupCreate == 1')
    waitf(page, "document.getElementById('set-lastbackup').textContent !== 'пока нет'")
    check('ручная копия создаётся и показывается', 'ручная' in page.inner_text('#set-lastbackup'), page.inner_text('#set-lastbackup'))
    page.select_option('#set-histlimit', '100')
    check('лимит истории сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.historyLimit === 100)"))
    page.select_option('#set-histlimit', '500')
    page.uncheck('#set-autobackup')
    check('автокопия включается и выключается', page.evaluate("window.__calls.setSettings.some(s => s.autoBackup === false)"))
    page.check('#set-autobackup')
    page.click('#set-opendata'); page.click('#set-backup-open')
    check('кнопки «открыть папку»', page.evaluate("window.__calls.opened.includes('C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\MoiScreenshot') && window.__calls.opened.includes('backups')"))
    page.click('#set-export'); waitf(page, 'window.__calls.exportS == 1')
    check('экспорт настроек', 'saved' in page.inner_text('#toast').lower() or 'сохранены' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.screenshot(path=SHOTS + '/14-settings-data.png')
    # импорт / восстановление / сброс перезагружают страницу: проверяем вызов и ждём перезагрузку
    for btn, key in [('#set-import', 'importS'), ('#set-backup-restore', 'backupRestore'), ('#set-reset', 'resetS')]:
        page.evaluate('window.__marker = 1')
        page.click(btn)
        waitf(page, f'window.__calls.{key} == 1')
        waitf(page, '!window.__marker')
        check(f'«{key}»: вызов выполнен после подтверждения', True)
        page.wait_for_load_state('load')
        waitf(page, 'window.__app')
        check(f'«{key}»: интерфейс перезагрузился', True)
        nav(page, 'settings'); page.click('#set-tabs button[data-tab="data"]')

    # ---- о программе ----
    page.click('#set-tabs button[data-tab="about"]')
    check('«О программе»: название и версия', page.inner_text('.about-name') == 'Мои скриншоты' and page.inner_text('#ab-ver') == '0.2.0')
    check('«О программе»: метка «бета» у версии 0.x', not page.is_hidden('#ab-beta'))
    check('«О программе»: описание', 'серии шагов для лабораторных' in page.inner_text('.about-desc'))
    check('«О программе»: иконка загрузилась', page.evaluate("document.querySelector('.about-icon').naturalWidth") > 0)
    tb = page.inner_text('#ab-table')
    check('«О программе»: сведения о сборке', all(x in tb for x in ['33.4.11', '130.0.6723.191', '20.18.1', 'win32 x64', 'MoiScreenshot']), tb)
    check('«О программе»: блок про диск, сеть и память', all(x in page.inner_text('#pane-about') for x in ['Диск:', 'Сеть:', 'Память']))
    page.screenshot(path=SHOTS + '/15-about.png')

    # ---- что нового ----
    page.click('#set-tabs button[data-tab="changelog"]')
    check('«Что нового»: четыре версии', page.locator('#changelog details.cl').count() == 4)
    vs = page.evaluate("Array.from(document.querySelectorAll('#changelog .cl-v')).map(e => e.textContent)")
    check('«Что нового»: порядок версий от новой к старой', vs == ['v0.2.0', 'v0.1.0', 'v0.0.2', 'v0.0.1'], vs)
    check('«Что нового»: свежая версия раскрыта, остальные свёрнуты', page.evaluate("Array.from(document.querySelectorAll('#changelog details')).map(d => d.open)") == [True, False, False, False])
    check('«Что нового»: метка «последняя» и «бета»', page.locator('#changelog .tag-new').count() == 1 and page.locator('#changelog .tag-beta').count() == 4)
    page.evaluate("document.querySelectorAll('#changelog details').forEach(d => d.open = true)")
    ctext = page.inner_text('#changelog')
    check('«Что нового»: есть разделы и записи', all(x in ctext.lower() for x in ['добавлено', 'исправлено', 'что проверить', 'cannot create symbolic link', 'называлась 1.0.0']), ctext[:200])
    page.screenshot(path=SHOTS + '/16-changelog.png', full_page=False)

    # ================= серия для лабораторной =================
    nav(page, 'series')
    check('серия: форма «Новая серия» показана, активной серии нет', not page.is_hidden('#ser-none') and page.is_hidden('#ser-active'))
    check('серия: приставка по умолчанию «ЛР»', page.input_value('#ser-prefix') == 'ЛР')
    check('серия: недавняя серия в списке', 'ЛР3 · АСОС' in page.inner_text('#ser-recent'))
    page.click('#ser-create')
    check('серия: без номера работы не создаётся', page.evaluate('window.__calls.seriesCreate.length') == 0 and not page.is_hidden('#toast'))
    page.fill('#ser-lab', '5'); page.fill('#ser-disc', 'Схемотехника'); page.fill('#ser-fig', '3')
    waitf(page, "document.getElementById('ser-willsave').textContent.includes('Схемотехника')")
    check('серия: предпросмотр имени и подписи', page.inner_text('#ser-preview') == 'ЛР5_шаг1.png · Рисунок 3', page.inner_text('#ser-preview'))
    check('серия: предпросмотр папки', page.inner_text('#ser-willsave').endswith('Схемотехника\\ЛР5'), page.inner_text('#ser-willsave'))
    page.screenshot(path=SHOTS + '/20-series-new.png')
    page.click('#ser-create')
    waitf(page, "!document.getElementById('ser-active').hidden")
    check('серия: создана с нужными параметрами', page.evaluate('window.__calls.seriesCreate[0]') == {'prefix': 'ЛР', 'lab': '5', 'discipline': 'Схемотехника', 'startFigure': 3})
    check('серия: заголовок активной серии', page.inner_text('#ser-title') == 'ЛР5 · Схемотехника', page.inner_text('#ser-title'))
    check('серия: следующий шаг и рисунок', page.inner_text('#ser-next') == 'Следующий шаг: 1 · рисунок 3', page.inner_text('#ser-next'))
    check('серия: подсказка горячей клавиши', page.inner_text('kbd[data-hk="seriesStep"]') == 'Ctrl+Shift+PrintScreen')
    check('серия: пока нет шагов', not page.is_hidden('#ser-empty'))
    page.click('#ser-step'); waitf(page, "document.querySelectorAll('#ser-list .step').length == 1")
    check('серия: шаг снимается в выбранном режиме', page.evaluate('window.__calls.seriesStep') == ['region'])
    page.click('#ser-step'); waitf(page, "document.querySelectorAll('#ser-list .step').length == 2")
    titles = page.evaluate("Array.from(document.querySelectorAll('.step-title')).map(e => e.textContent)")
    check('серия: сквозная нумерация рисунков с 3', titles == ['Шаг 1 · Рисунок 3', 'Шаг 2 · Рисунок 4'], titles)
    files = page.evaluate("Array.from(document.querySelectorAll('.step-file')).map(e => e.textContent)")
    check('серия: имена файлов ЛР5_шагN', files == ['ЛР5_шаг1.png', 'ЛР5_шаг2.png'], files)
    check('серия: подпись без описания — просто «Рисунок N»', page.inner_text('[data-cap="1"]') == 'Рисунок 3', page.inner_text('[data-cap="1"]'))
    check('серия: у шагов есть миниатюры', page.evaluate("Array.from(document.querySelectorAll('.step-th img')).every(i => i.src.startsWith('data:image'))"))
    check('серия: следующий шаг после двух', page.inner_text('#ser-next') == 'Следующий шаг: 3 · рисунок 5', page.inner_text('#ser-next'))
    page.fill('.step-text[data-step="2"]', 'Схема усилителя'); page.keyboard.press('Enter')
    waitf(page, "document.querySelector('[data-cap=\"2\"]').textContent === 'Рисунок 4 — Схема усилителя'")
    check('серия: подпись «Рисунок N — описание»', page.evaluate('window.__calls.seriesCaption') == [[2, 'Схема усилителя']])
    page.fill('.step-text[data-step="1"]', 'Исходная схема'); page.dispatch_event('.step-text[data-step="1"]', 'change')
    waitf(page, "document.querySelector('[data-cap=\"1\"]').textContent === 'Рисунок 3 — Исходная схема'")
    check('серия: правка подписи первого шага', True)
    page.screenshot(path=SHOTS + '/21-series-active.png')
    page.click('#ser-copycaps'); waitf(page, 'window.__calls.text.length == 1')
    check('серия: копирование списка подписей', page.evaluate('window.__calls.text[0]') == 'Рисунок 3 — Исходная схема\nРисунок 4 — Схема усилителя', page.evaluate('window.__calls.text[0]'))
    page.select_option('#ser-mode', 'window')
    check('серия: выбор режима шага сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.seriesMode === 'window')"))
    page.click('#ser-step'); waitf(page, "document.querySelectorAll('#ser-list .step').length == 3")
    check('серия: режим «окно» передаётся при шаге', page.evaluate('window.__calls.seriesStep') == ['region', 'region', 'window'])
    page.select_option('#ser-mode', 'region')
    # переснять и редактировать
    page.locator('.step').nth(1).locator('button', has_text='Переснять').click()
    waitf(page, 'window.__calls.seriesRetake.length == 1')
    check('серия: «Переснять» вызывает нужный шаг', page.evaluate('window.__calls.seriesRetake') == [2])
    page.locator('.step').first.locator('button', has_text='Редактировать').click()
    waitf(page, "document.getElementById('page-editor').classList.contains('active')")
    check('серия: «Редактировать» открывает шаг в редакторе', page.evaluate("Editor.entry() && Editor.entry().id") == 'h1')
    nav(page, 'series')
    # удаление: рисунки пересчитываются, номера шагов остаются
    page.locator('.step').first.locator('button.danger').click()
    waitf(page, "document.querySelectorAll('#ser-list .step').length == 2")
    titles = page.evaluate("Array.from(document.querySelectorAll('.step-title')).map(e => e.textContent)")
    check('серия: после удаления рисунки идут подряд, номера шагов не меняются', titles == ['Шаг 2 · Рисунок 3', 'Шаг 3 · Рисунок 4'], titles)
    check('серия: следующий шаг не занимает удалённый номер', page.inner_text('#ser-next') == 'Следующий шаг: 4 · рисунок 5', page.inner_text('#ser-next'))
    # завершить и продолжить
    page.click('#ser-close'); waitf(page, "document.getElementById('ser-active').hidden")
    check('серия: завершение возвращает форму', not page.is_hidden('#ser-none'))
    page.click('#ser-open-recent'); waitf(page, "!document.getElementById('ser-active').hidden")
    check('серия: продолжение недавней', page.inner_text('#ser-title') == 'ЛР3 · АСОС' and page.evaluate('window.__calls.seriesOpen')[-1] == 'D:\\Labs\\ЛР3', page.inner_text('#ser-title'))
    page.click('#ser-openfolder')
    check('серия: «Открыть папку серии»', page.evaluate("window.__calls.opened.includes('D:\\\\Labs\\\\ЛР3')"))
    # шаг приходит снаружи (горячая клавиша) — страница обновляется сама
    page.evaluate('window.__simStep()')
    waitf(page, "document.querySelectorAll('#ser-list .step').length == 2")
    check('серия: шаг по горячей клавише появляется без действий пользователя', True)
    # английский
    page.evaluate("window.__app.save({ language: 'en' }, true)")
    waitf(page, "document.getElementById('ser-step').textContent === 'Take a step'")
    check('серия: карточки шагов переведены (EN)', page.inner_text('.step-title').startswith('Step 1 · Figure 1') and page.inner_text('#ser-next').startswith('Next step'), page.inner_text('.step-title'))
    page.screenshot(path=SHOTS + '/22-series-en.png')
    page.evaluate("window.__app.save({ language: 'ru' }, true)")
    waitf(page, "document.getElementById('ser-step').textContent === 'Сделать шаг'")
    page.click('#ser-close')

    # ================= вкладка «Снимок» =================
    nav(page, 'capture')
    check('подписи горячих клавиш', page.inner_text('kbd[data-hk="region"]') == 'PrintScreen' and page.inner_text('kbd[data-hk="window"]') == 'Alt+PrintScreen')
    page.evaluate('window.__calls.capture.length = 0')
    page.click('[data-capture="region"]'); page.click('[data-capture="screen"]'); page.click('[data-capture="window"]')
    check('кнопки запускают съёмку', page.evaluate('window.__calls.capture') == ['region', 'screen', 'window'])
    page.uncheck('[data-quick="copyToClipboard"]')
    check('галочка «копировать» сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.copyToClipboard === false)"))
    page.fill('[data-quick="delaySec"]', '5'); page.dispatch_event('[data-quick="delaySec"]', 'change')
    check('задержка сохраняется', page.evaluate("window.__calls.setSettings.some(s => s.delaySec === 5)"))
    check('последний снимок показан', page.is_visible('#last-panel') and 'Снимок_h1' in page.inner_text('#last-info'))
    page.screenshot(path=SHOTS + '/1-capture.png')

    page.evaluate("window.__fireCaptured({ id: 'h1', open: true })")
    waitf(page, "document.getElementById('page-editor').classList.contains('active') && !document.getElementById('ed-wrap').hidden")
    dims = page.evaluate("[document.getElementById('ed-canvas').width, document.getElementById('ed-canvas').height]")
    check('после снимка открылся редактор с картинкой 400×300', dims == [400, 300], dims)
    check('пиксели исходника верные', near(px(page, '#ed-canvas', 80, 80), [0, 0, 0, 255]) and near(px(page, '#ed-canvas', 5, 5), [255, 255, 255, 255]))
    check('строка состояния редактора по-русски', 'инструмент: стрелка' in page.inner_text('#ed-status'), page.inner_text('#ed-status'))

    # ================= редактор =================
    page.evaluate("document.getElementById('ed-color').value = '#00ff00'; document.getElementById('ed-color').dispatchEvent(new Event('input'))")
    tool(page, 'rect'); page.check('#ed-fill')
    drag(page, (150, 150), (190, 190))
    check('рамка с заливкой рисуется', near(px(page, '#ed-canvas', 170, 170), [0, 255, 0, 255]), px(page, '#ed-canvas', 170, 170))
    page.uncheck('#ed-fill')
    page.keyboard.press('Control+z')
    check('Ctrl+Z отменяет рамку', near(px(page, '#ed-canvas', 170, 170), [255, 255, 255, 255]))
    page.keyboard.press('Control+y')
    check('Ctrl+Y возвращает рамку', near(px(page, '#ed-canvas', 170, 170), [0, 255, 0, 255]))
    tool(page, 'line'); page.evaluate("document.getElementById('ed-width').value=10; document.getElementById('ed-width').dispatchEvent(new Event('input'))")
    drag(page, (10, 10), (110, 10))
    check('линия рисуется', near(px(page, '#ed-canvas', 60, 10), [0, 255, 0, 255]))
    tool(page, 'arrow'); drag(page, (10, 200), (150, 200))
    check('стрелка рисуется (линия и наконечник)', near(px(page, '#ed-canvas', 60, 200), [0, 255, 0, 255]) and near(px(page, '#ed-canvas', 145, 200), [0, 255, 0, 255]))
    tool(page, 'pen'); drag(page, (250, 220), (330, 280), steps=15)
    check('карандаш рисует', near(px(page, '#ed-canvas', 290, 250), [0, 255, 0, 255], 40))
    tool(page, 'marker'); drag(page, (200, 10), (300, 10))
    mk = px(page, '#ed-canvas', 250, 10)
    check('маркер полупрозрачный', mk[0] > 100 and mk[1] > 200 and mk[2] > 100 and mk[0] < 255, mk)
    tool(page, 'step'); x, y = img_to_screen(page, 300, 120); page.mouse.click(x, y); page.mouse.click(x + 60, y + 10)
    check('нумерация ставит кружки', page.evaluate('Editor._state.objects.filter(o => o.t === "step").map(o => o.n)') == [1, 2])
    tool(page, 'text'); tx, ty = img_to_screen(page, 220, 230); page.mouse.click(tx, ty)
    page.wait_for_selector('.txt-input'); page.keyboard.type('Привет'); page.keyboard.press('Enter')
    check('текст добавляется по Enter', page.evaluate('Editor._state.objects.some(o => o.t === "text" && o.text === "Привет")'))
    tool(page, 'invert'); drag(page, (30, 30), (150, 150))
    check('негатив области: чёрный квадрат стал белым', near(px(page, '#ed-canvas', 100, 100), [255, 255, 255, 255]), px(page, '#ed-canvas', 100, 100))
    page.keyboard.press('Control+z')
    check('отмена негатива области', near(px(page, '#ed-canvas', 100, 100), [0, 0, 0, 255]))
    tool(page, 'pixel'); drag(page, (190, 50), (370, 210))
    tool(page, 'blur'); drag(page, (190, 50), (370, 210))
    check('пиксели и размытие добавлены', page.evaluate('Editor._state.objects.some(o => o.t === "pixel") && Editor._state.objects.some(o => o.t === "blur")'))
    page.screenshot(path=SHOTS + '/3-editor-tools.png')
    page.click('#ed-invert-all')
    check('негатив всего снимка: фон стал чёрным', near(px(page, '#ed-canvas', 395, 295), [0, 0, 0, 255]), px(page, '#ed-canvas', 395, 295))
    page.keyboard.press('Control+z')
    check('отмена негатива всего снимка', near(px(page, '#ed-canvas', 395, 295), [255, 255, 255, 255]))
    page.click('#ed-save'); waitf(page, "Object.keys(window.__calls.saved).length > 0")
    saved = decode(page.evaluate("window.__calls.saved.h1"))
    check('сохранение отправляет PNG нужного размера', saved.size == (400, 300), saved.size)
    check('в сохранённом файле есть правка (зелёная рамка)', near(saved.getpixel((170, 170)), (0, 255, 0, 255)))
    page.click('#ed-copy'); waitf(page, "window.__calls.copied > 0")
    check('копирование отправляет картинку', decode(page.evaluate("window.__lastCopy")).size == (400, 300))
    page.click('#ed-saveas'); waitf(page, "window.__calls.saveAs.length > 0")
    check('«Сохранить как» предлагает имя файла', page.evaluate("window.__calls.saveAs[0].name").endswith('.png'))
    tool(page, 'crop'); drag(page, (200, 60), (360, 200))
    dims = page.evaluate("[document.getElementById('ed-canvas').width, document.getElementById('ed-canvas').height]")
    check('обрезка уменьшает холст до выделения', abs(dims[0] - 160) <= 2 and abs(dims[1] - 140) <= 2, dims)
    page.keyboard.press('Control+z')
    check('отмена обрезки возвращает размер', page.evaluate("[document.getElementById('ed-canvas').width, document.getElementById('ed-canvas').height]") == [400, 300])
    page.click('#ed-zoom')
    check('переключение масштаба 100%', 'full' in page.get_attribute('#ed-stage', 'class') and page.inner_text('#ed-zoom') == 'Масштаб: 100%')
    page.click('#ed-zoom')
    page.evaluate("window.__app.save({ language: 'en' }, true)")
    waitf(page, "document.getElementById('ed-zoom').textContent === 'Zoom: fit to window'")
    check('редактор на английском: строка состояния и кнопки', 'tool:' in page.inner_text('#ed-status') and page.inner_text('#ed-save') == 'Save', page.inner_text('#ed-status'))
    page.evaluate("window.__app.save({ language: 'ru' }, true)")
    waitf(page, "document.getElementById('ed-zoom').textContent === 'Масштаб: по окну'")

    # ================= история =================
    nav(page, 'history')
    waitf(page, "document.querySelectorAll('#hist-grid .item').length == 2")
    check('в истории 2 карточки с миниатюрами', page.evaluate("document.querySelector('#hist-grid .item img').src.startsWith('data:image')"))
    check('в карточке подписан режим съёмки', 'область' in page.inner_text('#hist-grid .item'))
    page.screenshot(path=SHOTS + '/4-history.png')
    page.locator('#hist-grid .item').nth(1).hover(); page.locator('#hist-grid .item').nth(1).locator('button.del').click()
    waitf(page, "window.__calls.deleted.length == 1")
    check('удаление из истории', page.evaluate('window.__calls.deleted') == ['h2'] and page.locator('#hist-grid .item').count() == 1)
    page.locator('#hist-grid .item').first.click()
    waitf(page, "document.getElementById('page-editor').classList.contains('active')")
    check('клик по карточке открывает редактор', True)

    # ================= негатив =================
    nav(page, 'invert')
    page.click('#inv-open')
    waitf(page, "document.querySelectorAll('#inv-list .inv-item').length == 2")
    check('«Было»: чёрный пиксель на месте', near(px(page, '#inv-before', 80, 80), [0, 0, 0, 255]))
    check('«Стало»: чёрный стал белым', near(px(page, '#inv-after', 80, 80), [255, 255, 255, 255]))
    check('«Стало»: белый фон стал чёрным', near(px(page, '#inv-after', 5, 5), [0, 0, 0, 255]))
    check('«Стало»: синий стал жёлтым', near(px(page, '#inv-after', 250, 100), [255, 255, 0, 255]))
    a = px(page, '#inv-after', 70, 250); b = px(page, '#inv-before', 70, 250)
    check('прозрачность сохранена', a[3] == b[3] and a[3] < 255, (a, b))
    page.check('input[name="inv-mode"][value="lightness"]')
    check('режим «только яркость»: синий остаётся синим', (lambda c: c[2] > c[0] and c[2] > c[1])(px(page, '#inv-after', 250, 100)), px(page, '#inv-after', 250, 100))
    page.check('input[name="inv-mode"][value="full"]')
    page.screenshot(path=SHOTS + '/5-invert.png')
    page.click('#inv-copy'); waitf(page, "window.__calls.copied > 1")
    check('копирование результата негатива', near(decode(page.evaluate('window.__lastCopy')).getpixel((80, 80)), (255, 255, 255, 255)))
    page.click('#inv-toeditor'); waitf(page, "document.getElementById('page-editor').classList.contains('active')")
    check('«В редактор» добавляет в историю и открывает', page.evaluate("window.__calls.added.some(a => a.mode === 'negative')"))
    nav(page, 'invert')
    page.click('#inv-batch'); waitf(page, "window.__calls.written.length == 2")
    names = page.evaluate("window.__calls.written.map(w => w.p)")
    check('пакетная обработка: рядом с исходными, суффикс _negative', names == ['C:\\pics\\a_negative.png', 'C:\\pics\\b_negative.jpg'], names)
    w0 = decode(page.evaluate("window.__calls.written[0].data"))
    check('пакетная обработка: результат — негатив', near(w0.getpixel((80, 80)), (255, 255, 255, 255)) and near(w0.getpixel((5, 5)), (0, 0, 0, 255)))
    page.click('#inv-folder'); waitf(page, "document.getElementById('inv-folder-path').textContent.length > 0")
    page.evaluate('window.__calls.written.length = 0')
    page.click('#inv-batch'); waitf(page, "window.__calls.written.length == 2")
    names = page.evaluate("window.__calls.written.map(w => w.p)")
    check('пакетная обработка в выбранную папку', names == ['D:\\Out\\a_negative.png', 'D:\\Out\\b_negative.jpg'], names)
    page.evaluate("window.__clip = Uint8Array.from(atob('%s'), c => c.charCodeAt(0))" % PNG_B64)
    page.click('#inv-paste'); waitf(page, "document.querySelectorAll('#inv-list .inv-item').length == 3")
    check('вставка из буфера обмена', 'из_буфера_' in page.inner_text('#inv-list'))
    page.locator('#inv-list .inv-item .x').first.click()
    check('удаление файла из списка', page.locator('#inv-list .inv-item').count() == 2)
    page.click('#inv-hist'); page.wait_for_selector('#modal-grid .item')
    page.locator('#modal-grid .item').first.click()
    waitf(page, "document.querySelectorAll('#inv-list .inv-item').length == 3")
    check('«Взять из истории» добавляет снимок', page.evaluate("document.getElementById('modal').hidden"))
    page.evaluate("""async () => {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob('%s'), c => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'dragged.png', { type: 'image/png' }));
      document.getElementById('inv-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    }""" % PNG_B64)
    waitf(page, "document.querySelectorAll('#inv-list .inv-item').length == 4")
    check('перетаскивание файла в окно', 'dragged.png' in page.inner_text('#inv-list'))


    # ================= запись экрана =================
    nav(page, 'record')
    waitf(page, "document.querySelectorAll('#rec-list .rec-row').length == 1")
    check('запись: вкладка «Запись» в меню', page.inner_text('#nav button[data-page="record"]') == 'Запись')
    check('запись: режим по умолчанию — весь экран', page.evaluate("document.querySelector('#rec-modes .active').dataset.mode") == 'screen')
    check('запись: окно выбора скрыто, пока не выбран режим «Окно»', page.is_hidden('#rec-winrow'))
    check('запись: подпись с FPS, качеством и форматом', page.inner_text('#rec-sum') == '30 FPS · качество: Среднее · MP4', page.inner_text('#rec-sum'))
    check('запись: подсказка горячей клавиши на кнопке', page.inner_text('#rec-start kbd') == 'Ctrl+Shift+R', page.inner_text('#rec-start kbd'))
    check('запись: переключатели звука, микрофона и камеры', page.is_checked('[data-rec-quick="recSystemAudio"]') and not page.is_checked('[data-rec-quick="recMic"]') and not page.is_checked('[data-rec-quick="recWebcam"]'))
    page.check('[data-rec-quick="recMic"]'); page.check('[data-rec-quick="recWebcam"]')
    check('запись: микрофон и камера сохраняются в настройках', page.evaluate("window.__calls.setSettings.some(s => s.recMic === true) && window.__calls.setSettings.some(s => s.recWebcam === true)"))
    page.uncheck('[data-rec-quick="recMic"]'); page.uncheck('[data-rec-quick="recWebcam"]')
    page.click('#rec-modes button[data-mode="window"]')
    waitf(page, "document.querySelectorAll('#rec-window option').length == 2")
    check('запись: режим «Окно» показывает список окон', not page.is_hidden('#rec-winrow') and page.evaluate("window.__calls.setSettings.some(s => s.recMode === 'window')"))
    page.select_option('#rec-window', 'window:2:0')
    page.screenshot(path=SHOTS + '/40-record-idle.png')
    page.click('#rec-start'); waitf(page, "!document.getElementById('rec-live').hidden")
    check('запись: старт передаёт режим и выбранное окно', page.evaluate('window.__rc.start') == [{'mode': 'window', 'sourceId': 'window:2:0'}], page.evaluate('window.__rc.start'))
    check('запись: во время записи кнопка старта выключена', page.is_disabled('#rec-start'))
    page.evaluate("window.__setRec({ elapsedMs: 83000, bytes: 7340032, maxMs: 3600000 })")
    check('запись: таймер, размер и лимит', page.inner_text('#rec-time') == '01:23' and '7.0 MB' in page.inner_text('#rec-meta') and 'лимит 1:00:00' in page.inner_text('#rec-meta'), page.inner_text('#rec-meta'))
    check('запись: статус «идёт запись»', page.inner_text('#rec-state') == 'идёт запись')
    page.screenshot(path=SHOTS + '/41-record-live.png')
    page.click('#rec-pause'); waitf(page, "document.getElementById('rec-live').classList.contains('paused')")
    check('запись: пауза меняет статус и подпись кнопки', page.inner_text('#rec-state') == 'пауза' and page.inner_text('#rec-pause span') == 'Продолжить')
    page.click('#rec-pause'); waitf(page, "!document.getElementById('rec-live').classList.contains('paused')")
    page.click('#rec-stop'); waitf(page, "!document.getElementById('rec-bar').hidden")
    check('запись: при сохранении виден прогресс', page.inner_text('#rec-state') == 'сохраняю…' and page.evaluate("document.getElementById('rec-bar-i').style.width") == '40%')
    page.evaluate("window.__setRec({ state: 'idle', paused: false })")
    waitf(page, "document.getElementById('rec-live').hidden")
    check('запись: после остановки панель записи скрыта, старт снова доступен', not page.is_disabled('#rec-start'))
    # библиотека
    row = page.locator('#rec-list .rec-row').first
    t = row.inner_text()
    check('библиотека: имя, длительность, размер, разрешение, звук', all(x in t for x in ['Запись_1.mp4', '01:15', '1920×1080', '5.0 MB', 'со звуком']), t)
    check('библиотека: миниатюра загружена', page.evaluate("document.querySelector('#rec-list img').src.startsWith('data:image')"))
    row.locator('button', has_text='Смотреть').click(); row.locator('button', has_text='В папке').click()
    check('библиотека: «Смотреть» и «В папке»', page.evaluate('window.__rc.play') == ['r1'] and page.evaluate('window.__rc.show') == ['r1'])
    page.click('#rec-openfolder')
    check('запись: «Открыть папку записей»', page.evaluate('window.__rc.opened') == 1)
    row.locator('button.danger').click(); waitf(page, "document.querySelectorAll('#rec-list .rec-row').length == 0")
    check('библиотека: удаление и пустой список', page.evaluate('window.__rc.del') == ['r1'] and not page.is_hidden('#rec-empty'))
    page.evaluate("window.__setRec({ state: 'recording', warnings: ['cam', 'sysaudio'], elapsedMs: 1000 })")
    check('запись: предупреждения о камере и звуке', 'камера недоступна' in page.inner_text('#rec-meta') and 'нет звука системы' in page.inner_text('#rec-meta'), page.inner_text('#rec-meta'))
    page.evaluate("window.__setRec({ state: 'idle', warnings: [] })")
    page.click('#rec-modes button[data-mode="screen"]')
    # язык
    page.evaluate("window.__app.save({ language: 'en' }, true)")
    check('запись: страница на английском', page.inner_text('#page-record h1') == 'Screen recording' and page.inner_text('#rec-modes button[data-mode="region"]') == 'Region' and page.inner_text('#rec-start span') == 'Start recording')
    page.evaluate("window.__app.save({ language: 'ru' }, true)")

    # ---- настройки записи ----
    tab(page, 'record')
    check('настройки записи: 3 горячие клавиши и бейджи', page.input_value('[data-hk-field="recToggle"]') == 'Ctrl+Shift+R' and page.inner_text('[data-hk-status="recRegion"]') == 'занято' and page.inner_text('[data-hk-status="recToggle"]') == 'работает')
    check('настройки записи: 6 панелей со строками', page.locator('#rs-fields .panel').count() == 6 and page.locator('#rs-fields .frow').count() >= 18, page.locator('#rs-fields .frow').count())
    page.select_option('[data-rs="recFps"]', '60')
    page.select_option('[data-rs="recQuality"]', 'high')
    page.select_option('[data-rs="recFormat"]', 'webm')
    ss = page.evaluate("window.__calls.setSettings")
    check('настройки записи: FPS, качество и формат сохраняются', any(x.get('recFps') == 60 for x in ss) and any(x.get('recQuality') == 'high' for x in ss) and any(x.get('recFormat') == 'webm' for x in ss))
    page.select_option('[data-rs="recFps"]', '30'); page.select_option('[data-rs="recQuality"]', 'medium'); page.select_option('[data-rs="recFormat"]', 'mp4')
    page.check('[data-rs="recMic"]'); page.check('[data-rs="recWebcam"]'); page.uncheck('[data-rs="recPanel"]'); page.uncheck('[data-rs="recHideWindow"]'); page.uncheck('[data-rs="recCursor"]')
    ss = page.evaluate("window.__calls.setSettings")
    check('настройки записи: переключатели микрофона, камеры, панели, окна, курсора', all(any(x.get(k) is v for x in ss) for k, v in [('recMic', True), ('recWebcam', True), ('recPanel', False), ('recHideWindow', False), ('recCursor', False)]))
    check('настройки записи: переключатель выглядит как свитч', page.evaluate("getComputedStyle(document.querySelector('[data-rs=\"recMic\"]')).width") == '42px')
    page.evaluate("const r = document.querySelector('[data-rs=\"recMicGain\"]'); r.value = 150; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change'))")
    check('настройки записи: громкость микрофона 150%', page.evaluate("window.__calls.setSettings.some(x => x.recMicGain === 150)") and page.inner_text('[data-rsv="recMicGain"]') == '150%')
    page.select_option('[data-rs="recCamCorner"]', 'tl'); page.select_option('[data-rs="recCamShape"]', 'rect')
    check('настройки записи: угол и форма камеры', page.evaluate("window.__calls.setSettings.some(x => x.recCamCorner === 'tl') && window.__calls.setSettings.some(x => x.recCamShape === 'rect')"))
    page.fill('[data-rs="recMaxMinutes"]', '999'); page.dispatch_event('[data-rs="recMaxMinutes"]', 'change')
    check('настройки записи: лимит длины ограничивается 600 мин', page.input_value('[data-rs="recMaxMinutes"]') == '600' and page.evaluate("window.__calls.setSettings.some(x => x.recMaxMinutes === 600)"))
    page.fill('[data-rs="recMaxMB"]', '0'); page.dispatch_event('[data-rs="recMaxMB"]', 'change')
    check('настройки записи: 0 = без лимита по размеру', page.evaluate("window.__calls.setSettings.some(x => x.recMaxMB === 0)"))
    check('настройки записи: папка по умолчанию рядом со снимками', page.input_value('[data-rs="recFolder"]').endswith('Скриншоты\\Записи'), page.input_value('[data-rs="recFolder"]'))
    page.locator('#rs-fields .panel').last.locator('button').first.click(); waitf(page, "window.__calls.setSettings.some(x => x.recFolder === 'D:\\\\Shots')")
    check('настройки записи: выбор папки записей', 'Shots' in page.input_value('[data-rs="recFolder"]'))
    page.locator('#rs-fields .panel').last.locator('button').nth(1).click()
    check('настройки записи: сброс папки на «рядом со снимками»', page.evaluate("window.__calls.setSettings.some(x => x.recFolder === '')"))
    check('настройки записи: список устройств с «по умолчанию»', page.locator('[data-rs="recMicDevice"] option').first.inner_text() == 'По умолчанию')
    page.screenshot(path=SHOTS + '/42-settings-record.png', full_page=True)
    page.evaluate("window.__app.save({ language: 'en' }, true)")
    check('настройки записи: подписи на английском', 'Recording hotkeys' in page.inner_text('#pane-record') and 'Floating panel' in page.inner_text('#pane-record'))
    page.evaluate("window.__app.save({ language: 'ru' }, true)")
    # переключатели и анимации в основных настройках
    page.click('#set-tabs button[data-tab="general"]')
    page.uncheck('#set-animations')
    check('настройки: анимации выключаются', page.evaluate("document.body.classList.contains('no-anim')") and page.evaluate("window.__calls.setSettings.some(x => x.animations === false)"))
    page.check('#set-animations')
    check('настройки: свитч в основных', page.evaluate("getComputedStyle(document.getElementById('set-autostart')).width") == '42px')
    page.screenshot(path=SHOTS + '/43-settings-general-new.png')

    # ================= навигация из трея =================
    page.evaluate("window.__fireNav('history')")
    check('переход из трея на «История»', page.evaluate("document.getElementById('page-history').classList.contains('active')"))
    page.evaluate("window.__fireNav('series')")
    check('переход из трея на «Серия ЛР»', page.evaluate("document.getElementById('page-series').classList.contains('active')"))

    # ================= внешний вид: светлая тема, снимки экрана =================
    page.evaluate("window.__app.save({ theme: 'light' }, true)")
    nav(page, 'capture'); page.screenshot(path=SHOTS + '/30-light-capture.png')
    nav(page, 'settings'); page.click('#set-tabs button[data-tab="about"]'); page.screenshot(path=SHOTS + '/31-light-about.png')
    page.evaluate("window.__app.save({ theme: 'dark' }, true)")

    # ================= видеоредактор =================
    VD = tempfile.mkdtemp() + '/'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', VD + 'a.webm'], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=25:duration=4', '-c:v', 'libvpx', '-b:v', '1M', VD + 'b.webm'], check=True)
    def vinfo(n, dur, aud):
        return {'src': VD + n, 'name': n, 'dur': dur, 'w': 640, 'h': 360, 'fps': 25, 'hasAudio': aud, 'url': 'file://' + VD + n}
    page.evaluate("v => { window.__vidFiles = v }", [vinfo('a.webm', 6.0, True), vinfo('b.webm', 4.0, False)])
    nav(page, 'video')
    check('видео: пустое состояние и пункт меню', page.is_visible('#vd-empty') and not page.is_visible('#vd-main'))
    page.screenshot(path=SHOTS + '/50-video-empty.png')
    page.click('#vd-add')
    waitf(page, "!document.getElementById('vd-main').hidden")
    page.wait_for_timeout(600)
    check('видео: клип добавлен на таймлайн', page.locator('.vd-clip').count() == 1)
    check('видео: длительность 6.0', '0:06.0' in page.inner_text('#vd-tot'), page.inner_text('#vd-tot'))
    check('видео: кадр загрузился (ширина видео)', page.evaluate("document.getElementById('vd-video').videoWidth") == 640)
    # воспроизведение
    page.click('#vd-play'); page.wait_for_timeout(900)
    t1 = page.evaluate("VideoTab._state.t")
    check('видео: воспроизведение двигает время', t1 > 0.4, t1)
    page.click('#vd-play')
    check('видео: пауза останавливает', not page.evaluate("VideoTab._state.playing"))
    # разрезание
    page.evaluate("VideoTab._seek(2.0)"); page.wait_for_timeout(300)
    page.keyboard.press('s')
    check('видео: S режет клип на два', page.locator('.vd-clip').count() == 2)
    # метки и вырезание
    page.evaluate("VideoTab._seek(3.0)"); page.keyboard.press('i')
    page.evaluate("VideoTab._seek(4.0)"); page.keyboard.press('o')
    check('видео: метка диапазона видна', page.is_visible('#vd-range'))
    page.keyboard.press('x')
    check('видео: вырезание сокращает ролик до 5.0', '0:05.0' in page.inner_text('#vd-tot'), page.inner_text('#vd-tot'))
    # undo / redo
    page.keyboard.press('Control+z')
    check('видео: Ctrl+Z возвращает 6.0', '0:06.0' in page.inner_text('#vd-tot'), page.inner_text('#vd-tot'))
    page.keyboard.press('Control+y')
    check('видео: Ctrl+Y снова 5.0', '0:05.0' in page.inner_text('#vd-tot'))
    # скорость
    page.locator('.vd-clip').first.click(position={'x': 20, 'y': 20})
    page.select_option('#vd-speed', '2')
    check('видео: скорость ×2 укорачивает первый клип', page.evaluate("VideoTab._state.p.clips[0].speed") == 2)
    tot = page.inner_text('#vd-tot')
    check('видео: общая длительность пересчитана (4.0)', '0:04.0' in tot, tot)
    page.select_option('#vd-speed', '1')
    # громкость и без звука
    page.fill('#vd-vol', '150'); page.dispatch_event('#vd-vol', 'change')
    check('видео: громкость 150', page.evaluate("VideoTab._state.p.clips[0].volume") == 150)
    page.check('#vd-mute')
    check('видео: без звука', page.evaluate("VideoTab._state.p.clips[0].mute") is True)
    page.uncheck('#vd-mute')
    # склейка из записей
    page.evaluate("window.__setRecList([{ id: 'r9', file: 'C:\\\\Rec\\\\Запись_9.webm', createdAt: new Date().toISOString(), mode: 'screen', format: 'webm', duration: 4, width: 640, height: 360, hasAudio: false, size: 9000 }])")
    page.click('#vd-addlib'); page.wait_for_timeout(300)
    check('видео: окно «Из записей» открылось', page.is_visible('#vd-libmodal') and page.locator('.vd-lib-item').count() >= 1)
    page.screenshot(path=SHOTS + '/51-video-lib.png')
    page.locator('.vd-lib-item').first.click(); page.wait_for_timeout(400)
    check('видео: склеено четыре клипа', page.locator('.vd-clip').count() == 4)
    # наложения
    page.evaluate("VideoTab._seek(1.0)")
    page.click('#vd-add-text')
    check('видео: добавлена надпись на дорожку', page.locator('.vd-ob.text').count() == 1)
    page.fill('#vd-ov-text', 'Привет, мир'); page.wait_for_timeout(150)
    check('видео: текст в модели', page.evaluate("VideoTab._state.p.overlays[0].text") == 'Привет, мир')
    page.click('#vd-add-arrow'); page.click('#vd-add-blur')
    check('видео: три наложения', page.evaluate("VideoTab._state.p.overlays.length") == 3)
    # проверка, что надпись нарисована на canvas
    painted = page.evaluate("""() => { const c = document.getElementById('vd-ovc'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }""")
    check('видео: надпись нарисована поверх кадра', painted > 200, painted)
    page.screenshot(path=SHOTS + '/52-video-editor.png')
    page.locator('.vd-ob.blur').click(); page.wait_for_timeout(100)
    check('видео: для размытия показана «Сила размытия»', 'Сила' in page.inner_text('#vd-ov-size-l'))
    # перетаскивание надписи
    page.locator('.vd-ob.text').click()
    x0 = page.evaluate("VideoTab._state.p.overlays[0].x")
    box = page.locator('.vd-txt-hit').first.bounding_box()
    page.mouse.move(box['x'] + 10, box['y'] + 10); page.mouse.down(); page.mouse.move(box['x'] + 70, box['y'] + 40, steps=5); page.mouse.up()
    x1 = page.evaluate("VideoTab._state.p.overlays[0].x")
    check('видео: надпись перетаскивается мышью', x1 > x0 + 0.03, (x0, x1))
    # ручка обрезки
    a0 = page.evaluate("VideoTab._state.p.clips[0].outT")
    page.locator('.vd-clip').first.click(position={'x': 10, 'y': 10})
    hb = page.locator('.vd-clip').first.locator('.vd-h.r').bounding_box()
    page.mouse.move(hb['x'] + 3, hb['y'] + 20); page.mouse.down(); page.mouse.move(hb['x'] - 40, hb['y'] + 20, steps=5); page.mouse.up()
    a1 = page.evaluate("VideoTab._state.p.clips[0].outT")
    check('видео: ручка укорачивает клип', a1 < a0 - 0.1, (a0, a1))
    # экспорт
    page.select_option('#vd-fmt', 'gif')
    check('видео: для GIF показаны параметры GIF', page.is_visible('.vd-gif-opts') and not page.is_visible('.vd-vid-opts'))
    page.select_option('#vd-fmt', 'mp4')
    page.click('#vd-export'); page.wait_for_timeout(1200)
    ex = page.evaluate("window.__vidExport")
    check('видео: экспорт отправил проект и PNG надписи/стрелки', ex and len(ex['project']['clips']) == 4 and len(ex['project']['overlays']) == 3 and len(ex['overlayPng']) == 2, str(ex and ex['overlayPng'].keys()))
    check('видео: параметры экспорта', ex['opts']['format'] == 'mp4' and ex['opts']['fps'] == 30)
    # кадр в PNG
    page.click('#vd-frame-png'); page.wait_for_timeout(700)
    check('видео: кадр сохранён через saveAs', page.evaluate("window.__lastSaveAs && window.__lastSaveAs.length") > 500)
    # удаление и пустое состояние
    page.evaluate("VideoTab._state.focus = 'clip'")
    for _ in range(4):
        page.locator('.vd-clip').first.click(position={'x': 10, 'y': 10}); page.click('#vd-del')
    check('видео: после удаления всех клипов снова пустое состояние', page.is_visible('#vd-empty'))
    page.screenshot(path=SHOTS + '/53-video-empty-after.png')
    # кнопка «В видеоредактор» из записей
    nav(page, 'record'); page.wait_for_timeout(300)
    page.evaluate("window.__fireRecList && window.__fireRecList()"); page.wait_for_timeout(300)
    page.get_by_role('button', name='В видеоредактор').first.click(); page.wait_for_timeout(600)
    check('видео: «В видеоредактор» открывает запись', page.is_visible('#vd-main') and page.locator('.vd-clip').count() == 1)
    page.evaluate("window.__app.save({ language: 'en' }, true)"); page.wait_for_timeout(200)
    check('видео: английский интерфейс', page.inner_text('#page-video h1') == 'Video editor', page.inner_text('#page-video h1'))
    page.screenshot(path=SHOTS + '/54-video-en.png')
    page.evaluate("window.__app.save({ language: 'ru' }, true)")


    check('за весь прогон нет ошибок в консоли', not errors, errors)

    # ================= окно выбора области =================
    ov = ctx.new_page()
    ov_err = []
    ov.on('pageerror', lambda e: ov_err.append(str(e)))
    ov.on('console', lambda m: ov_err.append(m.text) if m.type == 'error' else None)
    ov.add_init_script(INIT)
    ov.set_viewport_size({'width': 800, 'height': 500})
    ov.goto('file://' + ROOT + '/renderer/overlay.html')
    ov.evaluate("window.__ovInit({ image: Uint8Array.from(atob('%s'), c => c.charCodeAt(0)), width: 800, height: 500, hint: 'Drag to select an area' })" % PNG_B64)
    check('оверлей: подсказка приходит из настроек языка', ov.inner_text('#hint') == 'Drag to select an area')
    ov.mouse.move(100, 100); ov.mouse.down(); ov.mouse.move(300, 250, steps=5)
    check('оверлей: рамка и подпись размера', ov.is_visible('#sel') and '×' in ov.inner_text('#label'), ov.inner_text('#label'))
    ov.screenshot(path=SHOTS + '/7-overlay.png')
    ov.mouse.up()
    d = ov.evaluate('window.__ovDone')
    check('оверлей: возвращает прямоугольник 200×150', d and d['x'] == 100 and d['y'] == 100 and d['w'] == 200 and d['h'] == 150, repr(d))
    ov.evaluate('window.__ovDone = null')
    ov.mouse.move(400, 300); ov.mouse.down(); ov.mouse.move(401, 301); ov.mouse.up()
    check('оверлей: слишком маленькая рамка игнорируется', ov.evaluate('window.__ovDone') is None)
    ov.keyboard.press('Escape')
    check('оверлей: Esc отменяет', ov.evaluate('window.__ovCancel') == 1)
    ov.mouse.click(200, 200, button='right')
    check('оверлей: правая кнопка отменяет', ov.evaluate('window.__ovCancel') >= 2)
    check('оверлей без ошибок', not ov_err, ov_err)
    browser.close()

bad = [r for r in results if not r[1]]
print('\nПройдено: %d из %d' % (len(results) - len(bad), len(results)))
sys.exit(1 if bad else 0)
