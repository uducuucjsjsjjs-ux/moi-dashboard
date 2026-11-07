'use strict';
// Проверка IPC видеоредактора без Electron: диалоги — заглушки, ffmpeg — настоящий. Запуск: node test/video-session.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Recordings } = require('../lib/recordings');
const { createVideoSession } = require('../lib/video-session');
const ff = require('../lib/ffmpeg');
const I18n = require('../renderer/i18n');

const results = []; let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ok  ' + name); }
  catch (e) { results.push('FAIL  ' + name + '\n        ' + (e && e.stack || e)); process.exitCode = 1; }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsess-test-'));

(async () => {
  const bin = ff.findFfmpeg();
  const mk = (n, d, aud) => { const f = path.join(tmp, n); execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=' + d + ':size=320x240:rate=15',
    ...(aud ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + d, '-c:a', 'aac'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]); return f; };
  const a = mk('a.mp4', 4, true), b = mk('b.mp4', 3, false);
  const handles = {}; const notes = []; const sent = [];
  let saveTo = null;
  const electron = { ipcMain: { handle: (ch, fn) => { handles[ch] = (...a) => fn(null, ...a); } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [a, b, path.join(tmp, 'x.txt')] }),
      showSaveDialog: async (_w, o) => (saveTo === 'cancel' ? { canceled: true } : { canceled: false, filePath: saveTo || o.defaultPath }) },
    nativeImage: {} };
  const dataDir = path.join(tmp, 'data'); fs.mkdirSync(path.join(dataDir, 'thumbs'), { recursive: true });
  const recs = new Recordings(dataDir);
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  let changed = 0;
  const vs = createVideoSession({ electron, recs, T: (k, p) => I18n.t(k, p, 'ru'), paths: { userData: dataDir, thumbDir: path.join(dataDir, 'thumbs') },
    getMainWindow: () => win, notify: (t, bd) => notes.push([t, bd]), ff, listChanged: () => { changed++; } });
  vs.register();

  let picked;
  await test('vid:pick: берёт видео, пропускает не видео, сообщает длительность и звук', async () => {
    picked = await handles['vid:pick']();
    assert.strictEqual(picked.length, 2);
    assert.ok(Math.abs(picked[0].dur - 4) < 0.2 && picked[0].hasAudio && !picked[1].hasAudio);
    assert.ok(picked[0].url.startsWith('file:'));
  });
  const proj = () => ({ clips: [{ id: 'c1', src: a, srcDur: 4, inT: 0.5, outT: 3.5, speed: 1, volume: 100, mute: false, hasAudio: true, w: 320, h: 240, fps: 15 },
    { id: 'c2', src: b, srcDur: 3, inT: 0, outT: 2, speed: 2, volume: 100, mute: false, hasAudio: false, w: 320, h: 240, fps: 15 }],
    overlays: [{ id: 'o1', type: 'blur', start: 0.5, end: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.3, strength: 8 }] });
  await test('vid:export mp4: файл создан рядом с исходником, исходник цел, запись в библиотеке', async () => {
    const before = fs.statSync(a).size;
    const r = await handles['vid:export']({ project: proj(), opts: { format: 'mp4', quality: 'low', fps: 15 }, overlayPng: {} });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(path.dirname(r.file), tmp);
    assert.ok(/_монтаж\.mp4$/.test(r.file), r.file);
    const info = await ff.probe(r.file);
    assert.ok(Math.abs(info.duration - 4) < 0.3, 'dur ' + info.duration);
    assert.strictEqual(fs.statSync(a).size, before);
    assert.strictEqual(recs.list()[0].mode, 'edit'); assert.ok(changed >= 1); assert.ok(notes.length >= 1);
    assert.ok(sent.some(([, p]) => p.state === 'running') && sent.some(([, p]) => p.state === 'done'));
  });
  await test('vid:export: не перезаписывает исходник, если выбрали его же путь', async () => {
    saveTo = a; const before = fs.statSync(a).size;
    const r = await handles['vid:export']({ project: proj(), opts: { format: 'webm', quality: 'low', fps: 15 }, overlayPng: {} });
    saveTo = null;
    assert.ok(r.ok && r.file !== a && fs.statSync(a).size === before);
  });
  await test('vid:export gif', async () => {
    const r = await handles['vid:export']({ project: proj(), opts: { format: 'gif', gifFps: 10, gifWidth: 320 }, overlayPng: {} });
    assert.ok(r.ok && /\.gif$/.test(r.file)); assert.ok(fs.statSync(r.file).size > 1000);
  });
  await test('vid:export с PNG-надписью: наложение попадает в кадр', async () => {
    // красный PNG на весь кадр 320×240 — проверим цвет пикселя в готовом кадре
    const png = path.join(tmp, 'red.png'); execFileSync(bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', png]);
    const p = proj(); p.overlays = [{ id: 'o2', type: 'text', start: 0, end: 4 }];
    const out = path.join(tmp, 'ov.mp4'); saveTo = out;
    const r = await handles['vid:export']({ project: p, opts: { format: 'mp4', quality: 'low', fps: 15 }, overlayPng: { o2: new Uint8Array(fs.readFileSync(png)) } });
    saveTo = null; assert.ok(r.ok, JSON.stringify(r));
    const raw = execFileSync(bin, ['-loglevel', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e7 });
    assert.ok(raw[0] > 200 && raw[1] < 60 && raw[2] < 60, Array.from(raw.slice(0, 3)).join(','));
  });
  await test('vid:export: чужой файл (не выбранный и не из библиотеки) отклоняется', async () => {
    const evil = path.join(tmp, 'evil.mp4'); fs.copyFileSync(a, evil);
    const p = proj(); p.clips[0].src = evil;
    const r = await handles['vid:export']({ project: p, opts: { format: 'mp4' }, overlayPng: {} });
    assert.ok(!r.ok && r.error === 'source');
    assert.strictEqual(await handles['vid:frame'](evil, 1), null);
  });
  await test('vid:export: пустой проект и отмена диалога', async () => {
    assert.strictEqual((await handles['vid:export']({ project: { clips: [], overlays: [] } })).ok, false);
    saveTo = 'cancel'; const r = await handles['vid:export']({ project: proj(), opts: { format: 'mp4' } }); saveTo = null;
    assert.strictEqual(r.error, 'cancelled');
  });
  await test('vid:export: отмена во время кодирования', async () => {
    const big = path.join(tmp, 'big.mp4');
    execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=60:size=1280x720:rate=30', '-c:v', 'libx264', '-preset', 'ultrafast', big]);
    recs.add({ id: 'big', file: big, createdAt: new Date().toISOString(), mode: 'screen', format: 'mp4', duration: 60 });
    const d = await handles['vid:fromLibrary']('big'); assert.ok(d);
    const p = { clips: [{ id: 'c', src: big, srcDur: 60, inT: 0, outT: 60, speed: 1, volume: 100, mute: false, hasAudio: false, w: 1280, h: 720, fps: 30 }], overlays: [] };
    saveTo = path.join(tmp, 'cancelled.mp4');
    const pr = handles['vid:export']({ project: p, opts: { format: 'mp4', quality: 'high', fps: 60 }, overlayPng: {} });
    setTimeout(() => handles['vid:cancel'](), 700);
    const r = await pr; saveTo = null;
    assert.strictEqual(r.error, 'cancelled');
  });
  await test('vid:frame: PNG кадра из исходника', async () => {
    const buf = await handles['vid:frame'](a, 1);
    assert.ok(buf && buf.length > 500 && buf[1] === 0x50 && buf[2] === 0x4e);
  });
  await test('vid:fromLibrary: неизвестная запись даёт null', async () => { assert.strictEqual(await handles['vid:fromLibrary']('nope'), null); });

  console.log(results.join('\n'));
  console.log('\nПройдено: ' + passed + ' из ' + results.length);
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
