"""Проверка ядра записи в настоящем Chromium: подставные потоки экрана/камеры/микрофона, настоящий MediaRecorder,
затем настоящий ffmpeg превращает результат в MP4/WebM. Запуск: python3 test/rec_test.py"""
import base64, json, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.environ.get('FFMPEG_PATH', 'ffmpeg')
results = []

def check(name, cond, extra=''):
    results.append(bool(cond)); print(('  ok  ' if cond else 'FAIL  ') + name + ((' -> ' + str(extra)) if (extra and not cond) else ''))

def probe(path):
    p = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True)
    return p.stderr

INIT = r"""
(() => {
  window.__sent = []; window.__chunks = [];
  window.recApi = { onCommand() {}, send() {} };
  const mkScreen = (audio) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = '#123'; g.fillRect(0,0,640,360); g.fillStyle = '#fc0'; g.fillRect((n*7)%600, 100, 40, 40); g.fillStyle='#fff'; g.fillText('frame '+n++, 10, 20); }, 33);
    const st = c.captureStream(30);
    if (audio) { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach(t => st.addTrack(t)); }
    return st;
  };
  window.__gdm = 0;
  window.__deps = {
    document, AudioContext, MediaRecorder, MediaStream,
    getDisplayMedia: async (c) => { window.__gdm++; window.__lastGdm = JSON.stringify(c); return mkScreen(!!c.audio); },
    getUserMedia: async (c) => {
      if (c.video) { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; const g = cv.getContext('2d'); setInterval(() => { g.fillStyle = '#e33'; g.fillRect(0,0,320,240); g.fillStyle='#fff'; g.fillRect(100,60,120,120); }, 33); return cv.captureStream(30); }
      const ac = new AudioContext(); const o = ac.createOscillator(); o.frequency.value = 880; const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream;
    },
    send: (ch, data) => { if (ch === 'chunk') window.__chunks.push(new Uint8Array(data)); else window.__sent.push([ch, data]); },
    now: () => performance.now()
  };
})();
"""

def run_case(page, cfg, name, secs=2.6, pause=False):
    page.evaluate("window.__sent = []; window.__chunks = []")
    page.evaluate("cfg => { window.__core = RecorderCore.createRecorder(window.__deps); return window.__core.start(cfg).then(i => window.__info = i); }", cfg)
    time.sleep(secs / 2)
    if pause:
        check(name + ': пауза принимается', page.evaluate("window.__core.pause()") is True)
        st1 = page.evaluate("window.__core.state()"); time.sleep(0.8); st2 = page.evaluate("window.__core.state()")
        check(name + ': во время паузы время стоит', abs(st2['elapsedMs'] - st1['elapsedMs']) < 80 and st2['paused'], (st1, st2))
        check(name + ': продолжение принимается', page.evaluate("window.__core.resume()") is True)
    time.sleep(secs / 2)
    res = page.evaluate("window.__core.stop()")
    data = page.evaluate("window.__chunks.map(c => Array.from(c))")
    raw = b''.join(bytes(c) for c in data)
    sent = page.evaluate("window.__sent.map(x => x[0])")
    check(name + ': пришли куски и событие stopped', len(data) >= 2 and 'stopped' in sent, (len(data), sent))
    check(name + ': число байтов сходится', res['bytes'] == len(raw), (res['bytes'], len(raw)))
    return res, raw

with sync_playwright() as p:
    br = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = br.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(INIT)
    pg.goto('file://' + ROOT + '/renderer/recorder.html')
    tmp = tempfile.mkdtemp()

    # 1. весь экран + звук системы напрямую
    res, raw = run_case(pg, {'fps': 30, 'bitrate': 2000000, 'sysAudio': True, 'sysGain': 100, 'cursor': True}, 'экран+звук')
    check('экран: запрошен звук и курсор', '"audio":true' in pg.evaluate('window.__lastGdm') and '"always"' in pg.evaluate('window.__lastGdm'), pg.evaluate('window.__lastGdm'))
    check('экран: размер кадра 640x360, звук есть', (res['width'], res['height'], res['hasAudio']) == (640, 360, True), res)
    f = os.path.join(tmp, 'a.webm'); open(f, 'wb').write(raw)
    out = os.path.join(tmp, 'a.mp4')
    r = subprocess.run([FFMPEG, '-hide_banner', '-y', '-nostdin', '-loglevel', 'error', '-i', f, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out], capture_output=True, text=True)
    pr = probe(out)
    check('экран: ffmpeg собрал MP4 с видео и звуком', r.returncode == 0 and 'Video: h264' in pr and 'Audio: aac' in pr, r.stderr[-300:])
    check('экран: длительность около 2.6 с', any(f'Duration: 00:00:0{d}' in pr for d in (2, 3)), pr[:300])

    # 2. область + веб-камера + микрофон, пауза
    cfg = {'fps': 30, 'bitrate': 2000000, 'sysAudio': False, 'mic': True, 'micGain': 150, 'cam': True, 'camCorner': 'tl', 'camSize': 25, 'camShape': 'circle',
           'crop': {'x': 100, 'y': 50, 'w': 321, 'h': 201, 'dispW': 640, 'dispH': 360}}
    res, raw = run_case(pg, cfg, 'область+камера+микрофон', secs=3.0, pause=True)
    check('область: кадр обрезан до чётных 320x200', (res['width'], res['height']) == (320, 200), res)
    check('область: микрофон попал в запись', res['hasAudio'] is True)
    f2 = os.path.join(tmp, 'b.webm'); open(f2, 'wb').write(raw)
    out2 = os.path.join(tmp, 'b.webm.fixed.webm')
    subprocess.run([FFMPEG, '-hide_banner', '-y', '-nostdin', '-loglevel', 'error', '-i', f2, '-c', 'copy', out2], check=True)
    pr2 = probe(out2)
    check('область: webm пересобран с длительностью', 'Duration: 00:00:0' in pr2 and 'Video: vp8' in pr2 and 'Audio: opus' in pr2, pr2[:400])
    check('пауза: запись короче времени работы', 'Duration: 00:00:02' in pr2 or 'Duration: 00:00:01' in pr2 or 'Duration: 00:00:03' in pr2, pr2[:200])
    # кадр: в левом верхнем углу должна быть красная камера, фон — тёмно-синий
    png = os.path.join(tmp, 'f.png')
    subprocess.run([FFMPEG, '-hide_banner', '-y', '-nostdin', '-loglevel', 'error', '-ss', '1', '-i', out2, '-frames:v', '1', png], check=True)
    from PIL import Image
    im = Image.open(png).convert('RGB')
    cam_px = im.getpixel((int(320 * 0.02) + 8, int(320 * 0.02) + 40)); far = im.getpixel((300, 180))
    check('область: веб-камера нарисована в углу (красный пиксель)', cam_px[0] > 150 and cam_px[1] < 90, cam_px)
    check('область: остальное — картинка экрана', far[0] < 90 and far[2] > 30, far)

    # 3. без звука вообще
    res, raw = run_case(pg, {'fps': 15, 'bitrate': 1000000, 'sysAudio': False, 'mic': False, 'cam': False}, 'без звука', secs=1.6)
    check('без звука: hasAudio = false', res['hasAudio'] is False)
    check('за весь прогон нет ошибок страницы', not errs, errs)
    br.close()

print('\nПройдено: %d из %d' % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
