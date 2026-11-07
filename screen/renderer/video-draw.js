'use strict';
// Рисование наложений видео (текст и стрелка) на canvas. Одна и та же функция рисует предпросмотр
// и PNG для экспорта, поэтому в готовом ролике надпись выглядит так же, как на экране редактора.
(function (root) {
  const FONT = '"Segoe UI", system-ui, Arial, sans-serif';

  function textLines(ov) { return String(ov.text == null ? '' : ov.text).split(/\r?\n/); }

  // Рисует наложение в кадре W×H. Возвращает прямоугольник в пикселях (для рамки выделения) или null.
  function drawOverlay(c, ov, W, H) {
    if (ov.type === 'text') {
      const lines = textLines(ov);
      if (!lines.some((l) => l.trim())) return null;
      const fs = Math.max(8, Math.round(ov.size * H));
      c.save();
      c.font = '600 ' + fs + 'px ' + FONT;
      c.textBaseline = 'top';
      const lh = Math.round(fs * 1.25);
      const tw = Math.max(...lines.map((l) => c.measureText(l).width));
      const pad = Math.round(fs * 0.35);
      const x = Math.round(ov.x * W), y = Math.round(ov.y * H);
      const bw = Math.ceil(tw) + pad * 2, bh = lh * lines.length + pad * 2 - Math.round(fs * 0.25);
      if (ov.bg) {
        c.fillStyle = 'rgba(12,13,16,0.72)';
        const r = Math.round(fs * 0.25);
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, bw, bh, r); else c.rect(x, y, bw, bh);
        c.fill();
      } else {
        c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = Math.max(2, fs * 0.12); c.shadowOffsetY = 1;
      }
      c.fillStyle = ov.color || '#ffffff';
      lines.forEach((l, i) => c.fillText(l, x + pad, y + pad + i * lh));
      c.restore();
      return { x, y, w: bw, h: bh };
    }
    if (ov.type === 'arrow') {
      const x1 = ov.x1 * W, y1 = ov.y1 * H, x2 = ov.x2 * W, y2 = ov.y2 * H;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 2) return null;
      const lw = Math.max(2, ov.width * H);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.min(len * 0.6, lw * 4.5);
      c.save();
      c.strokeStyle = c.fillStyle = ov.color || '#ef4444';
      c.lineWidth = lw; c.lineCap = 'round';
      c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = lw;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(ang) * head * 0.7, y2 - Math.sin(ang) * head * 0.7); c.stroke();
      c.beginPath();
      c.moveTo(x2, y2);
      c.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
      c.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
      c.closePath(); c.fill();
      c.restore();
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    return null;
  }

  // Размытие участка на canvas (для «Кадр в PNG»)
  function drawBlur(c, canvas, ov, W, H) {
    const x = Math.round(ov.x * W), y = Math.round(ov.y * H), w = Math.round(ov.w * W), h = Math.round(ov.h * H);
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.filter = 'blur(' + Math.max(1, Math.round(ov.strength * H / 360)) + 'px)';
    c.drawImage(canvas, 0, 0);
    c.restore();
  }

  function toBytes(canvas) {
    return new Promise((res, rej) => canvas.toBlob((b) => {
      if (!b) return rej(new Error('toBlob'));
      b.arrayBuffer().then((ab) => res(new Uint8Array(ab)), rej);
    }, 'image/png'));
  }

  // PNG на весь кадр с одним наложением (прозрачный фон) — ffmpeg накладывает его на нужный отрезок
  async function renderOverlayPng(ov, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const r = drawOverlay(cv.getContext('2d'), ov, W, H);
    return r ? toBytes(cv) : null;
  }

  const api = { drawOverlay, drawBlur, renderOverlayPng, toBytes };
  root.VideoDraw = api;
})(window);
