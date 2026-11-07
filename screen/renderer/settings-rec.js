'use strict';
// Настройки записи. Поля описаны списком, как в «Карточнике»: панель, затем строки «название — элемент».
(function () {
  const $ = (id) => document.getElementById(id);
  const T = (k, p) => window.I18n.t(k, p);
  const S = { ctx: null, built: false, devices: { audioinput: [], videoinput: [] } };

  const GROUPS = [
    { id: 'defaults', fields: [
      { k: 'recMode', t: 'enum', v: ['screen', 'window', 'region'], pre: 'rec.mode.' },
      { k: 'recFormat', t: 'enum', v: ['mp4', 'webm'], raw: true, hint: true },
      { k: 'recFps', t: 'enum', v: [15, 30, 60], num: true, raw: true },
      { k: 'recQuality', t: 'enum', v: ['low', 'medium', 'high'], hint: true },
      { k: 'recCursor', t: 'bool' }
    ] },
    { id: 'audio', fields: [
      { k: 'recSystemAudio', t: 'bool', hint: true },
      { k: 'recSystemGain', t: 'range', min: 0, max: 200, step: 5, unit: '%' },
      { k: 'recMic', t: 'bool' },
      { k: 'recMicGain', t: 'range', min: 0, max: 200, step: 5, unit: '%' },
      { k: 'recMicDevice', t: 'device', kind: 'audioinput' }
    ] },
    { id: 'cam', fields: [
      { k: 'recWebcam', t: 'bool' },
      { k: 'recCamDevice', t: 'device', kind: 'videoinput' },
      { k: 'recCamCorner', t: 'enum', v: ['tl', 'tr', 'bl', 'br'] },
      { k: 'recCamSize', t: 'range', min: 10, max: 40, step: 1, unit: '%' },
      { k: 'recCamShape', t: 'enum', v: ['circle', 'rect'] }
    ] },
    { id: 'behavior', fields: [
      { k: 'recPanel', t: 'bool', hint: true },
      { k: 'recHideWindow', t: 'bool', hint: true },
      { k: 'recNotify', t: 'bool' }
    ] },
    { id: 'limits', fields: [
      { k: 'recMaxMinutes', t: 'int', min: 0, max: 600, unit: 'min', hint: true },
      { k: 'recMaxMB', t: 'int', min: 0, max: 100000, unit: 'MB', hint: true },
      { k: 'recMinFreeMB', t: 'int', min: 0, max: 100000, unit: 'MB', hint: true }
    ] },
    { id: 'folder', fields: [{ k: 'recFolder', t: 'folder', hint: true }] }
  ];

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const inputOf = (k) => document.querySelector('[data-rs="' + k + '"]');
  const save = (patch) => S.ctx.save(patch, true);

  function control(f) {
    const wrap = el('span', 'fc');
    if (f.t === 'bool') {
      const i = el('input'); i.type = 'checkbox'; i.dataset.rs = f.k;
      i.addEventListener('change', () => { save({ [f.k]: i.checked }); if (window.RecordTab) window.RecordTab.fill(); });
      wrap.appendChild(i);
    } else if (f.t === 'enum') {
      const sel = el('select'); sel.dataset.rs = f.k;
      for (const v of f.v) { const o = el('option'); o.value = String(v); if (f.raw && !f.hint) o.textContent = String(v); else { o.dataset.i18n = (f.pre || 'rs.' + f.k + '.') + v; } sel.appendChild(o); }
      if (f.raw) for (const o of sel.options) { o.removeAttribute('data-i18n'); o.textContent = f.k === 'recFps' ? o.value + ' FPS' : o.value.toUpperCase(); }
      sel.addEventListener('change', () => { save({ [f.k]: f.num ? +sel.value : sel.value }); if (window.RecordTab) window.RecordTab.fill(); });
      wrap.appendChild(sel);
    } else if (f.t === 'range') {
      const r = el('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.dataset.rs = f.k;
      const v = el('span', 'muted'); v.dataset.rsv = f.k; v.style.minWidth = '48px';
      r.addEventListener('input', () => { v.textContent = r.value + (f.unit || ''); });
      r.addEventListener('change', () => save({ [f.k]: +r.value }));
      wrap.append(r, v);
    } else if (f.t === 'int') {
      const n = el('input'); n.type = 'number'; n.min = f.min; n.max = f.max; n.className = 'num'; n.dataset.rs = f.k;
      n.addEventListener('change', () => { const v = Math.min(f.max, Math.max(f.min, parseInt(n.value, 10) || 0)); n.value = v; save({ [f.k]: v }); });
      wrap.append(n, el('span', 'muted', f.unit === 'min' ? T('rs.unit.min') : f.unit));
    } else if (f.t === 'device') {
      const sel = el('select'); sel.dataset.rs = f.k; sel.dataset.kind = f.kind;
      sel.addEventListener('change', () => save({ [f.k]: sel.value }));
      const b = el('button', 'btn sm', T('rs.devices.refresh')); b.dataset.i18n = 'rs.devices.refresh';
      b.addEventListener('click', () => loadDevices(f.kind, true));
      wrap.append(sel, b);
    } else if (f.t === 'folder') {
      const i = el('input'); i.readOnly = true; i.dataset.rs = f.k; i.style.width = '320px';
      const b = el('button', 'btn sm'); b.dataset.i18n = 'set.choose';
      b.addEventListener('click', async () => { const p = await S.ctx.api.chooseFolder(); if (p) { save({ recFolder: p }); fill(); } });
      const d = el('button', 'btn sm'); d.dataset.i18n = 'set.default';
      d.addEventListener('click', () => { save({ recFolder: '' }); fill(); });
      wrap.append(i, b, d);
    }
    return wrap;
  }

  function build() {
    const box = $('rs-fields');
    for (const g of GROUPS) {
      const panel = el('div', 'panel');
      const h = el('h2'); h.dataset.i18n = 'rs.g.' + g.id; panel.appendChild(h);
      for (const f of g.fields) {
        const row = el('div', 'frow');
        const l = el('span', 'fl'); const t = el('span'); t.dataset.i18n = 'rs.' + f.k; l.appendChild(t);
        if (f.hint) { const hh = el('span', 'hint'); hh.dataset.i18n = 'rs.' + f.k + '.h'; l.appendChild(hh); }
        row.append(l, control(f));
        panel.appendChild(row);
      }
      box.appendChild(panel);
    }
    S.built = true;
  }

  // Список устройств. Названия видны только после разрешения, поэтому по кнопке спрашиваем доступ один раз.
  async function loadDevices(kind, ask) {
    const md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return;
    try {
      if (ask) { const st = await md.getUserMedia(kind === 'audioinput' ? { audio: true } : { video: true }); st.getTracks().forEach((t) => t.stop()); }
    } catch (_) { S.ctx.toast(T('rs.devices.denied'), true); }
    let list = [];
    try { list = (await md.enumerateDevices()).filter((d) => d.kind === kind); } catch (_) {}
    S.devices[kind] = list;
    fillDevices();
  }
  function fillDevices() {
    document.querySelectorAll('select[data-kind]').forEach((sel) => {
      const cur = S.ctx.getSettings()[sel.dataset.rs];
      sel.textContent = '';
      const d0 = el('option', null, T('rs.devices.default')); d0.value = ''; sel.appendChild(d0);
      S.devices[sel.dataset.kind].forEach((d, i) => { const o = el('option', null, d.label || (T('rs.devices.n') + ' ' + (i + 1))); o.value = d.deviceId; sel.appendChild(o); });
      if (cur && ![...sel.options].some((o) => o.value === cur)) { const o = el('option', null, T('rs.devices.saved')); o.value = cur; sel.appendChild(o); }
      sel.value = cur || '';
    });
  }

  async function fill() {
    if (!S.built) return;
    const s = S.ctx.getSettings();
    document.querySelectorAll('[data-rs]').forEach((n) => {
      const k = n.dataset.rs;
      if (n.dataset.kind) return;
      if (n.type === 'checkbox') n.checked = !!s[k];
      else if (n.tagName === 'SELECT') n.value = String(s[k]);
      else if (n.dataset.rs === 'recFolder') n.value = s.recFolder || ((s.saveFolder || S.ctx.info.defaultFolder) + '\\Записи');
      else n.value = s[k];
      const v = document.querySelector('[data-rsv="' + k + '"]');
      if (v) v.textContent = s[k] + (n.type === 'range' ? '%' : '');
    });
    fillDevices();
  }

  function init(ctx) {
    S.ctx = ctx;
    build();
    window.I18n.apply($('rs-fields'));
    fill();
    document.addEventListener('langchange', () => { window.I18n.apply($('rs-fields')); fill(); });
    loadDevices('audioinput', false); loadDevices('videoinput', false);
  }

  window.RecSettings = { init, fill };
})();
