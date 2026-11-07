'use strict';
// Сборка команды ffmpeg для экспорта проекта: обрезка, склейка, скорость, звук, размытие, наложения (PNG), MP4/WebM/GIF.
// Не зависит от Electron. Длинный граф фильтров пишется в файл (-filter_complex_script), чтобы не упереться в лимит командной строки Windows.

const V = require('../renderer/video-core');

const CRF = { low: 28, medium: 23, high: 19 };
const VP9_CRF = { low: 38, medium: 33, high: 28 };
const even = (n) => { n = Math.max(2, Math.round(n)); return n - (n % 2); };
const num = (n) => String(Math.round(n * 1000) / 1000);

// atempo принимает 0.5..2 за раз: большие и малые скорости раскладываем на цепочку
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2 + 1e-9) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5 - 1e-9) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-9 || !parts.length) parts.push('atempo=' + num(s));
  return parts.join(',');
}

// o: { format, height, fps, quality, gifFps, gifWidth, scriptPath, overlayFiles: { id: 'путь.png' }, out }
function buildExport(project, o) {
  const clips = project.clips;
  if (!clips.length) throw Object.assign(new Error('empty project'), { code: 'empty' });
  const format = ['mp4', 'webm', 'gif'].includes(o.format) ? o.format : 'mp4';
  const size = V.frameSize(project, o.height || 0);
  const W = size.w, H = size.h;
  const fps = [15, 24, 30, 60].includes(o.fps) ? o.fps : 30;
  const duration = V.total(project);

  // входы: каждый исходный файл один раз
  const srcs = [];
  for (const c of clips) if (!srcs.includes(c.src)) srcs.push(c.src);
  const inputArgs = [];
  for (const s of srcs) inputArgs.push('-i', s);

  const wantAudio = format !== 'gif' && clips.some((c) => c.hasAudio && !c.mute && c.volume > 0);
  const f = [];
  clips.forEach((c, i) => {
    const k = srcs.indexOf(c.src);
    f.push(`[${k}:v]trim=start=${num(c.inT)}:end=${num(c.outT)},setpts=(PTS-STARTPTS)/${num(c.speed)},fps=${fps},` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v${i}]`);
    if (wantAudio) {
      if (c.hasAudio && !c.mute && c.volume > 0) {
        f.push(`[${k}:a]atrim=start=${num(c.inT)}:end=${num(c.outT)},asetpts=PTS-STARTPTS,${atempoChain(c.speed)},` +
          `volume=${num(c.volume / 100)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      } else {
        f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(V.clipDur(c))},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }
  });
  const cat = clips.map((_, i) => `[v${i}]` + (wantAudio ? `[a${i}]` : '')).join('');
  f.push(`${cat}concat=n=${clips.length}:v=1:a=${wantAudio ? 1 : 0}[vc]${wantAudio ? '[ac]' : ''}`);

  // наложения: размытие — фильтрами, текст и стрелки — готовыми PNG на весь кадр
  let cur = 'vc', n = 0;
  const overlayInputs = [];
  const baseIdx = srcs.length;
  const overs = project.overlays.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  for (const ov of overs) {
    const en = `enable='between(t,${num(ov.start)},${num(ov.end)})'`;
    if (ov.type === 'blur') {
      const x = Math.max(0, Math.min(W - 2, Math.round(ov.x * W))), y = Math.max(0, Math.min(H - 2, Math.round(ov.y * H)));
      const w = even(Math.min(W - x, ov.w * W)), h = even(Math.min(H - y, ov.h * H));
      if (w < 2 || h < 2) continue;
      f.push(`[${cur}]split[b${n}a][b${n}b]`);
      f.push(`[b${n}b]crop=${w}:${h}:${x}:${y},boxblur=${Math.max(1, Math.min(Math.round(ov.strength), Math.floor(Math.min(w, h) / 4)))}:2[b${n}c]`);
      f.push(`[b${n}a][b${n}c]overlay=${x}:${y}:${en}[o${n}]`);
      cur = 'o' + n; n++;
    } else if (o.overlayFiles && o.overlayFiles[ov.id]) {
      const idx = baseIdx + overlayInputs.length;
      overlayInputs.push(o.overlayFiles[ov.id]);
      f.push(`[${cur}][${idx}:v]overlay=0:0:${en}[o${n}]`);
      cur = 'o' + n; n++;
    }
  }
  const extraIn = [];
  for (const p of overlayInputs) extraIn.push('-i', p);

  // выход
  let tail, outArgs;
  if (format === 'gif') {
    const gfps = [8, 10, 12, 15, 20].includes(o.gifFps) ? o.gifFps : 12;
    const gw = even(o.gifWidth || 480);
    f.push(`[${cur}]fps=${gfps},scale=${gw}:-2:flags=lanczos,split[g0][g1]`);
    f.push('[g0]palettegen=max_colors=128[gp]');
    f.push('[g1][gp]paletteuse=dither=bayer:bayer_scale=4[vo]');
    outArgs = ['-map', '[vo]', '-an', '-loop', '0'];
  } else {
    outArgs = ['-map', `[${cur}]`];
    if (wantAudio) outArgs.push('-map', '[ac]');
    if (format === 'mp4') outArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF[o.quality] || 23), '-pix_fmt', 'yuv420p', ...(wantAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []), '-movflags', '+faststart');
    else outArgs.push('-c:v', 'libvpx-vp9', '-crf', String(VP9_CRF[o.quality] || 33), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', ...(wantAudio ? ['-c:a', 'libopus', '-b:a', '128k'] : []));
  }
  const filter = f.join(';\n');
  const args = [...inputArgs, ...extraIn, '-filter_complex_script', o.scriptPath, ...outArgs, '-t', num(duration), o.out];
  return { args, filter, duration, width: W, height: H, hasAudio: wantAudio, format, overlayInputs };
}

module.exports = { buildExport, atempoChain };
