'use strict';
// Окно выбора области. Показывает «замороженный» снимок монитора и даёт выделить прямоугольник.

(function () {
  const bg = document.getElementById('bg');
  const dim = document.getElementById('dim');
  const sel = document.getElementById('sel');
  const label = document.getElementById('label');
  const hint = document.getElementById('hint');
  const vl = document.getElementById('vl');
  const hl = document.getElementById('hl');

  let start = null;   // точка начала
  let rect = null;    // текущее выделение в CSS-пикселях
  let ready = false;

  function norm(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  function draw() {
    if (!rect) { sel.style.display = 'none'; label.style.display = 'none'; dim.style.display = 'block'; return; }
    dim.style.display = 'none'; // затемнение теперь даёт тень рамки
    sel.style.display = 'block';
    sel.style.left = rect.x + 'px';
    sel.style.top = rect.y + 'px';
    sel.style.width = rect.w + 'px';
    sel.style.height = rect.h + 'px';
    label.style.display = 'block';
    label.textContent = Math.round(rect.w * (window.devicePixelRatio || 1)) + ' × ' +
      Math.round(rect.h * (window.devicePixelRatio || 1));
    const ly = rect.y > 30 ? rect.y - 28 : rect.y + rect.h + 6;
    label.style.left = rect.x + 'px';
    label.style.top = ly + 'px';
  }

  function cancel() { window.overlayApi.cancel(); }

  window.overlayApi.onInit((data) => {
    const blob = new Blob([data.image], { type: 'image/jpeg' });
    bg.src = URL.createObjectURL(blob);
    if (data.hint) hint.textContent = data.hint;
    ready = true;
  });

  window.addEventListener('mousemove', (e) => {
    vl.style.left = e.clientX + 'px';
    hl.style.top = e.clientY + 'px';
    if (!start) return;
    rect = norm(start, { x: e.clientX, y: e.clientY });
    draw();
  });

  window.addEventListener('mousedown', (e) => {
    e.preventDefault(); // не даём начаться перетаскиванию картинки
    if (!ready) return;
    if (e.button === 2) { cancel(); return; }
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    hint.style.display = 'none';
    vl.style.display = hl.style.display = 'none';
    rect = { x: start.x, y: start.y, w: 0, h: 0 };
    draw();
  });

  window.addEventListener('mouseup', (e) => {
    if (!start || e.button !== 0) return;
    const r = norm(start, { x: e.clientX, y: e.clientY });
    start = null;
    if (r.w < 3 || r.h < 3) { rect = null; draw(); vl.style.display = hl.style.display = 'block'; return; }
    window.overlayApi.done(r);
  });

  window.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
window.addEventListener('dragstart', (e) => e.preventDefault());
})();
