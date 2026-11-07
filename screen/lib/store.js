'use strict';
// Хранение настроек и истории в JSON. Не зависит от Electron: путь к данным передаётся снаружи.

const fs = require('fs');
const path = require('path');
const { mergeSettings, SETTINGS_SCHEMA } = require('./util');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Атомарная запись: сначала во временный файл, потом переименование
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.historyFile = path.join(dataDir, 'history.json');
    this.cacheDir = path.join(dataDir, 'cache');      // снимки, если автосохранение в папку выключено
    this.thumbDir = path.join(dataDir, 'thumbs');
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.thumbDir, { recursive: true });
    this.migrated = null;
    const raw = readJson(this.settingsFile, null);
    this.settings = mergeSettings(raw);
    // Миграция: настройки версий 0.0.x (без поля _v) переписываем в новом формате,
    // а старый файл сохраняем рядом, чтобы ничего не потерять.
    if (raw && typeof raw === 'object' && (raw._v || 1) < SETTINGS_SCHEMA) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
        const copy = path.join(this.backupDir, 'settings-before-migration-v' + (raw._v || 1) + '.json');
        if (!fs.existsSync(copy)) fs.copyFileSync(this.settingsFile, copy);
        this.migrated = { from: raw._v || 1, to: SETTINGS_SCHEMA, backup: copy };
        this._saveSettings();
      } catch (_) {}
    }
    const h = readJson(this.historyFile, []);
    this.history = Array.isArray(h) ? h.filter((x) => x && typeof x.id === 'string' && typeof x.file === 'string') : [];
  }

  getSettings() {
    return this.settings;
  }

  setSettings(patch) {
    const cur = this.settings;
    const next = Object.assign({}, cur, patch);
    // вложенные объекты сливаем, а не затираем целиком
    for (const k of ['hotkeys', 'editor']) {
      if (patch && patch[k] && typeof patch[k] === 'object') next[k] = Object.assign({}, cur[k], patch[k]);
    }
    this.settings = mergeSettings(next);
    this._saveSettings();
    if (this._applyHistoryLimit()) this._saveHistory();
    return this.settings;
  }

  resetSettings() {
    this.settings = mergeSettings(null);
    this._saveSettings();
    return this.settings;
  }

  // Полная замена настроек и/или истории (восстановление из копии, импорт)
  replaceAll({ settings, history }) {
    if (settings) { this.settings = mergeSettings(settings); this._saveSettings(); }
    if (Array.isArray(history)) {
      this.history = history.filter((x) => x && typeof x.id === 'string' && typeof x.file === 'string');
      this._applyHistoryLimit();
      this._saveHistory();
    }
  }

  listHistory(limit = 5000) {
    // отсеиваем записи, файлы которых удалили вручную
    const alive = this.history.filter((x) => fs.existsSync(x.file));
    if (alive.length !== this.history.length) {
      this.history = alive;
      this._saveHistory();
    }
    return this.history.slice(0, limit);
  }

  addHistory(entry) {
    this.history.unshift(entry);
    this._applyHistoryLimit();
    this._saveHistory();
    return entry;
  }

  getHistory(id) {
    return this.history.find((x) => x.id === id) || null;
  }

  findHistoryByFile(file) {
    return this.history.find((x) => x.file === file) || null;
  }

  removeHistory(id) {
    const i = this.history.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [e] = this.history.splice(i, 1);
    this._saveHistory();
    try { fs.unlinkSync(path.join(this.thumbDir, id + '.jpg')); } catch (_) {}
    return e;
  }

  // Очистка истории: файлы в пользовательской папке не трогаем, чистим только внутренний кэш
  clearHistory() {
    const old = this.history;
    this.history = [];
    this._saveHistory();
    for (const e of old) this._dropFiles(e);
    return old.length;
  }

  updateHistoryFile(id, patch) {
    const e = this.getHistory(id);
    if (!e) return null;
    Object.assign(e, patch);
    this._saveHistory();
    return e;
  }

  _dropFiles(e) {
    try { fs.unlinkSync(path.join(this.thumbDir, e.id + '.jpg')); } catch (_) {}
    try { if (path.dirname(e.file) === this.cacheDir) fs.unlinkSync(e.file); } catch (_) {}
  }

  // Старые записи сверх лимита уходят из истории; файлы в папках пользователя остаются
  _applyHistoryLimit() {
    const limit = this.settings.historyLimit;
    if (this.history.length > limit) {
      const dropped = this.history.splice(limit);
      for (const e of dropped) this._dropFiles(e);
      return dropped.length;
    }
    return 0;
  }

  _saveSettings() {
    writeJson(this.settingsFile, Object.assign({ _v: SETTINGS_SCHEMA }, this.settings));
  }

  _saveHistory() {
    writeJson(this.historyFile, this.history);
  }
}

module.exports = { Store, readJson, writeJson };
