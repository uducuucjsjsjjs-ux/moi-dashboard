'use strict';
// Вкладка «Запись»: источник, звук, камера, кнопка старта, идущая запись и библиотека записей.
(function () {
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);
  const S = { ctx: null, state: { state: 'idle' }, list: [], windows: [], mode: 'screen' };

  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
  const fmtDur = (sec) => fmtTime(Math.round(sec) * 1000);
  const fmtSize = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString(window.I18n.getLang() === 'en' ? 'en-GB' : 'ru-RU') + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const baseName = (p) => String(p).split(/[\\/]/).pop();

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---------- верхняя панель ----------
  function summary() {
    const s = S.ctx.getSettings();
    return T('rec.sum', { fps: s.recFps, q: T('rs.recQuality.' + s.recQuality), f: s.recFormat.toUpperCase() });
  }

  function renderIdle() {
    const s = S.ctx.getSettings();
    S.mode = s.recMode;
    document.querySelectorAll('#rec-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));
    $('rec-winrow').hidden = S.mode !== 'window';
    document.querySelectorAll('[data-rec-quick]').forEach((c) => { c.checked = !!s[c.dataset.recQuick]; });
    $('rec-sum').textContent = summary();
  }

  async function loadWindows() {
    S.windows = (await S.ctx.api.recWindows()) || [];
    const sel = $('rec-window');
    const keep = sel.value;
    sel.textContent = '';
    for (const w of S.windows) { const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; sel.appendChild(o); }
    if (S.windows.some((w) => w.id === keep)) sel.value = keep;
    if (!S.windows.length) { const o = document.createElement('option'); o.value = ''; o.textContent = T('rec.nowindows'); sel.appendChild(o); }
  }

  async function start() {
    const opts = { mode: S.mode };
    if (S.mode === 'window') {
      if (!$('rec-window').value) { await loadWindows(); }
      if (!$('rec-window').value) { S.ctx.toast(T('rec.nowindows'), true); return; }
      opts.sourceId = $('rec-window').value;
    }
    const r = await S.ctx.api.recStart(opts);
    if (r && !r.ok && r.error && r.error !== 'cancelled' && r.error !== 'busy') S.ctx.toast(T(['disk', 'source', 'timeout'].includes(r.error) ? 'rec.err.' + r.error : 'rec.err.generic'), true);
  }

  // ---------- состояние записи ----------
  function applyState(st) {
    S.state = st;
    const live = st.state !== 'idle';
    $('rec-live').hidden = !live;
    $('rec-idle').classList.toggle('disabled', live);
    $('rec-start').disabled = live;
    if (!live) return;
    $('rec-live').classList.toggle('paused', !!st.paused);
    $('rec-time').textContent = fmtTime(st.elapsedMs || 0);
    const label = { starting: 'rec.st.starting', recording: 'rec.st.recording', paused: 'rec.st.paused', finishing: 'rec.st.finishing' }[st.state] || 'rec.st.recording';
    $('rec-state').textContent = T(label);
    const limit = st.maxMs ? ' · ' + T('rec.limit', { t: fmtTime(st.maxMs) }) : '';
    $('rec-meta').textContent = fmtSize(st.bytes || 0) + limit + (st.warnings && st.warnings.length ? ' · ⚠ ' + st.warnings.map((w) => T('rec.warn.' + w)).join(', ') : '');
    $('rec-bar').hidden = st.state !== 'finishing';
    $('rec-bar-i').style.width = Math.round((st.progress || 0) * 100) + '%';
    $('rec-pause').disabled = st.state !== 'recording' && st.state !== 'paused';
    $('rec-pause').firstElementChild.textContent = st.paused ? T('rec.resume') : T('rec.pause');
    $('rec-stop').disabled = st.state !== 'recording' && st.state !== 'paused';
  }

  // ---------- библиотека ----------
  function row(e) {
    const r = el('div', 'rec-row');
    const th = el('div', 'rec-th'); const img = el('img'); img.alt = ''; th.appendChild(img);
    S.ctx.api.recThumb(e.id).then((u) => { if (u) img.src = u; else { img.remove(); th.textContent = '▶'; } });
    const info = el('div', 'rec-info');
    const b = el('b', null, baseName(e.file)); b.title = e.file;
    const meta = [fmtDate(e.createdAt), fmtDur(e.duration || 0), e.width && e.height ? e.width + '×' + e.height : null, fmtSize(e.size || 0), e.hasAudio ? T('rec.audio') : T('rec.noaudio')].filter(Boolean).join(' · ');
    info.append(b, el('span', null, meta));
    const acts = el('div', 'rec-acts');
    const mk = (txt, fn, cls) => { const x = el('button', 'btn sm' + (cls ? ' ' + cls : ''), txt); x.addEventListener('click', fn); return x; };
    if (S.ctx.openVideo) acts.append(mk(T('rec.edit'), () => S.ctx.openVideo(e.id)));
    acts.append(
      mk(T('rec.play'), () => S.ctx.api.recPlay(e.id)),
      mk(T('rec.show'), () => S.ctx.api.recShow(e.id)),
      mk(T('rec.delete'), async () => {
        if (!confirm(T('rec.delete.confirm', { name: baseName(e.file) }))) return;
        if (await S.ctx.api.recDelete(e.id)) { S.ctx.toast(T('rec.deleted')); refreshList(); }
      }, 'danger')
    );
    r.append(th, info, acts);
    return r;
  }

  async function refreshList() {
    S.list = (await S.ctx.api.recList()) || [];
    const box = $('rec-list');
    box.textContent = '';
    S.list.forEach((e) => box.appendChild(row(e)));
    $('rec-empty').hidden = S.list.length > 0;
  }

  async function show() {
    renderIdle();
    applyState(await S.ctx.api.recState());
    await refreshList();
    if (S.mode === 'window') loadWindows();
  }

  function init(ctx) {
    S.ctx = ctx;
    document.querySelectorAll('#rec-modes button').forEach((b) => b.addEventListener('click', () => {
      S.ctx.save({ recMode: b.dataset.mode }, true); renderIdle();
      if (b.dataset.mode === 'window') loadWindows();
    }));
    document.querySelectorAll('[data-rec-quick]').forEach((c) => c.addEventListener('change', () => {
      S.ctx.save({ [c.dataset.recQuick]: c.checked }, true);
      if (window.RecSettings) window.RecSettings.fill();
    }));
    $('rec-winrefresh').addEventListener('click', loadWindows);
    $('rec-start').addEventListener('click', start);
    $('rec-stop').addEventListener('click', () => ctx.api.recStop());
    $('rec-pause').addEventListener('click', () => ctx.api.recPause());
    $('rec-openfolder').addEventListener('click', () => ctx.api.recOpenFolder());
    ctx.api.onRecState((st) => applyState(st));
    ctx.api.onRecList(() => refreshList());
    document.addEventListener('langchange', () => { renderIdle(); applyState(S.state); refreshList(); });
  }

  window.RecordTab = { init, show, refresh: refreshList, fill: renderIdle, _state: S };
})();
