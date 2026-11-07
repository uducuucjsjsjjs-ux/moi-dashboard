'use strict';
// Чистая логика без зависимости от Electron — её можно тестировать отдельно.

const path = require('path');
const { formatName, keyToAccelerator, DEFAULT_HOTKEYS } = require('../renderer/shared');

// Свободное имя файла: name.png, name (2).png ...
function uniquePath(dir, base, ext, existsFn) {
  let p = path.join(dir, base + ext);
  let i = 2;
  while (existsFn(p)) {
    p = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return p;
}

// Приведение прямоугольника выделения (в CSS-пикселях экрана) к пикселям изображения
function cropRectToImage(rect, scaleFactor, imgW, imgH) {
  const x = Math.max(0, Math.round(rect.x * scaleFactor));
  const y = Math.max(0, Math.round(rect.y * scaleFactor));
  const w = Math.min(imgW - x, Math.round(rect.w * scaleFactor));
  const h = Math.min(imgH - y, Math.round(rect.h * scaleFactor));
  return { x, y, width: Math.max(0, w), height: Math.max(0, h) };
}

const SETTINGS_SCHEMA = 3; // 1 — версии 0.0.x (в файле нет поля _v), 2 — версия 0.1, 3 — версия 0.2 (запись экрана)

const DEFAULT_SETTINGS = {
  // --- съёмка и сохранение ---
  saveFolder: '',              // пусто = Изображения\Скриншоты
  format: 'png',               // png | jpg
  jpgQuality: 92,
  fileTemplate: 'Снимок_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}',
  dateFolders: 'none',         // none | month | day — подпапки по дате
  autosave: true,              // класть файл в папку сохранения
  copyToClipboard: true,
  openEditor: true,
  notify: true,
  sound: false,
  delaySec: 0,
  hotkeys: Object.assign({}, DEFAULT_HOTKEYS),
  // --- программа ---
  language: 'ru',              // ru | en
  theme: 'dark',               // dark | light | system
  accent: '#7c9cff',
  uiScale: 100,                // 90 | 100 | 110 | 125 | 150
  autostart: false,
  startHidden: false,          // при автозапуске скрывать окно в трей
  closeToTray: true,
  animations: true,            // плавные переходы в интерфейсе
  rememberWindow: true,        // помнить размер и место окна
  windowBounds: { x: -1, y: -1, width: 0, height: 0 },
  // --- данные ---
  historyLimit: 500,           // 100 | 500 | 2000
  autoBackup: true,
  // --- серия для лабораторной ---
  seriesMode: 'region',        // region | screen | window
  seriesPrefix: 'ЛР',
  seriesNameTemplate: '{prefix}{lab}_шаг{step}',
  seriesCaption: 'Рисунок {n} — {text}',
  seriesRoot: '',              // пусто = <папка снимков>\Лабораторные
  seriesOpenEditor: false,
  // --- запись экрана ---
  recFolder: '',               // пусто = <папка снимков>\Записи
  recMode: 'screen',           // screen | window | region
  recFormat: 'mp4',            // mp4 | webm — во что превратить запись после остановки
  recFps: 30,                  // 15 | 30 | 60
  recQuality: 'medium',        // low | medium | high
  recCursor: true,             // показывать курсор на записи
  recSystemAudio: true,
  recSystemGain: 100,          // 0..200 %
  recMic: false,
  recMicGain: 100,             // 0..200 %
  recMicDevice: '',            // пусто = по умолчанию
  recWebcam: false,
  recCamDevice: '',
  recCamCorner: 'br',          // tl | tr | bl | br
  recCamSize: 20,              // ширина в % от кадра: 10..40
  recCamShape: 'circle',       // circle | rect
  recPanel: true,              // плавающая панель с таймером
  recHideWindow: true,         // прятать окно программы на время записи
  recMaxMinutes: 60,           // 0 = без лимита
  recMaxMB: 2048,              // 0 = без лимита
  recMinFreeMB: 1024,          // остановить запись, если на диске меньше
  recNotify: true,
  // --- редактор ---
  editor: { color: '#ef4444', width: 4 }
};

const ENUMS = {
  format: ['png', 'jpg'],
  dateFolders: ['none', 'month', 'day'],
  language: ['ru', 'en'],
  theme: ['dark', 'light', 'system'],
  seriesMode: ['region', 'screen', 'window'],
  recMode: ['region', 'screen', 'window'],
  recFormat: ['mp4', 'webm'],
  recQuality: ['low', 'medium', 'high'],
  recCamCorner: ['tl', 'tr', 'bl', 'br'],
  recCamShape: ['circle', 'rect']
};
const REC_FPS = [15, 30, 60];
const SCALES = [90, 100, 110, 125, 150];
const HISTORY_LIMITS = [100, 500, 2000];

function mergeSettings(saved) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!saved || typeof saved !== 'object') return s;
  for (const k of Object.keys(s)) {
    if (!(k in saved)) continue;
    if (k === 'hotkeys' || k === 'editor') {
      if (saved[k] && typeof saved[k] === 'object') {
        // берём только известные ключи со строковыми/числовыми значениями нужного типа
        for (const kk of Object.keys(s[k])) {
          if (typeof saved[k][kk] === typeof s[k][kk]) s[k][kk] = saved[k][kk];
        }
      }
    } else if (typeof saved[k] === typeof s[k]) s[k] = saved[k];
  }
  for (const [k, list] of Object.entries(ENUMS)) {
    if (!list.includes(s[k])) s[k] = DEFAULT_SETTINGS[k];
  }
  s.jpgQuality = Math.min(100, Math.max(40, Number(s.jpgQuality) || 92));
  s.delaySec = Math.min(30, Math.max(0, Number(s.delaySec) || 0));
  if (!SCALES.includes(s.uiScale)) s.uiScale = 100;
  if (!REC_FPS.includes(s.recFps)) s.recFps = DEFAULT_SETTINGS.recFps;
  const clamp = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
  s.recSystemGain = clamp(s.recSystemGain, 0, 200, 100);
  s.recMicGain = clamp(s.recMicGain, 0, 200, 100);
  s.recCamSize = clamp(s.recCamSize, 10, 40, 20);
  s.recMaxMinutes = clamp(s.recMaxMinutes, 0, 600, 60);
  s.recMaxMB = clamp(s.recMaxMB, 0, 100000, 2048);
  s.recMinFreeMB = clamp(s.recMinFreeMB, 0, 100000, 1024);
  if (s.windowBounds && typeof s.windowBounds === 'object') {
    const b = s.windowBounds;
    s.windowBounds = { x: clamp(b.x, -1, 100000, -1), y: clamp(b.y, -1, 100000, -1), width: clamp(b.width, 0, 20000, 0), height: clamp(b.height, 0, 20000, 0) };
  } else s.windowBounds = { x: -1, y: -1, width: 0, height: 0 };
  if (!HISTORY_LIMITS.includes(s.historyLimit)) s.historyLimit = DEFAULT_SETTINGS.historyLimit;
  if (!/^#[0-9a-fA-F]{6}$/.test(s.accent)) s.accent = DEFAULT_SETTINGS.accent;
  s.seriesPrefix = String(s.seriesPrefix).trim().slice(0, 12);
  for (const k of ['fileTemplate', 'seriesNameTemplate', 'seriesCaption']) {
    if (!String(s[k]).trim()) s[k] = DEFAULT_SETTINGS[k];
  }
  return s;
}

// Подпапка по дате: '' | '2026-10' | '2026-10-26'
function dateSubfolder(mode, date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  if (mode === 'month') return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  if (mode === 'day') return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return '';
}

module.exports = { formatName, uniquePath, keyToAccelerator, cropRectToImage, DEFAULT_SETTINGS, SETTINGS_SCHEMA, mergeSettings, dateSubfolder };
