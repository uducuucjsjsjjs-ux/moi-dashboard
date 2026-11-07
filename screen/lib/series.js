'use strict';
// Серия снимков для лабораторной: имена «ЛР5_шаг3», сквозная нумерация рисунков, подписи «Рисунок N — …».
// Рядом с файлами лежит series.json — его читает «Отчётник». Модуль не зависит от Electron.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./store');
const { sanitize, applyTemplate, stepBase, captionFor } = require('../renderer/shared');

const MANIFEST = 'series.json';
const KIND = 'moi-screenshot-series';
const SCHEMA = 1;

// Папка серии: <корень>\[<дисциплина>\]<ПРИСТАВКА><НОМЕР>
function seriesDir(root, discipline, prefix, lab) {
  const parts = [root];
  const d = sanitize(discipline);
  if (d) parts.push(d);
  parts.push(sanitize(String(prefix || '') + String(lab || '')));
  return path.join(...parts);
}

function newManifest(o) {
  const now = new Date().toISOString();
  return {
    app: 'MoiScreenshot', kind: KIND, schema: SCHEMA,
    prefix: String(o.prefix || ''), lab: String(o.lab || '').trim(), discipline: String(o.discipline || '').trim(),
    startFigure: Math.max(1, Math.min(999, parseInt(o.startFigure, 10) || 1)),
    nameTemplate: o.nameTemplate, captionTemplate: o.captionTemplate,
    createdAt: now, updatedAt: now, steps: []
  };
}

// Номера рисунков идут сквозно по порядку шагов; подписи пересчитываются
function withComputed(m) {
  m.steps.forEach((s, i) => {
    s.figure = m.startFigure + i;
    s.caption = captionFor(m.captionTemplate, s.figure, s.text);
  });
  return m;
}

const nextStepNumber = (m) => m.steps.reduce((a, s) => Math.max(a, s.step), 0) + 1;
const nextFigure = (m) => m.startFigure + m.steps.length;

function addStep(m, { file, createdAt }) {
  const st = { step: nextStepNumber(m), file: path.basename(file), text: '', createdAt: createdAt || new Date().toISOString() };
  m.steps.push(st);
  withComputed(m);
  return st;
}

function setText(m, step, text) {
  const st = m.steps.find((s) => s.step === step);
  if (!st) return null;
  st.text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 300);
  withComputed(m);
  return st;
}

function removeStep(m, step) {
  const i = m.steps.findIndex((s) => s.step === step);
  if (i < 0) return null;
  const [st] = m.steps.splice(i, 1);
  withComputed(m);
  return st;
}

function validate(m) {
  if (!m || typeof m !== 'object' || m.kind !== KIND || !Array.isArray(m.steps)) return null;
  m.startFigure = Math.max(1, parseInt(m.startFigure, 10) || 1);
  m.steps = m.steps
    .filter((s) => s && Number.isInteger(s.step) && typeof s.file === 'string')
    // имя файла берём без путей: манифест не должен вести за пределы своей папки
    .map((s) => ({ step: s.step, file: path.basename(s.file), text: String(s.text || ''), createdAt: s.createdAt || '' }));
  m.prefix = String(m.prefix || '');
  m.lab = String(m.lab || '');
  m.discipline = String(m.discipline || '');
  if (!m.nameTemplate) m.nameTemplate = '{prefix}{lab}_шаг{step}';
  if (!m.captionTemplate) m.captionTemplate = 'Рисунок {n} — {text}';
  return withComputed(m);
}

function loadManifest(folder) {
  return validate(readJson(path.join(folder, MANIFEST), null));
}

function saveManifest(folder, m) {
  m.updatedAt = new Date().toISOString();
  withComputed(m);
  writeJson(path.join(folder, MANIFEST), m);
}

function titleOf(m) {
  return (m.prefix + m.lab) + (m.discipline ? ' · ' + m.discipline : '');
}

// Состояние: какая серия активна и недавние. Лежит в папке данных.
class SeriesState {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'series-state.json');
    const s = readJson(this.file, {});
    this.active = typeof s.active === 'string' ? s.active : null;
    this.recent = Array.isArray(s.recent) ? s.recent.filter((x) => typeof x === 'string').slice(0, 12) : [];
  }
  _save() { writeJson(this.file, { active: this.active, recent: this.recent }); }
  activate(folder) {
    this.active = folder;
    this.recent = [folder, ...this.recent.filter((x) => x !== folder)].slice(0, 12);
    this._save();
  }
  deactivate() { this.active = null; this._save(); }
  forget(folder) {
    this.recent = this.recent.filter((x) => x !== folder);
    if (this.active === folder) this.active = null;
    this._save();
  }
  // Недавние серии, которые ещё существуют на диске
  listRecent() {
    const out = [];
    for (const f of this.recent) {
      const m = fs.existsSync(path.join(f, MANIFEST)) ? loadManifest(f) : null;
      if (m) out.push({ folder: f, title: titleOf(m), steps: m.steps.length });
    }
    return out;
  }
}

module.exports = {
  MANIFEST, KIND, SCHEMA, sanitize, applyTemplate, stepBase, captionFor, seriesDir, newManifest, withComputed,
  nextStepNumber, nextFigure, addStep, setText, removeStep, validate, loadManifest, saveManifest, titleOf, SeriesState
};
