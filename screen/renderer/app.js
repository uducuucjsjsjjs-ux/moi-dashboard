'use strict';
// Главный скрипт интерфейса: язык, тема, навигация, вкладки «Снимок» и «История».
// Остальные вкладки (редактор, негатив, серия, настройки) подключаются к общему контексту ctx.

(async function () {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);

  let settings = await api.getSettings();
  const info = await api.appInfo();
  let hkStatus = await api.hotkeyStatus();
  let page = 'capture';
  let lastId = null;

  // ---------- вспомогательное ----------
  let toastTimer = null;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  const baseName = (p) => String(p).split(/[\\/]/).pop();
  const locale = () => (settings.language === 'en' ? 'en-GB' : 'ru-RU');
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'medium' }); } catch (_) { return iso; }
  }

  // ---------- внешний вид: тема, акцент, язык ----------
  function lightOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
  }
  function shade(hex, k) { // k < 0 темнее, k > 0 светлее
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolvedTheme() {
    if (settings.theme === 'system') return dark && !dark.matches ? 'light' : 'dark';
    return settings.theme;
  }

  function applyAppearance() {
    document.body.dataset.theme = resolvedTheme();
    document.body.classList.toggle('no-anim', settings.animations === false);
    const root = document.documentElement.style;
    root.setProperty('--accent', settings.accent);
    root.setProperty('--accent2', shade(settings.accent, -0.14));
    root.setProperty('--on-accent', lightOn(settings.accent) ? '#0c0d10' : '#ffffff');
  }
  if (dark && dark.addEventListener) dark.addEventListener('change', () => { if (settings.theme === 'system') applyAppearance(); });

  let appliedLang = null;
  function applyLanguage() {
    appliedLang = settings.language;
    window.I18n.setLang(settings.language);
    window.I18n.apply(document);
    document.title = T('app.name');
    $('ver').textContent = T('about.version') + ' ' + info.version;
    document.dispatchEvent(new Event('langchange'));
    applyQuick();
  }

  // ---------- сохранение настроек ----------
  let pending = null;
  let saveTimer = null;

  function mergeInto(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if ((k === 'hotkeys' || k === 'editor') && v && typeof v === 'object') target[k] = Object.assign({}, target[k], v);
      else target[k] = v;
    }
    return target;
  }

  async function flush() {
    if (!pending) return;
    const patch = pending;
    pending = null;
    const r = await api.setSettings(patch);
    settings = r.settings;
    hkStatus = r.hotkeys;
    applyAppearance();
    applyQuick();
    if (window.SettingsTab) window.SettingsTab.refreshHotkeyBadges();
  }

  // Меняем локальные настройки сразу, на диск пишем сразу (immediate) или с небольшой задержкой
  function save(patch, immediate) {
    settings = mergeInto(Object.assign({}, settings), patch);
    pending = mergeInto(pending || {}, patch);
    applyAppearance();
    if (appliedLang !== settings.language) applyLanguage(); // язык меняется сразу, не дожидаясь записи
    clearTimeout(saveTimer);
    if (immediate) return flush();
    saveTimer = setTimeout(flush, 250);
    return Promise.resolve();
  }

  // ---------- навигация ----------
  function go(p) {
    if (page === 'video' && p !== 'video' && window.VideoTab) window.VideoTab.leave();
    page = p;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
    document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    if (p === 'history') loadHistory();
    if (p === 'series') window.SeriesTab.refresh();
    if (p === 'record') window.RecordTab.show();
    if (p === 'video') window.VideoTab.show();
    if (p === 'settings') window.SettingsTab.onShow();
  }

  async function openEditorById(id) {
    const r = await api.readImage(id);
    if (!r) { toast(T('toast.fileNotFound'), true); return; }
    await Editor.load(r.bytes, r.entry);
    go('editor');
  }

  // ---------- вкладка «Снимок» ----------
  function applyQuick() {
    document.querySelectorAll('kbd[data-hk]').forEach((k) => { k.textContent = settings.hotkeys[k.dataset.hk] || ''; });
    document.querySelectorAll('[data-quick]').forEach((el) => {
      const v = settings[el.dataset.quick];
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v;
    });
    $('cap-folder').textContent = settings.autosave ? (settings.saveFolder || info.defaultFolder) : T('cap.folder.off');
    if ($('set-notify')) $('set-notify').checked = settings.notify;
  }

  document.querySelectorAll('[data-capture]').forEach((b) => b.addEventListener('click', () => api.capture(b.dataset.capture)));
  document.querySelectorAll('[data-quick]').forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : Math.min(30, Math.max(0, Number(el.value) || 0));
      save({ [el.dataset.quick]: v }, true);
    });
  });
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));

  let lastEntry = null;
  function renderLastInfo() {
    if (!lastEntry) return;
    $('last-info').textContent = baseName(lastEntry.file) + ' · ' + lastEntry.width + '×' + lastEntry.height + ' · ' + fmtDate(lastEntry.createdAt);
  }
  async function updateLast(id) {
    lastId = id;
    const hist = await api.history();
    const e = hist.find((x) => x.id === id);
    if (!e) return;
    lastEntry = e;
    $('last-panel').hidden = false;
    const th = await api.thumb(id);
    if (th) $('last-img').src = th;
    renderLastInfo();
  }
  $('last-edit').addEventListener('click', () => lastId && openEditorById(lastId));
  $('last-copy').addEventListener('click', async () => { if (lastId && await api.copyHistory(lastId)) toast(T('toast.copied')); });
  $('last-show').addEventListener('click', () => lastId && api.showInFolder(lastId));

  api.onCaptured(async ({ id, open }) => {
    await updateLast(id);
    if (open) await openEditorById(id);
  });
  api.onNavigate((nav) => {
    if (nav.startsWith('editor:')) openEditorById(nav.slice(7));
    else go(nav);
  });

  // ---------- вкладка «История» ----------
  let histCache = [];
  let histShown = 60;

  function makeCard(e, opts) {
    const d = document.createElement('div');
    d.className = 'item';
    const th = document.createElement('div'); th.className = 'th';
    const img = document.createElement('img'); img.alt = ''; th.appendChild(img);
    const meta = document.createElement('div'); meta.className = 'meta';
    const b = document.createElement('b'); b.textContent = baseName(e.file); b.title = e.file;
    const s = document.createElement('span');
    const mode = window.I18n.has('mode.' + e.mode) ? T('mode.' + e.mode) : e.mode;
    s.textContent = fmtDate(e.createdAt) + ' · ' + mode + ' · ' + e.width + '×' + e.height;
    meta.append(b, s);
    d.append(th, meta);
    if (!opts.small) {
      const acts = document.createElement('div'); acts.className = 'acts';
      const mk = (txt, title, fn, cls) => {
        const x = document.createElement('button'); x.textContent = txt; x.title = title; if (cls) x.className = cls;
        x.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); return x;
      };
      acts.append(
        mk(T('hist.copy'), T('hist.copy.t'), async () => { if (await api.copyHistory(e.id)) toast(T('toast.copied')); }),
        mk(T('hist.folder'), T('hist.folder.t'), () => api.showInFolder(e.id)),
        mk(T('hist.del'), T('hist.del.t'), async () => { await api.deleteHistory(e.id); loadHistory(); }, 'del')
      );
      d.appendChild(acts);
    }
    d.addEventListener('click', () => opts.onClick(e));
    api.thumb(e.id).then((t) => { if (t) img.src = t; });
    return d;
  }

  async function loadHistory() {
    histCache = await api.history();
    renderHistory();
  }
  function renderHistory() {
    const grid = $('hist-grid');
    grid.textContent = '';
    $('hist-empty').hidden = histCache.length > 0;
    $('hist-clear').hidden = histCache.length === 0;
    histCache.slice(0, histShown).forEach((e) => grid.appendChild(makeCard(e, { onClick: (x) => openEditorById(x.id) })));
    if (histCache.length > histShown) {
      const more = document.createElement('button');
      more.className = 'btn'; more.textContent = T('hist.more', { n: histCache.length - histShown });
      more.addEventListener('click', () => { histShown += 60; renderHistory(); });
      grid.appendChild(more);
    }
  }
  async function clearHistory() {
    if (!confirm(T('hist.clear.confirm'))) return;
    await api.clearHistory();
    if (page === 'history') loadHistory();
    lastId = null; lastEntry = null; $('last-panel').hidden = true;
  }
  $('hist-clear').addEventListener('click', clearHistory);

  function pickHistory(cb) {
    const modal = $('modal'), grid = $('modal-grid');
    grid.textContent = '';
    modal.hidden = false;
    api.history().then((list) => {
      if (!list.length) { grid.textContent = T('modal.empty'); return; }
      list.slice(0, 80).forEach((e) => grid.appendChild(makeCard(e, { small: true, onClick: (x) => { modal.hidden = true; cb(x.id); } })));
    });
  }
  $('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });

  document.addEventListener('langchange', () => {
    renderLastInfo();
    if (page === 'history') renderHistory();
  });

  // ---------- редактор: открыть файл ----------
  $('ed-open-file').addEventListener('click', async () => {
    const paths = await api.openImages();
    if (!paths.length) return;
    const bytes = await api.readFile(paths[0]);
    if (!bytes) { toast(T('ed.openFail'), true); return; }
    const entry = await api.addToHistory(bytes, 'import');
    if (entry) await openEditorById(entry.id);
  });

  // ---------- подключение вкладок ----------
  const ctx = {
    api, info, toast, save, go, openEditorById, clearHistory,
    openVideo: (id) => window.VideoTab.openFromLibrary(id),
    getSettings: () => settings,
    hotkeyStatus: () => hkStatus
  };

  applyAppearance();
  window.I18n.setLang(settings.language);

  Editor.init({
    api,
    prefs: settings.editor,
    hooks: {
      toast,
      isActive: () => page === 'editor',
      prefs: (p) => save({ editor: p }),
      onSaved: (e) => { if (lastId === e.id) updateLast(e.id); }
    }
  });
  InvertTab.init({
    api,
    hooks: {
      toast,
      isActive: () => page === 'invert',
      pickHistory,
      defaultFolder: () => settings.saveFolder || info.defaultFolder,
      openInEditor: (e) => openEditorById(e.id)
    }
  });
  SeriesTab.init(ctx);
  RecordTab.init(ctx);
  VideoTab.init(ctx);
  RecSettings.init(ctx);
  SettingsTab.init(ctx);

  // чтобы перетаскивание файла в окно не открывало его вместо программы
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  applyLanguage();
  SettingsTab.fill();
  SettingsTab.refreshHotkeyBadges();
  const hist = await api.history();
  if (hist.length) updateLast(hist[0].id);

  window.__app = { go, save, openEditorById, getSettings: () => settings, applyLanguage }; // для проверок
})();
