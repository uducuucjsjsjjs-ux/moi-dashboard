'use strict';
// Получение изображения экрана, окна и выделенной области. Использует только встроенные средства Electron.

const path = require('path');
const { execFile } = require('child_process');
const { cropRectToImage } = require('./util');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSourcesRetry(desktopCapturer, opts) {
  let sources = await desktopCapturer.getSources(opts);
  // Иногда первый вызов возвращает пустые миниатюры — повторяем один раз
  if (!sources.length || sources.every((s) => s.thumbnail.isEmpty())) {
    await sleep(150);
    sources = await desktopCapturer.getSources(opts);
  }
  return sources;
}

// Снимок одного монитора в физических пикселях
async function grabDisplay(electron, display) {
  const { desktopCapturer, screen } = electron;
  const scale = display.scaleFactor || 1;
  const width = Math.round(display.size.width * scale);
  const height = Math.round(display.size.height * scale);
  const sources = await getSourcesRetry(desktopCapturer, { types: ['screen'], thumbnailSize: { width, height } });
  let src = sources.find((s) => String(s.display_id) === String(display.id));
  if (!src) {
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    src = sources[idx >= 0 && idx < sources.length ? idx : 0];
  }
  if (!src || src.thumbnail.isEmpty()) throw Object.assign(new Error('screen capture failed'), { code: 'screen' });
  return src.thumbnail;
}

// Описатель активного окна Windows через PowerShell (без нативных модулей)
function getForegroundHwnd() {
  const script =
    'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;' +
    'public class FgW{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}\';' +
    '[FgW]::GetForegroundWindow().ToInt64()';
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const n = String(stdout).trim();
        resolve(/^\d+$/.test(n) ? n : null);
      }
    );
  });
}

async function grabWindow(electron, hwnd, ownTitles = []) {
  const { desktopCapturer } = electron;
  const sources = await getSourcesRetry(desktopCapturer, { types: ['window'], thumbnailSize: { width: 4096, height: 4096 } });
  let src = null;
  if (hwnd) src = sources.find((s) => s.id.startsWith(`window:${hwnd}:`));
  if (!src) {
    // запасной вариант: верхнее по порядку окно, которое не наше
    src = sources.find((s) => s.name && !ownTitles.includes(s.name) && !s.thumbnail.isEmpty());
  }
  if (!src || src.thumbnail.isEmpty()) throw Object.assign(new Error('window capture failed'), { code: 'window' });
  return { image: src.thumbnail, title: src.name };
}

// Выбор области: на каждом мониторе поверх рисуется «замороженный» снимок, пользователь тянет рамку.
// Возвращает NativeImage выбранной области или null, если отменили.
function selectRegion(electron, shots, overlayHtml, preloadPath, hint, asRect) {
  const { BrowserWindow, ipcMain } = electron;
  return new Promise((resolve) => {
    const wins = [];
    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener('overlay:done', onDone);
      ipcMain.removeListener('overlay:cancel', onCancel);
      for (const w of wins) {
        try { if (!w.win.isDestroyed()) w.win.destroy(); } catch (_) {}
      }
      resolve(result);
    };

    const onDone = (event, rect) => {
      const entry = wins.find((w) => w.win.webContents === event.sender);
      if (!entry || !rect || rect.w < 2 || rect.h < 2) return finish(null);
      const size = entry.shot.image.getSize();
      const scale = size.width / entry.shot.display.bounds.width;
      const r = cropRectToImage(rect, scale, size.width, size.height);
      if (r.width < 1 || r.height < 1) return finish(null);
      if (asRect) return finish({ display: entry.shot.display, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
      finish(entry.shot.image.crop(r));
    };
    const onCancel = () => finish(null);

    ipcMain.on('overlay:done', onDone);
    ipcMain.on('overlay:cancel', onCancel);

    for (const shot of shots) {
      const b = shot.display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, show: false, resizable: false, movable: false,
        skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
        enableLargerThanScreen: true, backgroundColor: '#000000',
        webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setMenuBarVisibility(false);
      const preview = shot.image.toJPEG(90);
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('overlay:init', {
          image: preview,
          width: b.width,
          height: b.height,
          hint: hint || ''
        });
        win.setBounds(b);
        win.show();
        win.focus();
      });
      win.on('closed', () => {
        // если окно закрыто системой до выбора — считаем отменой
        if (!finished) finish(null);
      });
      win.loadFile(overlayHtml);
      wins.push({ win, shot });
    }

    // страховка: не висим дольше 2 минут
    setTimeout(() => finish(null), 120000);
  });
}

module.exports = { grabDisplay, getForegroundHwnd, grabWindow, selectRegion, sleep };
