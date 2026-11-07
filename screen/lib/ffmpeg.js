'use strict';
// Обёртка над ffmpeg: поиск программы, запуск с прогрессом, сведения о файле, превью, конвертация записей.
// Не зависит от Electron. ffmpeg запускается только на время работы и закрывается сам.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let cached = null;

// Порядок поиска: переменная FFMPEG_PATH (для тестов), пакет ffmpeg-static (в установщике), ffmpeg из PATH
function findFfmpeg() {
  if (cached) return cached;
  const env = process.env.FFMPEG_PATH;
  if (env && fs.existsSync(env)) return (cached = env);
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
      if (fs.existsSync(p)) return (cached = p);
    }
  } catch (_) { /* пакет не установлен — пробуем PATH */ }
  return (cached = 'ffmpeg');
}
function resetCache() { cached = null; }

// Запуск ffmpeg. opts: { onProgress(sec), duration (сек, для процентов), signal: {cancel()} }
function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'].concat(args);
    let child;
    try { child = spawn(findFfmpeg(), full, { windowsHide: true }); } catch (e) { return reject(Object.assign(e, { code: 'noffmpeg' })); }
    let err = '', buf = '', cancelled = false;
    if (opts.signal) opts.signal.cancel = () => { cancelled = true; try { child.kill(); } catch (_) {} };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && opts.onProgress) opts.onProgress(Number(m[1]) / 1e6);
      }
    });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', (e) => reject(Object.assign(e, { code: e.code === 'ENOENT' ? 'noffmpeg' : e.code })));
    child.on('close', (code) => {
      if (cancelled) return reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      if (code === 0) resolve(); else reject(Object.assign(new Error(err.trim() || 'ffmpeg exit ' + code), { code: 'ffmpeg' }));
    });
  });
}

// Сведения о файле: длительность, размер кадра, есть ли звук. ffmpeg -i без выходного файла печатает их в stderr
function probe(file) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(findFfmpeg(), ['-hide_banner', '-nostdin', '-i', file], { windowsHide: true }); } catch (_) { return resolve(null); }
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(parseProbe(out)));
  });
}

function parseProbe(text) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!d && !/Stream #/.test(text)) return null;
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(text);
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(text);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    hasAudio: /Stream #[^\n]*Audio:/.test(text), hasVideo: /Stream #[^\n]*Video:/.test(text)
  };
}

// Один кадр в JPEG-превью (ширина 320)
function thumbnail(file, out, atSec) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return run(['-ss', String(Math.max(0, atSec || 0)), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out]);
}

// Кадр в полном размере (PNG)
function frame(file, out, atSec) {
  return run(['-ss', String(Math.max(0, atSec || 0)), '-i', file, '-frames:v', '1', out]);
}

const CRF = { low: 28, medium: 23, high: 19 };

// Запись из MediaRecorder (WebM без длительности) -> готовый файл. webm: быстрая «пересборка» без перекодирования.
function convertArgs(src, dst, { format = 'mp4', quality = 'medium', hasAudio = true } = {}) {
  if (format === 'webm') return ['-i', src, '-c', 'copy', dst];
  return ['-i', src,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF[quality] || 23), '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags', '+faststart', dst];
}

async function convertRecording(src, dst, opts, runOpts) {
  await run(convertArgs(src, dst, opts), runOpts);
  return dst;
}

module.exports = { findFfmpeg, resetCache, run, probe, parseProbe, thumbnail, frame, convertArgs, convertRecording, CRF };
