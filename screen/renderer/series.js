'use strict';
// Страница «Серия ЛР»: начать или продолжить серию, делать шаги, править подписи, переснимать и удалять шаги.

(function () {
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);
  const S = { ctx: null, active: null, recent: [], previewTimer: null };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- форма «Новая серия» ----------
  function formValues() {
    return { prefix: $('ser-prefix').value.trim(), lab: $('ser-lab').value.trim(), discipline: $('ser-disc').value.trim(),
      startFigure: parseInt($('ser-fig').value, 10) || 1 };
  }

  function updatePreview() {
    const s = S.ctx.getSettings();
    const v = formValues();
    const ext = s.format === 'jpg' ? '.jpg' : '.png';
    $('ser-preview').textContent = window.Shared.sanitize(v.lab)
      ? window.Shared.stepBase(s.seriesNameTemplate, { prefix: v.prefix, lab: v.lab, step: 1 }) + ext +
        ' · ' + window.Shared.captionFor(s.seriesCaption, v.startFigure, '')
      : '—';
    clearTimeout(S.previewTimer);
    S.previewTimer = setTimeout(async () => {
      const r = await S.ctx.api.seriesPreview(v);
      $('ser-willsave').textContent = r && r.ok ? r.folder + (r.exists ? ' — ' + T('ser.exists') : '') : '—';
    }, 120);
  }

  async function create() {
    const v = formValues();
    if (!window.Shared.sanitize(v.lab)) { S.ctx.toast(T('ser.err.lab'), true); $('ser-lab').focus(); return; }
    const r = await S.ctx.api.seriesCreate(v);
    if (!r || !r.ok) { S.ctx.toast(T(r && r.error === 'fs' ? 'ser.err.fs' : 'ser.err.lab'), true); return; }
    S.active = r.active;
    S.ctx.toast(T(r.resumed ? 'ser.resumed' : 'ser.started', { t: r.active.title }));
    await refresh();
  }

  async function openRecent() {
    const folder = $('ser-recent').value;
    if (!folder) return;
    const r = await S.ctx.api.seriesOpen(folder);
    if (!r || !r.ok) { S.ctx.toast(T('ser.err.open'), true); await refresh(); return; }
    await refresh();
  }

  async function openFolder() {
    const r = await S.ctx.api.seriesOpen();
    if (r && r.error === 'nomanifest') S.ctx.toast(T('ser.err.nomanifest'), true);
    if (r && r.ok) await refresh();
  }

  // ---------- активная серия ----------
  function modeLabel() {
    return T('ser.mode.' + S.ctx.getSettings().seriesMode);
  }

  function renderHead() {
    const a = S.active;
    $('ser-title').textContent = a.title;
    $('ser-next').textContent = T('ser.next', { step: a.nextStep, fig: a.nextFigure });
    $('ser-path').textContent = a.folder;
    $('ser-mode').value = S.ctx.getSettings().seriesMode;
  }

  function stepCard(st) {
    const card = el('div', 'step');
    const th = el('div', 'step-th');
    const img = el('img');
    img.alt = '';
    th.appendChild(img);
    if (!st.exists) th.appendChild(el('div', 'step-missing', T('ser.missing')));
    else S.ctx.api.seriesThumb(st.step).then((u) => { if (u) img.src = u; });

    const body = el('div', 'step-body');
    body.appendChild(el('div', 'step-title', T('ser.stepTitle', { step: st.step, fig: st.figure })));
    body.appendChild(el('div', 'muted step-file', st.fileName));
    const inp = el('input', 'step-text');
    inp.type = 'text'; inp.maxLength = 300; inp.value = st.text;
    inp.placeholder = T('ser.captionPh');
    inp.dataset.step = String(st.step);
    const cap = el('div', 'step-cap', st.caption);
    cap.dataset.cap = String(st.step);
    const save = async () => {
      if (inp.value.trim() === st.text) return;
      const r = await S.ctx.api.seriesCaption(st.step, inp.value);
      if (r && r.ok) { S.active = r.active; st.text = inp.value.trim(); updateCaptions(); }
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    body.append(inp, cap);

    const btns = el('div', 'btns step-btns');
    const mk = (txt, fn, cls) => { const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), txt); b.addEventListener('click', fn); return b; };
    btns.append(
      mk(T('ser.edit'), async () => {
        const e = await S.ctx.api.seriesEntry(st.step);
        if (e) S.ctx.openEditorById(e.id); else S.ctx.toast(T('ser.missing'), true);
      }),
      mk(T('ser.retake'), async () => { await save(); await S.ctx.api.seriesRetake(st.step); }),
      mk(T('ser.showFile'), () => S.ctx.api.seriesShowFile(st.step)),
      mk(T('ser.remove'), async () => {
        if (!confirm(T('ser.remove.confirm', { step: st.step }))) return;
        const r = await S.ctx.api.seriesRemove(st.step);
        if (r && r.ok) { S.active = r.active; render(); }
      }, 'danger')
    );
    card.append(th, body, btns);
    return card;
  }

  // Подписи пересчитываются, когда меняется текст у любого шага
  function updateCaptions() {
    for (const st of S.active.steps) {
      const c = document.querySelector('[data-cap="' + st.step + '"]');
      if (c) c.textContent = st.caption;
    }
  }

  function renderList() {
    const list = $('ser-list');
    list.textContent = '';
    const steps = S.active.steps;
    $('ser-empty').hidden = steps.length > 0;
    steps.forEach((st) => list.appendChild(stepCard(st)));
  }

  function renderRecent() {
    const sel = $('ser-recent');
    sel.textContent = '';
    for (const r of S.recent) {
      const o = document.createElement('option');
      o.value = r.folder;
      o.textContent = r.title + ' — ' + T('ser.stepsCount', { n: r.steps });
      sel.appendChild(o);
    }
    const none = S.recent.length === 0;
    $('ser-recent-empty').hidden = !none;
    sel.hidden = none;
    $('ser-open-recent').hidden = none;
  }

  function render() {
    const has = !!S.active;
    $('ser-none').hidden = has;
    $('ser-active').hidden = !has;
    if (has) { renderHead(); renderList(); } else { renderRecent(); updatePreview(); }
  }

  async function refresh() {
    const st = await S.ctx.api.seriesState();
    S.active = st.active;
    S.recent = st.recent;
    render();
  }

  async function step() {
    await S.ctx.api.seriesStep($('ser-mode').value);
  }

  async function copyCaptions() {
    const lines = S.active.steps.map((st) => st.caption);
    await S.ctx.api.copyText(lines.join('\n'));
    S.ctx.toast(T('ser.copied', { n: lines.length }));
  }

  async function close() {
    await S.ctx.api.seriesClose();
    await refresh();
  }

  function init(ctx) {
    S.ctx = ctx;
    $('ser-create').addEventListener('click', create);
    ['ser-prefix', 'ser-lab', 'ser-disc', 'ser-fig'].forEach((id) => $(id).addEventListener('input', updatePreview));
    $('ser-lab').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    $('ser-open-recent').addEventListener('click', openRecent);
    $('ser-open-folder').addEventListener('click', openFolder);
    $('ser-step').addEventListener('click', step);
    $('ser-mode').addEventListener('change', (e) => ctx.save({ seriesMode: e.target.value }, true));
    $('ser-copycaps').addEventListener('click', copyCaptions);
    $('ser-openfolder').addEventListener('click', () => ctx.api.openFolder(S.active.folder));
    $('ser-close').addEventListener('click', close);
    ctx.api.onSeriesChanged(() => refresh());
    document.addEventListener('langchange', () => { if (S.ctx) render(); });
    $('ser-prefix').value = ctx.getSettings().seriesPrefix;
  }

  window.SeriesTab = {
    init, refresh,
    // подставить значения по умолчанию в форму (после смены настроек)
    syncDefaults() { if (S.ctx && !$('ser-lab').value) $('ser-prefix').value = S.ctx.getSettings().seriesPrefix; updatePreviewSafe(); },
    _state: S
  };

  function updatePreviewSafe() { if (S.ctx && !S.active) updatePreview(); }
})();
