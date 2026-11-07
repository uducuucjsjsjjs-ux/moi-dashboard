'use strict';
// Библиотека записей экрана: список в recordings.json (папка данных), сами видео лежат в папке записей.
// Не зависит от Electron.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./store');

class Recordings {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'recordings.json');
    const j = readJson(this.file, []);
    this.items = Array.isArray(j) ? j.filter((x) => x && typeof x.id === 'string' && typeof x.file === 'string') : [];
  }
  _save() { writeJson(this.file, this.items); }
  // новые сверху; записи, чей файл удалили вручную, пропадают из списка
  list() {
    const before = this.items.length;
    this.items = this.items.filter((x) => fs.existsSync(x.file));
    if (this.items.length !== before) this._save();
    return this.items.slice();
  }
  add(e) { this.items.unshift(e); this._save(); return e; }
  find(id) { return this.items.find((x) => x.id === id) || null; }
  findByFile(file) { return this.items.find((x) => x.file === file) || null; }
  update(id, patch) { const e = this.find(id); if (e) { Object.assign(e, patch); this._save(); } return e; }
  remove(id) { const i = this.items.findIndex((x) => x.id === id); if (i < 0) return null; const [e] = this.items.splice(i, 1); this._save(); return e; }
  replaceAll(items) {
    this.items = Array.isArray(items) ? items.filter((x) => x && typeof x.id === 'string' && typeof x.file === 'string') : [];
    this._save();
  }
}

// Папка записей: из настроек, а если пусто — <папка снимков>\Записи
function recFolder(settings, defaultShots) {
  return settings.recFolder || path.join(settings.saveFolder || defaultShots, 'Записи');
}

// Свободного места достаточно? statfs есть в Node 18.15+, иначе считаем, что достаточно
function freeMB(dir) {
  try {
    let d = dir;
    while (d && !fs.existsSync(d)) { const up = path.dirname(d); if (up === d) break; d = up; }
    const s = fs.statfsSync(d);
    return Math.floor((s.bavail * s.bsize) / 1048576);
  } catch (_) { return Infinity; }
}

// Решение, пора ли остановить запись: лимиты длины, размера и места на диске
function limitReached({ elapsedMs, bytes, freeMb }, s) {
  if (s.recMaxMinutes > 0 && elapsedMs >= s.recMaxMinutes * 60000) return 'time';
  if (s.recMaxMB > 0 && bytes >= s.recMaxMB * 1048576) return 'size';
  if (s.recMinFreeMB > 0 && freeMb !== Infinity && freeMb < s.recMinFreeMB) return 'disk';
  return null;
}

// Битрейт видео по качеству, размеру кадра и FPS (бит/с)
function videoBitrate(quality, width, height, fps) {
  const perPixel = { low: 0.05, medium: 0.1, high: 0.2 }[quality] || 0.1;   // бит на пиксель на кадр при 30 fps
  const v = Math.round(width * height * perPixel * Math.min(60, fps) / 30 * 30);
  return Math.max(500000, Math.min(30000000, v));
}

module.exports = { Recordings, recFolder, freeMB, limitReached, videoBitrate };
