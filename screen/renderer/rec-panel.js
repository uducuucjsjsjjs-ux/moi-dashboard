'use strict';
// Плавающая панель записи: таймер, размер файла, пауза и стоп.
(function () {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
  const mb = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB';
  window.recApi.onState((st) => {
    $('time').textContent = fmt(st.elapsedMs || 0);
    $('size').textContent = mb(st.bytes || 0);
    document.body.classList.toggle('paused', !!st.paused);
    $('pause').firstElementChild.innerHTML = st.paused
      ? '<path d="M7 5l12 7-12 7z"/>' : '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  });
  $('pause').addEventListener('click', () => window.recApi.panel('pause'));
  $('stop').addEventListener('click', () => window.recApi.panel('stop'));
})();
