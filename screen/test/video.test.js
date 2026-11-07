'use strict';
// Проверка видеомодели и экспорта: чистая логика + настоящий ffmpeg на синтетических роликах.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const V = require('../renderer/video-core');
const { buildExport, atempoChain } = require('../lib/video-export');
const ff = require('../lib/ffmpeg');

const results = []; let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ok  ' + name); }
  catch (e) { results.push('FAIL  ' + name + '\n        ' + (e && e.stack || e)); process.exitCode = 1; }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-test-'));
const mk = (name, src, dur, extra) => V.makeClip(Object.assign({ src, dur, w: 320, h: 240, fps: 15, hasAudio: true, name }, extra || {}));
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

(async () => {
  // ----- модель -----
  await test('модель: длительность с учётом скорости, locate, starts', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a.mp4', 10)); V.addClip(p, mk('b', 'b.mp4', 6));
    V.setSpeed(p, 1, 2);
    assert.ok(near(V.total(p), 13, 1e-6));
    assert.deepStrictEqual(V.starts(p), [0, 10]);
    const l = V.locate(p, 11); assert.strictEqual(l.index, 1); assert.ok(near(l.srcTime, 2));
    assert.strictEqual(V.locate(p, 999).index, 1);
    assert.strictEqual(V.locate(V.newProject(), 1), null);
  });
  await test('модель: разрезание, границы, удаление куска', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a.mp4', 10));
    assert.strictEqual(V.splitAt(p, 0.02), -1);
    assert.strictEqual(V.splitAt(p, 9.98), -1);
    assert.strictEqual(V.splitAt(p, 4), 1);
    assert.deepStrictEqual(p.clips.map((c) => [c.inT, c.outT]), [[0, 4], [4, 10]]);
    assert.ok(near(V.total(p), 10, 1e-6));
    V.removeClip(p, 0);
    assert.deepStrictEqual(p.clips.map((c) => [c.inT, c.outT]), [[4, 10]]);
  });
  await test('модель: вырезание середины, наложения сдвигаются', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a.mp4', 20));
    const late = V.addOverlay(p, 'text', 15, {}); const mid = V.addOverlay(p, 'blur', 6, {}); const early = V.addOverlay(p, 'arrow', 1, {});
    assert.ok(V.cutRange(p, 5, 10));
    assert.ok(near(V.total(p), 15, 1e-6));
    assert.strictEqual(p.clips.length, 2);
    const byId = (id) => p.overlays.find((o) => o.id === id);
    assert.ok(near(byId(late.id).start, 10) && near(byId(late.id).end, 13));
    assert.ok(byId(early.id).start === 1 && byId(early.id).end === 4 || byId(early.id).end <= 5);
    const m = byId(mid.id);
    assert.ok(!m || (m.end - m.start >= V.MIN_OVERLAY), 'наложение внутри вырезанного участка схлопнулось или сократилось');
    assert.strictEqual(V.cutRange(p, 3, 3.01), false);
  });
  await test('модель: обрезка начала и конца, минимальная длина, скорость и громкость', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a.mp4', 10));
    V.trimClip(p, 0, { inT: 2 }); V.trimClip(p, 0, { outT: 8 });
    assert.ok(near(V.total(p), 6, 1e-6));
    V.trimClip(p, 0, { inT: 7.99 }); assert.ok(V.clipDur(p.clips[0]) >= V.MIN_CLIP - 1e-9);
    V.trimClip(p, 0, { inT: -5, outT: 99 }); assert.deepStrictEqual([p.clips[0].inT, p.clips[0].outT], [0, 10]);
    V.setSpeed(p, 0, 99); assert.strictEqual(p.clips[0].speed, 4); V.setSpeed(p, 0, 0.01); assert.strictEqual(p.clips[0].speed, 0.25);
    V.setVolume(p, 0, 500); assert.strictEqual(p.clips[0].volume, 200); V.setMute(p, 0, 1); assert.strictEqual(p.clips[0].mute, true);
  });
  await test('модель: порядок клипов и наложения (границы, удаление)', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a', 5)); V.addClip(p, mk('b', 'b', 5)); V.addClip(p, mk('c', 'c', 5));
    assert.ok(V.moveClip(p, 0, 1)); assert.deepStrictEqual(p.clips.map((c) => c.name), ['b', 'a', 'c']);
    assert.strictEqual(V.moveClip(p, 0, -1), false);
    const o = V.addOverlay(p, 'text', 14.5, {});
    assert.ok(o.end <= 15 && o.end - o.start >= V.MIN_OVERLAY);
    assert.strictEqual(V.addOverlay(p, 'laser', 1), null);
    V.updateOverlay(p, o.id, { size: 9, text: 'x'.repeat(500), x: 5 });
    assert.ok(o.size <= 0.3 && o.text.length === 300 && o.x <= 1.2);
    assert.ok(V.removeOverlay(p, o.id)); assert.strictEqual(V.removeOverlay(p, o.id), false);
    assert.strictEqual(V.addOverlay(V.newProject(), 'text', 0), null);
  });
  await test('модель: размер кадра — как у первого клипа, чётный, с ограничением высоты', () => {
    const p = V.newProject(); V.addClip(p, mk('a', 'a', 5, { w: 1921, h: 1081 }));
    assert.deepStrictEqual(V.frameSize(p, 0), { w: 1920, h: 1080 });
    p.clips[0].w = 1920; p.clips[0].h = 1080;
    assert.deepStrictEqual(V.frameSize(p, 720), { w: 1280, h: 720 });
    assert.deepStrictEqual(V.frameSize(V.newProject(), 0), { w: 1280, h: 720 });
  });
  await test('atempoChain: быстрые и медленные скорости раскладываются на допустимые шаги', () => {
    assert.strictEqual(atempoChain(1), 'atempo=1'); assert.strictEqual(atempoChain(2), 'atempo=2');
    assert.strictEqual(atempoChain(4), 'atempo=2,atempo=2'); assert.strictEqual(atempoChain(0.25), 'atempo=0.5,atempo=0.5');
    assert.strictEqual(atempoChain(1.5), 'atempo=1.5'); assert.strictEqual(atempoChain(3), 'atempo=2,atempo=1.5');
  });

  // ----- экспорт настоящим ffmpeg -----
  const FF = ff.findFfmpeg();
  const gen = (name, dur, w, h, audio, color) => {
    const f = path.join(tmp, name);
    const a = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color || 'blue'}:size=${w}x${h}:rate=15:duration=${dur}`];
    if (audio) a.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`, '-c:a', 'aac');
    a.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', f);
    execFileSync(FF, a);
    return f;
  };
  const A = gen('a.mp4', 4, 320, 240, true, 'blue'), B = gen('b.mp4', 3, 640, 360, true, 'green'), C = gen('c.mp4', 2, 320, 240, false, 'red');
  const probeFile = async (f) => ff.probe(f);
  const runExport = async (project, o, name) => {
    const out = path.join(tmp, name);
    const script = path.join(tmp, name + '.ffs');
    const r = buildExport(project, Object.assign({ out, scriptPath: script }, o));
    fs.writeFileSync(script, r.filter);
    await ff.run(r.args);
    return { out, r };
  };
  const frameColor = async (file, t) => {
    const png = path.join(tmp, 'fr_' + Math.random().toString(36).slice(2) + '.png');
    await ff.frame(file, png, t);
    const { execFileSync: ex } = require('child_process');
    const raw = ex('python3', ['-c', `from PIL import Image;im=Image.open(r'${png}').convert('RGB');print(*im.getpixel((int(im.width*0.5),int(im.height*0.5))))`]).toString().trim().split(' ').map(Number);
    return raw;
  };

  await test('экспорт MP4: склейка двух клипов разного размера, обрезка, скорость 2×, звук', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.addClip(p, mk('b', B, 3, { w: 640, h: 360 }));
    V.trimClip(p, 0, { inT: 1 });        // 3 с
    V.setSpeed(p, 1, 2);                 // 1.5 с
    const { out, r } = await runExport(p, { format: 'mp4', quality: 'low', fps: 15 }, 'o1.mp4');
    const i = await probeFile(out);
    assert.ok(near(i.duration, 4.5, 0.25), 'длительность ' + i.duration + ' ожидалось 4.5');
    assert.deepStrictEqual([i.width, i.height, i.hasAudio], [320, 240, true]);
    assert.ok(r.args.includes('libx264'));
    const c1 = await frameColor(out, 1), c2 = await frameColor(out, 3.8);
    assert.ok(c1[2] > 150 && c1[0] < 80, 'первый клип синий ' + c1);
    assert.ok(c2[1] > 100 && c2[0] < 80 && c2[2] < 80, 'второй клип зелёный ' + c2);
  });
  await test('экспорт: клип без звука среди клипов со звуком получает тишину, длительность сходится', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.addClip(p, mk('c', C, 2, { hasAudio: false }));
    const { out } = await runExport(p, { format: 'mp4', quality: 'low' }, 'o2.mp4');
    const i = await probeFile(out);
    assert.ok(near(i.duration, 6, 0.3) && i.hasAudio, JSON.stringify(i));
  });
  await test('экспорт: все клипы без звука или выключены — дорожки звука нет', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.setMute(p, 0, true);
    const { out, r } = await runExport(p, { format: 'mp4', quality: 'low' }, 'o3.mp4');
    assert.strictEqual(r.hasAudio, false);
    assert.strictEqual((await probeFile(out)).hasAudio, false);
  });
  await test('экспорт: громкость и скорость 0.5×/4× строятся без ошибок ffmpeg', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.setSpeed(p, 0, 4); V.setVolume(p, 0, 50);
    let r1 = await runExport(p, { format: 'mp4', quality: 'low' }, 'o4a.mp4');
    assert.ok(near((await probeFile(r1.out)).duration, 1, 0.2));
    V.setSpeed(p, 0, 0.25);
    r1 = await runExport(p, { format: 'mp4', quality: 'low' }, 'o4b.mp4');
    assert.ok(near((await probeFile(r1.out)).duration, 16, 0.5));
  });
  await test('экспорт WebM (VP9 + Opus)', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.trimClip(p, 0, { outT: 2 });
    const { out } = await runExport(p, { format: 'webm', quality: 'low', height: 240 }, 'o5.webm');
    const i = await probeFile(out);
    assert.ok(near(i.duration, 2, 0.2) && i.hasAudio, JSON.stringify(i));
  });
  await test('экспорт GIF: без звука, нужная ширина и длительность', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4)); V.trimClip(p, 0, { outT: 2 });
    const { out } = await runExport(p, { format: 'gif', gifFps: 10, gifWidth: 160 }, 'o6.gif');
    const i = await probeFile(out);
    assert.ok(i.width === 160 && i.height === 120 && !i.hasAudio && near(i.duration, 2, 0.3), JSON.stringify(i));
    assert.ok(fs.readFileSync(out).subarray(0, 3).toString() === 'GIF');
  });
  await test('экспорт: размытие области на отрезке времени (дальше цвет не меняется вне отрезка)', async () => {
    // источник с резким узором: левая половина белая, правая чёрная; размытие по центру во 2-й секунде
    const pat = path.join(tmp, 'pat.mp4');
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:size=320x240:rate=15:duration=3,drawbox=x=160:y=0:w=160:h=240:color=black:t=fill', '-pix_fmt', 'yuv420p', pat]);
    const p = V.newProject(); V.addClip(p, mk('pat', pat, 3, { hasAudio: false }));
    const o = V.addOverlay(p, 'blur', 1, { x: 0.4, y: 0.3, w: 0.2, h: 0.4, strength: 20 }); V.updateOverlay(p, o.id, { start: 1, end: 2 });
    const { out } = await runExport(p, { format: 'mp4', quality: 'high' }, 'o7.mp4');
    const grab = async (t, x) => { const png = path.join(tmp, 'p' + t + x + '.png'); await ff.frame(out, png, t); return execFileSync('python3', ['-c', `from PIL import Image;im=Image.open(r'${png}').convert('L');print(im.getpixel((${x},120)))`]).toString().trim() * 1; };
    const edgeBlur = await grab(1.5, 160), edgeClear = await grab(0.3, 160), edgeAfter = await grab(2.6, 160);
    assert.ok(edgeBlur > 40 && edgeBlur < 220, 'на границе в момент размытия серый: ' + edgeBlur);
    assert.ok(edgeClear === 0 || edgeClear > 235 || edgeClear < 20 || edgeClear > 230 ? true : true);
    assert.ok(edgeAfter < 25 || edgeAfter > 230, 'после отрезка резкая граница: ' + edgeAfter);
    assert.ok(edgeClear < 25 || edgeClear > 230, 'до отрезка резкая граница: ' + edgeClear);
  });
  await test('экспорт: PNG-наложение (текст/стрелка) в заданном отрезке', async () => {
    // красный квадрат в центре кадра как «наложение», показывается во 2-й секунде
    const ov = path.join(tmp, 'ov.png');
    execFileSync('python3', ['-c', `from PIL import Image,ImageDraw;im=Image.new('RGBA',(320,240),(0,0,0,0));ImageDraw.Draw(im).rectangle((120,80,200,160),fill=(255,0,0,255));im.save(r'${ov}')`]);
    const p = V.newProject(); V.addClip(p, mk('a', A, 4, { hasAudio: false }));
    const o = V.addOverlay(p, 'text', 1, {}); V.updateOverlay(p, o.id, { start: 1, end: 2 });
    const { out, r } = await runExport(p, { format: 'mp4', quality: 'high', overlayFiles: { [o.id]: ov } }, 'o8.mp4');
    assert.deepStrictEqual(r.overlayInputs, [ov]);
    const on = await frameColor(out, 1.5), off1 = await frameColor(out, 0.4), off2 = await frameColor(out, 3.2);
    assert.ok(on[0] > 180 && on[2] < 90, 'наложение видно в отрезке: ' + on);
    assert.ok(off1[2] > 150 && off2[2] > 150, 'вне отрезка наложения нет: ' + off1 + ' ' + off2);
  });
  await test('экспорт: пустой проект — понятная ошибка; ограничение высоты уменьшает кадр', async () => {
    assert.throws(() => buildExport(V.newProject(), { out: 'x', scriptPath: 'y' }), /empty/);
    const p = V.newProject(); V.addClip(p, mk('b', B, 3, { w: 640, h: 360 }));
    const { out } = await runExport(p, { format: 'mp4', quality: 'low', height: 180 }, 'o9.mp4');
    const i = await probeFile(out);
    assert.deepStrictEqual([i.width, i.height], [320, 180]);
  });
  await test('ffmpeg.run: прогресс и отмена', async () => {
    const p = V.newProject(); V.addClip(p, mk('a', A, 4));
    const out = path.join(tmp, 'prog.mp4'), script = path.join(tmp, 'prog.ffs');
    const r = buildExport(p, { format: 'mp4', quality: 'low', out, scriptPath: script }); fs.writeFileSync(script, r.filter);
    const seen = [];
    await ff.run(r.args, { onProgress: (s) => seen.push(s) });
    assert.ok(seen.length >= 1 && seen[seen.length - 1] > 3);
    const sig = {};
    const prom = ff.run(['-f', 'lavfi', '-i', 'testsrc=duration=60:size=1280x720:rate=30', '-c:v', 'libx264', '-preset', 'slow', path.join(tmp, 'cancel.mp4')], { signal: sig });
    setTimeout(() => sig.cancel(), 300);
    await assert.rejects(prom, (e) => e.code === 'cancelled');
  });

  console.log(results.join('\n'));
  console.log('\nПройдено: ' + passed + ' из ' + results.length);
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
