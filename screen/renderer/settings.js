'use strict';
// Страница «Настройки»: вкладки «Основные», «Съёмка», «Серия ЛР», «Данные», «О программе», «Что нового».

(function () {
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);
  const ACCENTS = ['#7c9cff', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6'];
  const S = { ctx: null, tab: 'general', backup: null };

  const lang = () => S.ctx.getSettings().language;
  const fmtDate = (ms) => {
    try { return new Date(ms).toLocaleString(lang() === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return String(ms); }
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- вкладки ----------
  function showTab(name) {
    S.tab = name;
    document.querySelectorAll('#set-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    if (name === 'data') loadBackupInfo();
    if (name === 'about') renderAbout();
    if (name === 'changelog') renderChangelog();
  }

  // ---------- значения полей из настроек ----------
  function fill() {
    const s = S.ctx.getSettings();
    const info = S.ctx.info;
    document.querySelectorAll('[data-hk-field]').forEach((el2) => { el2.value = s.hotkeys[el2.dataset.hkField] || ''; });
    $('set-lang').value = s.language;
    $('set-theme').value = s.theme;
    $('set-accent').value = s.accent;
    $('set-scale').value = String(s.uiScale);
    $('set-autostart').checked = s.autostart;
    $('set-starthidden').checked = s.startHidden;
    $('set-closetray').checked = s.closeToTray;
    $('set-notify').checked = s.notify;
    $('set-sound').checked = s.sound;
    $('set-animations').checked = s.animations;
    $('set-rememberwin').checked = s.rememberWindow;
    $('set-folder').value = s.saveFolder || info.defaultFolder;
    $('set-datefolders').value = s.dateFolders;
    $('set-format').value = s.format;
    $('set-quality').value = s.jpgQuality;
    $('set-quality-v').textContent = s.jpgQuality + '%';
    $('set-quality').disabled = s.format !== 'jpg';
    $('set-template').value = s.fileTemplate;
    $('set-series-mode').value = s.seriesMode;
    $('set-series-prefix').value = s.seriesPrefix;
    $('set-series-name').value = s.seriesNameTemplate;
    $('set-series-caption').value = s.seriesCaption;
    $('set-series-root').value = s.seriesRoot || info.seriesRoot;
    $('set-series-editor').checked = s.seriesOpenEditor;
    $('set-histlimit').value = String(s.historyLimit);
    $('set-autobackup').checked = s.autoBackup;
    $('set-datadir').textContent = info.dataDir;
    updateExamples();
    highlightAccent();
  }

  function updateExamples() {
    const s = S.ctx.getSettings();
    $('set-example').textContent = window.Shared.formatName(s.fileTemplate, new Date(), { mode: 'region' }) + '.' + s.format;
    $('set-series-example').textContent =
      window.Shared.stepBase(s.seriesNameTemplate, { prefix: s.seriesPrefix, lab: '5', step: 3 }) + '.' + s.format + ' · ' +
      window.Shared.captionFor(s.seriesCaption, 3, T('set.series.sample'));
  }

  function highlightAccent() {
    const cur = S.ctx.getSettings().accent.toLowerCase();
    document.querySelectorAll('#set-accent-sw .sw').forEach((b) => b.classList.toggle('on', b.dataset.c === cur));
  }

  function refreshHotkeyBadges() {
    const hk = S.ctx.hotkeyStatus();
    const names = { ok: ['set.hk.ok', 'ok'], busy: ['set.hk.busy', 'bad'], duplicate: ['set.hk.dup', 'bad'], off: ['set.hk.off', ''] };
    document.querySelectorAll('[data-hk-status]').forEach((b) => {
      const st = names[hk[b.dataset.hkStatus]];
      b.textContent = st ? T(st[0]) : '';
      b.className = 'badge ' + (st ? st[1] : '');
    });
  }

  // ---------- «О программе» ----------
  function isBeta(version) {
    return /^0\./.test(String(version));
  }

  function renderAbout() {
    const info = S.ctx.info;
    $('ab-ver').textContent = info.version;
    $('ab-beta').hidden = !isBeta(info.version);
    const rows = [
      ['about.row.version', info.version + (isBeta(info.version) ? ' (' + T('about.beta') + ')' : '')],
      ['about.row.electron', info.electron], ['about.row.chrome', info.chrome], ['about.row.node', info.node],
      ['about.row.platform', info.platform + ' ' + info.arch],
      ['about.row.data', info.dataDir], ['about.row.backups', info.backupDir],
      ['about.row.images', S.ctx.getSettings().saveFolder || info.defaultFolder],
      ['about.row.series', S.ctx.getSettings().seriesRoot || info.seriesRoot]
    ];
    const tb = $('ab-table');
    tb.textContent = '';
    for (const [k, v] of rows) {
      if (!v) continue;
      const tr = el('tr');
      tr.append(el('th', null, T(k)), el('td', null, v));
      tb.appendChild(tr);
    }
  }

  // ---------- «Что нового» ----------
  function renderChangelog() {
    const box = $('changelog');
    box.textContent = '';
    const l = lang() === 'en' ? 'en' : 'ru';
    (window.CHANGELOG || []).forEach((e, i) => {
      const d = el('details', 'cl');
      if (i === 0) d.open = true;
      const sum = el('summary');
      sum.append(el('span', 'cl-v', 'v' + e.v), el('span', 'cl-date muted', e.date));
      if (e.beta) sum.append(el('span', 'tag-beta', T('about.beta')));
      if (i === 0) sum.append(el('span', 'tag-new', T('cl.latest')));
      d.appendChild(sum);
      const body = el('div', 'cl-body');
      if (e.note) body.appendChild(el('p', 'muted', e.note[l]));
      for (const k of ['added', 'changed', 'fixed', 'check']) {
        const items = (e[l] && e[l][k]) || [];
        if (!items.length) continue;
        body.appendChild(el('h3', 'cl-h cl-' + k, T('cl.' + k)));
        const ul = el('ul', 'plain');
        items.forEach((x) => ul.appendChild(el('li', null, x)));
        body.appendChild(ul);
      }
      d.appendChild(body);
      box.appendChild(d);
    });
  }

  // ---------- данные и копии ----------
  async function loadBackupInfo() {
    S.backup = await S.ctx.api.backupInfo();
    renderBackupInfo();
  }

  function renderBackupInfo() {
    const b = S.backup;
    $('set-lastbackup').textContent = b && b.last
      ? fmtDate(b.last.mtime) + ' · ' + T('set.backup.kind.' + (b.last.kind in { auto: 1, manual: 1 } ? b.last.kind : 'pre'))
      : T('set.backup.none');
  }

  const afterRestore = () => location.reload();

  async function backupNow() {
    const r = await S.ctx.api.backupCreate();
    if (r && r.ok) { S.backup = r.info; renderBackupInfo(); S.ctx.toast(T('set.backup.done')); }
  }

  async function restore() {
    if (!confirm(T('set.backup.restore.confirm'))) return;
    const r = await S.ctx.api.backupRestore();
    if (r && r.ok) { S.ctx.toast(T('set.backup.restored')); setTimeout(afterRestore, 400); }
    else if (r && r.error === 'invalid') S.ctx.toast(T('set.backup.invalid'), true);
  }

  async function exportSettings() {
    const r = await S.ctx.api.exportSettings();
    if (r && r.ok) S.ctx.toast(T('set.export.done', { p: r.file }));
  }

  async function importSettings() {
    if (!confirm(T('set.import.confirm'))) return;
    const r = await S.ctx.api.importSettings();
    if (r && r.ok) { S.ctx.toast(T('set.import.done')); setTimeout(afterRestore, 400); }
    else if (r && r.error === 'invalid') S.ctx.toast(T('set.import.invalid'), true);
  }

  async function resetSettings() {
    if (!confirm(T('set.reset.confirm'))) return;
    const r = await S.ctx.api.resetSettings();
    if (r && r.ok) { S.ctx.toast(T('set.reset.done')); setTimeout(afterRestore, 400); }
  }

  // ---------- привязка событий ----------
  function bind() {
    const save = (patch, now) => S.ctx.save(patch, now);

    document.querySelectorAll('#set-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

    // основные
    $('set-lang').addEventListener('change', (e) => save({ language: e.target.value }, true));
    $('set-theme').addEventListener('change', (e) => save({ theme: e.target.value }, true));
    $('set-scale').addEventListener('change', (e) => save({ uiScale: +e.target.value }, true));
    $('set-accent').addEventListener('input', (e) => { save({ accent: e.target.value }); highlightAccent(); });
    $('set-accent-reset').addEventListener('click', () => { $('set-accent').value = '#7c9cff'; save({ accent: '#7c9cff' }, true); highlightAccent(); });
    const sw = $('set-accent-sw');
    ACCENTS.forEach((c) => {
      const b = el('button', 'sw');
      b.style.background = c; b.dataset.c = c; b.title = c;
      b.addEventListener('click', () => { $('set-accent').value = c; save({ accent: c }, true); highlightAccent(); });
      sw.appendChild(b);
    });
    $('set-autostart').addEventListener('change', (e) => save({ autostart: e.target.checked }, true));
    $('set-starthidden').addEventListener('change', (e) => save({ startHidden: e.target.checked }, true));
    $('set-closetray').addEventListener('change', (e) => save({ closeToTray: e.target.checked }, true));
    $('set-notify').addEventListener('change', (e) => save({ notify: e.target.checked }, true));
    $('set-sound').addEventListener('change', (e) => save({ sound: e.target.checked }, true));
    $('set-animations').addEventListener('change', (e) => save({ animations: e.target.checked }, true));
    $('set-rememberwin').addEventListener('change', (e) => save({ rememberWindow: e.target.checked }, true));

    // съёмка: горячие клавиши
    document.querySelectorAll('[data-hk-field]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        e.preventDefault();
        if (e.key === 'Tab') return;
        let acc;
        if (e.key === 'Backspace' || e.key === 'Delete') acc = '';
        else acc = window.Shared.keyToAccelerator(e);
        if (acc === null) return; // нажаты только модификаторы
        inp.value = acc;
        save({ hotkeys: { [inp.dataset.hkField]: acc } }, true).then(refreshHotkeyBadges);
      });
    });
    $('set-hk-reset').addEventListener('click', () => {
      save({ hotkeys: Object.assign({}, window.Shared.DEFAULT_HOTKEYS) }, true).then(() => { fill(); refreshHotkeyBadges(); });
    });
    // съёмка: сохранение
    $('set-folder-btn').addEventListener('click', async () => {
      const f = await S.ctx.api.chooseFolder();
      if (f) { $('set-folder').value = f; save({ saveFolder: f }, true); }
    });
    $('set-folder-reset').addEventListener('click', () => { $('set-folder').value = S.ctx.info.defaultFolder; save({ saveFolder: '' }, true); });
    $('set-datefolders').addEventListener('change', (e) => save({ dateFolders: e.target.value }, true));
    $('set-format').addEventListener('change', (e) => save({ format: e.target.value }, true).then(fill));
    $('set-quality').addEventListener('input', (e) => { $('set-quality-v').textContent = e.target.value + '%'; save({ jpgQuality: +e.target.value }); });
    $('set-template').addEventListener('input', (e) => { save({ fileTemplate: e.target.value }); updateExamples(); });

    // серия
    $('set-series-mode').addEventListener('change', (e) => save({ seriesMode: e.target.value }, true));
    $('set-series-prefix').addEventListener('input', (e) => { save({ seriesPrefix: e.target.value }); updateExamples(); });
    $('set-series-name').addEventListener('input', (e) => { save({ seriesNameTemplate: e.target.value }); updateExamples(); });
    $('set-series-caption').addEventListener('input', (e) => { save({ seriesCaption: e.target.value }); updateExamples(); });
    $('set-series-editor').addEventListener('change', (e) => save({ seriesOpenEditor: e.target.checked }, true));
    $('set-series-root-btn').addEventListener('click', async () => {
      const f = await S.ctx.api.chooseFolder();
      if (f) { $('set-series-root').value = f; save({ seriesRoot: f }, true); }
    });
    $('set-series-root-reset').addEventListener('click', () => { $('set-series-root').value = S.ctx.info.seriesRoot; save({ seriesRoot: '' }, true); });

    // данные
    $('set-opendata').addEventListener('click', () => S.ctx.api.openFolder(S.ctx.info.dataDir));
    $('set-histlimit').addEventListener('change', (e) => save({ historyLimit: +e.target.value }, true));
    $('set-clearhist').addEventListener('click', () => S.ctx.clearHistory());
    $('set-autobackup').addEventListener('change', (e) => save({ autoBackup: e.target.checked }, true));
    $('set-backup-now').addEventListener('click', backupNow);
    $('set-backup-restore').addEventListener('click', restore);
    $('set-backup-open').addEventListener('click', () => S.ctx.api.backupOpenDir());
    $('set-export').addEventListener('click', exportSettings);
    $('set-import').addEventListener('click', importSettings);
    $('set-reset').addEventListener('click', resetSettings);
  }

  function init(ctx) {
    S.ctx = ctx;
    bind();
    fill();
    document.addEventListener('langchange', () => {
      updateExamples(); refreshHotkeyBadges();
      if (S.tab === 'about') renderAbout();
      if (S.tab === 'changelog') renderChangelog();
      if (S.tab === 'data') renderBackupInfo();
    });
  }

  window.SettingsTab = {
    init, fill, showTab, refreshHotkeyBadges,
    onShow() { showTab(S.tab); refreshHotkeyBadges(); },
    _state: S
  };
})();
