'use strict';
// Скрытое окно рекордера: получает настройки от главного процесса, пишет и отдаёт куски на диск.
(function () {
  const api = window.recApi;
  let core = null;
  const D = {
    document,
    getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    AudioContext: window.AudioContext, MediaRecorder: window.MediaRecorder, MediaStream: window.MediaStream,
    send: (ch, data) => api.send(ch, data),
    now: () => performance.now()
  };
  api.onCommand(async (cmd, payload) => {
    try {
      if (cmd === 'start') {
        core = window.RecorderCore.createRecorder(D);
        const info = await core.start(payload);
        api.send('started', info);
      } else if (core && cmd === 'pause') api.send('paused', { ok: core.pause() });
      else if (core && cmd === 'resume') api.send('resumed', { ok: core.resume() });
      else if (core && cmd === 'stop') await core.stop();
    } catch (e) {
      api.send('error', { message: String(e && e.message || e), name: e && e.name });
    }
  });
  api.send('ready', {});
})();
