'use strict';
// Вкладка «Негатив»: инвертирование цветов одного или нескольких изображений.

(function () {
  const $ = (id) => document.getElementById(id);
  const S = { api: null, hooks: null, items: [], cur: -1, outFolder: null, busy: false };
  const T = (k, p) => window.I18n.t(k, p);

  function splitPath(p) {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const dir = i >= 0 ? p.slice(0, i) : '';
    const sep = i >= 0 ? p[i] : '\\';
    const file = p.slice(i + 1);
    const d = file.lastIndexOf('.');
    return { dir, sep, file, base: d > 0 ? file.slice(0, d) : file, ext: d > 0 ? file.slice(d).toLowerCase() : '' };
  }

  function opts() {
    const mode = (document.querySelector('input[name="inv-mode"]:checked') || {}).value || 'full';
    return { mode, gray: $('inv-gray').checked };
  }

  // Возвращает canvas с результатом для элемента
  function process(item) {
    const o = opts();
    const c = document.createElement('canvas');
    c.width = item.bitmap.width; c.height = item.bitmap.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(item.bitmap, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height);
    window.InvertCore.invertPixels(id.data, o.mode, o.gray);
    x.putImageData(id, 0, 0);
    return c;
  }

  function drawPreview() {
    const item = S.items[S.cur];
    const b = $('inv-before'), a = $('inv-after');
    if (!item) { b.width = a.width = 1; b.height = a.height = 1; return; }
    b.width = item.bitmap.width; b.height = item.bitmap.height;
    b.getContext('2d').drawImage(item.bitmap, 0, 0);
    const res = process(item);
    a.width = res.width; a.height = res.height;
    a.getContext('2d').drawImage(res, 0, 0);
  }

  function renderList() {
    const box = $('inv-list');
    box.textContent = '';
    S.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'inv-item' + (i === S.cur ? ' active' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = it.name; nm.title = it.name;
      const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕'; x.title = T('inv.remove');
      x.addEventListener('click', (e) => { e.stopPropagation(); removeItem(i); });
      row.append(nm, x);
      row.addEventListener('click', () => { S.cur = i; renderList(); drawPreview(); });
      box.appendChild(row);
    });
    $('inv-work').hidden = !S.items.length;
    $('inv-batch').textContent = S.items.length > 1 ? T('inv.batch.all', { n: S.items.length }) : T('inv.batch');
  }

  function removeItem(i) {
    S.items.splice(i, 1);
    if (S.cur >= S.items.length) S.cur = S.items.length - 1;
    renderList(); drawPreview();
  }

  async function addBytes(name, bytes, path) {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes]));
      S.items.push({ name, path: path || null, bitmap });
      S.cur = S.items.length - 1;
      renderList(); drawPreview();
      return true;
    } catch (e) {
      S.hooks.toast(T('inv.openFail', { n: name }), true);
      return false;
    }
  }

  async function addFiles(files) {
    for (const f of files) {
      if (!/\.(png|jpe?g|bmp|gif|webp)$/i.test(f.name) && !/^image\//.test(f.type)) continue;
      const buf = await f.arrayBuffer();
      await addBytes(f.name, buf, S.api.pathForFile(f));
    }
  }

  async function addPaths(paths) {
    for (const p of paths) {
      const b = await S.api.readFile(p);
      if (b) await addBytes(splitPath(p).file, b, p);
    }
  }

  function toBlob(canvas, ext) {
    const jpg = ext === '.jpg' || ext === '.jpeg';
    return new Promise((res) => canvas.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.95));
  }

  async function currentBytes() {
    const item = S.items[S.cur];
    if (!item) return null;
    const blob = await toBlob(process(item), '.png');
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function copy() {
    const b = await currentBytes();
    if (!b) return;
    const ok = await S.api.copyImage(b);
    S.hooks.toast(ok ? T('inv.copied') : T('toast.copyFail'), !ok);
  }

  async function saveAs() {
    const item = S.items[S.cur];
    if (!item) return;
    const b = await currentBytes();
    const p = await S.api.saveAs(b, splitPath(item.name).base + '_negative.png');
    if (p) S.hooks.toast(T('ed.saved', { p }));
  }

  async function toEditor() {
    const b = await currentBytes();
    if (!b) return;
    const e = await S.api.addToHistory(b, 'negative');
    if (e) S.hooks.openInEditor(e);
  }

  async function batch() {
    if (S.busy || !S.items.length) return;
    S.busy = true;
    const mode = (document.querySelector('input[name="inv-out"]:checked') || {}).value;
    const st = $('inv-batch-status');
    let ok = 0, fail = 0, lastDir = null;
    const defaultDir = (S.hooks.defaultFolder && S.hooks.defaultFolder()) || '';
    for (let i = 0; i < S.items.length; i++) {
      const it = S.items[i];
      st.textContent = T('inv.progress', { i: i + 1, n: S.items.length });
      try {
        const sp = splitPath(it.path || it.name);
        let dir, sep = it.path ? sp.sep : '\\';
        if (mode === 'folder' && S.outFolder) { dir = S.outFolder; sep = S.outFolder.includes('/') && !S.outFolder.includes('\\') ? '/' : '\\'; }
        else if (it.path) dir = sp.dir;
        else dir = defaultDir;
        if (!dir) { fail++; continue; }
        const ext = sp.ext === '.jpg' || sp.ext === '.jpeg' ? sp.ext : '.png';
        const blob = await toBlob(process(it), ext);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const out = await S.api.writeFile(dir + sep + sp.base + '_negative' + ext, bytes);
        if (out) { ok++; lastDir = dir; } else fail++;
      } catch (e) { fail++; }
      await new Promise((r) => setTimeout(r, 0)); // даём интерфейсу дышать
    }
    st.textContent = T('inv.done', { ok }) + (fail ? T('inv.done.err', { n: fail }) : '');
    S.hooks.toast(T('inv.toast', { ok }) + (fail ? T('inv.toast.err', { n: fail }) : ''), fail > 0 && ok === 0);
    S.busy = false;
    return { ok, fail, lastDir };
  }

  function init(opts2) {
    S.api = opts2.api; S.hooks = opts2.hooks;
    $('inv-open').addEventListener('click', async () => addPaths(await S.api.openImages()));
    $('inv-paste').addEventListener('click', pasteFromClipboard);
    $('inv-hist').addEventListener('click', () => S.hooks.pickHistory(async (id) => {
      const r = await S.api.readImage(id);
      if (r) await addBytes(splitPath(r.entry.file).file, r.bytes, r.entry.file);
    }));
    document.querySelectorAll('input[name="inv-mode"], #inv-gray').forEach((el) => el.addEventListener('change', drawPreview));
    $('inv-copy').addEventListener('click', copy);
    $('inv-saveas').addEventListener('click', saveAs);
    $('inv-toeditor').addEventListener('click', toEditor);
    $('inv-batch').addEventListener('click', batch);
    $('inv-folder').addEventListener('click', async () => {
      const f = await S.api.chooseOutFolder();
      if (f) {
        S.outFolder = f; $('inv-folder-path').textContent = f;
        document.querySelector('input[name="inv-out"][value="folder"]').checked = true;
      }
    });

    document.addEventListener('langchange', renderList);

    const drop = $('inv-drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    const page = $('page-invert');
    page.addEventListener('dragover', (e) => e.preventDefault());
    page.addEventListener('drop', (e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files || [])); });

    document.addEventListener('paste', (e) => {
      if (!S.hooks.isActive()) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); addFiles(files); } else pasteFromClipboard();
    });
  }

  async function pasteFromClipboard() {
    const b = await S.api.readClipboardImage();
    if (!b) { S.hooks.toast(T('inv.noClip'), true); return; }
    await addBytes(T('inv.clipName') + Date.now() + '.png', b, null);
  }

  window.InvertTab = {
    init, addBytes, addFiles, addPaths,
    // для тестов
    _state: S, _process: process, _batch: batch
  };
})();
