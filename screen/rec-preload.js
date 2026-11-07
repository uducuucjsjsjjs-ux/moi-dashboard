'use strict';
// Мост для скрытого окна рекордера и плавающей панели: только нужные каналы.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['ready', 'started', 'error', 'warn', 'ended', 'chunk', 'tick', 'stopped', 'paused', 'resumed', 'panel']);

contextBridge.exposeInMainWorld('recApi', {
  send: (ch, data) => { if (SEND.has(ch)) ipcRenderer.send('rec:' + ch, data); },
  onCommand: (cb) => { ipcRenderer.on('rec:cmd', (_e, cmd, payload) => cb(cmd, payload)); },
  onState: (cb) => { ipcRenderer.on('rec:state', (_e, st) => cb(st)); },
  panel: (action) => ipcRenderer.send('rec:panel', action)
});
