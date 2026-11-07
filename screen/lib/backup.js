'use strict';
// Резервные копии настроек и истории. Не зависит от Electron.
// Имя файла: backup-ГГГГ-ММ-ДД_ЧЧ-ММ-СС_<вид>.json, вид: auto | manual | pre-restore | pre-import | pre-reset

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./store');

const KIND = 'moi-screenshot-backup';
const KEEP = 10;
const pad = (n) => String(n).padStart(2, '0');

function stamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
    pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
}

function listBackups(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter((n) => /^backup-.*\.json$/.test(n))
    .map((n) => {
      const file = path.join(dir, n);
      let st = null;
      try { st = fs.statSync(file); } catch (_) { return null; }
      const m = /^backup-(.+?)_(auto|manual|pre-[a-z]+)\.json$/.exec(n);
      return { file, name: n, kind: m ? m[2] : 'manual', mtime: st.mtimeMs, size: st.size };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
}

// Оставляем по KEEP последних копий каждого вида, лишние удаляем
function prune(dir, keep = KEEP) {
  const byKind = {};
  for (const b of listBackups(dir)) (byKind[b.kind] = byKind[b.kind] || []).push(b);
  let removed = 0;
  for (const list of Object.values(byKind)) {
    for (const b of list.slice(keep)) {
      try { fs.unlinkSync(b.file); removed++; } catch (_) {}
    }
  }
  return removed;
}

function createBackup({ store, extra, version, kind = 'manual', now = new Date() }) {
  const dir = store.backupDir;
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, 'backup-' + stamp(now) + '_' + kind + '.json');
  let i = 2;
  while (fs.existsSync(file)) file = path.join(dir, 'backup-' + stamp(now) + '-' + (i++) + '_' + kind + '.json');
  writeJson(file, {
    kind: KIND, schema: 1, app: 'MoiScreenshot', version, createdAt: now.toISOString(),
    settings: store.getSettings(), history: store.history, extra: extra || null
  });
  prune(dir);
  return file;
}

// Раз в сутки: если за последние 24 часа автокопии не было, делаем новую
function autoBackupIfDue(opts, now = new Date()) {
  const last = listBackups(opts.store.backupDir).find((b) => b.kind === 'auto');
  if (last && now.getTime() - last.mtime < 24 * 3600 * 1000) return null;
  return createBackup(Object.assign({}, opts, { kind: 'auto', now }));
}

function parseBackup(file) {
  const j = readJson(file, null);
  if (!j || j.kind !== KIND || typeof j.settings !== 'object' || !Array.isArray(j.history)) {
    const err = new Error('invalid backup');
    err.code = 'invalid';
    throw err;
  }
  return j;
}

// Файл настроек, экспортированный из программы: либо голые настройки, либо копия целиком
function parseSettingsFile(file) {
  const j = readJson(file, null);
  if (!j || typeof j !== 'object') { const e = new Error('invalid'); e.code = 'invalid'; throw e; }
  if (j.kind === KIND && j.settings) return j.settings;
  if (j.kind === 'moi-screenshot-settings' && j.settings) return j.settings;
  const e = new Error('invalid'); e.code = 'invalid'; throw e;
}

function exportSettings(store, file, version) {
  writeJson(file, { kind: 'moi-screenshot-settings', schema: 1, version, exportedAt: new Date().toISOString(), settings: store.getSettings() });
  return file;
}

module.exports = { KIND, KEEP, listBackups, prune, createBackup, autoBackupIfDue, parseBackup, parseSettingsFile, exportSettings, stamp };
