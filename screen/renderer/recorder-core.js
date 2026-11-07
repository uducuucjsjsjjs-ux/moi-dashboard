'use strict';
// Ядро записи экрана (работает в скрытом окне рекордера). Всё, что нужно извне, передаётся через deps,
// поэтому тот же код проверяется в Chromium с подставными потоками.
// Видео: экран/окно целиком пишется напрямую, область и веб-камера — через canvas.
// Звук: система + микрофон смешиваются через Web Audio со своей громкостью.

(function (root) {
  const pickMime = (MR) => {
    for (const m of ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']) {
      if (!MR.isTypeSupported || MR.isTypeSupported(m)) return m;
    }
    return '';
  };

  function createRecorder(deps) {
    const D = deps;
    const S = { rec: null, chunks: Promise.resolve(), bytes: 0, elapsed: 0, startedAt: 0, paused: false, timer: null, tick: null,
      streams: [], ctx: null, video: null, cam: null, hasAudio: false, size: { w: 0, h: 0 }, stopping: false, stopped: null };

    const mkVideo = async (stream) => {
      const v = D.document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await new Promise((res) => { if (v.readyState >= 1 && v.videoWidth) return res(); v.onloadedmetadata = () => res(); });
      await v.play();
      return v;
    };

    async function start(cfg) {
      const fps = cfg.fps || 30;
      // 1. экран или окно (+ звук системы, если Electron отдаст «loopback»)
      const display = await D.getDisplayMedia({ video: { frameRate: { ideal: fps }, cursor: cfg.cursor === false ? 'never' : 'always' }, audio: !!cfg.sysAudio });
      S.streams.push(display);
      S.video = await mkVideo(display);
      const vw = S.video.videoWidth, vh = S.video.videoHeight;

      // 2. камера
      let camStream = null;
      if (cfg.cam) {
        try {
          camStream = await D.getUserMedia({ video: cfg.camDevice ? { deviceId: { exact: cfg.camDevice } } : true, audio: false });
          S.streams.push(camStream);
          S.cam = await mkVideo(camStream);
        } catch (e) { D.send('warn', { code: 'cam', message: String(e && e.message || e) }); S.cam = null; }
      }

      // 3. микрофон
      let micStream = null;
      if (cfg.mic) {
        try {
          micStream = await D.getUserMedia({ audio: cfg.micDevice ? { deviceId: { exact: cfg.micDevice } } : true, video: false });
          S.streams.push(micStream);
        } catch (e) { D.send('warn', { code: 'mic', message: String(e && e.message || e) }); }
      }

      // 4. видеодорожка: напрямую или через canvas
      const crop = cfg.crop || null;
      let videoTrack;
      if (!crop && !S.cam) {
        videoTrack = display.getVideoTracks()[0];
        S.size = { w: vw, h: vh };
      } else {
        const ratio = crop ? vw / Math.max(1, crop.dispW) : 1;
        const sx = crop ? Math.round(crop.x * ratio) : 0, sy = crop ? Math.round(crop.y * ratio) : 0;
        const sw = crop ? Math.max(2, Math.round(crop.w * ratio)) : vw, sh = crop ? Math.max(2, Math.round(crop.h * ratio)) : vh;
        const cw = sw - (sw % 2), ch = sh - (sh % 2);
        const cv = D.document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d');
        S.size = { w: cw, h: ch };
        const camW = Math.round(cw * (cfg.camSize || 20) / 100);
        const margin = Math.round(cw * 0.02);
        const draw = () => {
          g.drawImage(S.video, sx, sy, sw, sh, 0, 0, cw, ch);
          if (S.cam && S.cam.videoWidth) {
            const aw = S.cam.videoWidth, ah = S.cam.videoHeight;
            const circle = cfg.camShape !== 'rect';
            const dw = camW, dh = circle ? camW : Math.round(camW * ah / aw);
            const dx = (cfg.camCorner || 'br').includes('l') ? margin : cw - dw - margin;
            const dy = (cfg.camCorner || 'br').includes('t') ? margin : ch - dh - margin;
            g.save();
            if (circle) { g.beginPath(); g.arc(dx + dw / 2, dy + dh / 2, dw / 2, 0, Math.PI * 2); g.clip(); }
            const side = Math.min(aw, ah);
            if (circle) g.drawImage(S.cam, (aw - side) / 2, (ah - side) / 2, side, side, dx, dy, dw, dh);
            else g.drawImage(S.cam, 0, 0, aw, ah, dx, dy, dw, dh);
            g.restore();
            if (circle) { g.beginPath(); g.arc(dx + dw / 2, dy + dh / 2, dw / 2, 0, Math.PI * 2); g.lineWidth = Math.max(2, cw / 500); g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke(); }
          }
        };
        draw();
        S.draw = setInterval(draw, Math.round(1000 / fps));
        videoTrack = cv.captureStream(fps).getVideoTracks()[0];
      }

      // 5. звук: смешиваем систему и микрофон
      const tracks = [videoTrack];
      const sysTracks = display.getAudioTracks();
      const micTracks = micStream ? micStream.getAudioTracks() : [];
      if ((cfg.sysAudio && sysTracks.length) || micTracks.length) {
        S.ctx = new D.AudioContext();
        const dest = S.ctx.createMediaStreamDestination();
        const add = (track, gain) => {
          const src = S.ctx.createMediaStreamSource(new D.MediaStream([track]));
          const gn = S.ctx.createGain(); gn.gain.value = Math.max(0, Math.min(2, gain / 100));
          src.connect(gn); gn.connect(dest);
        };
        if (cfg.sysAudio && sysTracks.length) add(sysTracks[0], cfg.sysGain == null ? 100 : cfg.sysGain);
        if (micTracks.length) add(micTracks[0], cfg.micGain == null ? 100 : cfg.micGain);
        tracks.push(dest.stream.getAudioTracks()[0]);
        S.hasAudio = true;
      }
      if (cfg.sysAudio && !sysTracks.length) D.send('warn', { code: 'sysaudio', message: 'no system audio track' });

      // 6. запись кусками по 1 с: каждый кусок сразу уходит на диск
      const mime = pickMime(D.MediaRecorder);
      S.rec = new D.MediaRecorder(new D.MediaStream(tracks), Object.assign({ videoBitsPerSecond: cfg.bitrate || 6000000 }, S.hasAudio ? { audioBitsPerSecond: 128000 } : {}, mime ? { mimeType: mime } : {}));
      S.rec.ondataavailable = (ev) => {
        if (!ev.data || !ev.data.size) return;
        S.chunks = S.chunks.then(async () => {
          const ab = await ev.data.arrayBuffer();
          S.bytes += ab.byteLength;
          D.send('chunk', ab);
        });
      };
      display.getVideoTracks()[0].addEventListener('ended', () => { if (!S.stopping) { D.send('ended', {}); stop(); } });
      S.rec.start(1000);
      S.startedAt = D.now(); S.paused = false; S.elapsed = 0;
      S.tick = setInterval(() => D.send('tick', state()), 500);
      return { width: S.size.w, height: S.size.h, hasAudio: S.hasAudio };
    }

    function state() {
      const el = S.elapsed + (S.paused || !S.startedAt ? 0 : D.now() - S.startedAt);
      return { elapsedMs: Math.round(el), bytes: S.bytes, paused: S.paused };
    }
    function pause() {
      if (!S.rec || S.paused || S.stopping || S.rec.state !== 'recording') return false;
      S.elapsed += D.now() - S.startedAt; S.paused = true; S.rec.pause(); return true;
    }
    function resume() {
      if (!S.rec || !S.paused || S.stopping) return false;
      S.startedAt = D.now(); S.paused = false; S.rec.resume(); return true;
    }
    function stop() {
      if (S.stopped) return S.stopped;
      S.stopping = true;
      S.stopped = new Promise((resolve) => {
        const finish = async () => {
          clearInterval(S.tick); clearInterval(S.draw);
          await S.chunks;
          const st = state();
          S.streams.forEach((s) => s.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} }));
          try { if (S.ctx) await S.ctx.close(); } catch (_) {}
          const res = { elapsedMs: st.elapsedMs, bytes: S.bytes, width: S.size.w, height: S.size.h, hasAudio: S.hasAudio };
          D.send('stopped', res);
          resolve(res);
        };
        if (!S.rec || S.rec.state === 'inactive') return finish();
        S.rec.onstop = finish;
        try { S.rec.stop(); } catch (_) { finish(); }
      });
      return S.stopped;
    }
    return { start, pause, resume, stop, state };
  }

  const api = { createRecorder, pickMime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RecorderCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
