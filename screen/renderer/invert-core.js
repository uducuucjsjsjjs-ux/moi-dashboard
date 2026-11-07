'use strict';
// Чистая математика инвертирования. Работает и в браузере, и в Node (для тестов).

(function (root) {
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
  }

  // data — Uint8ClampedArray RGBA (как у ImageData). Меняет массив на месте.
  // mode: 'full' (255 - значение) | 'lightness' (инверсия яркости, оттенок сохраняется)
  // gray: сначала перевести в оттенки серого. Альфа-канал не трогаем.
  function invertPixels(data, mode, gray) {
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (gray) {
        const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        r = g = b = y;
      }
      if (mode === 'lightness') {
        const [h, s, l] = rgbToHsl(r, g, b);
        const o = hslToRgb(h, s, 1 - l);
        data[i] = o[0]; data[i + 1] = o[1]; data[i + 2] = o[2];
      } else {
        data[i] = 255 - r; data[i + 1] = 255 - g; data[i + 2] = 255 - b;
      }
    }
    return data;
  }

  const api = { invertPixels, rgbToHsl, hslToRgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvertCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
