'use strict';
// Мост между интерфейсом и основным процессом. В интерфейс отдаём только нужные функции.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, cb) => {
  const h = (_e, ...args) => cb(...args);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  // настройки
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  chooseFolder: () => invoke('dialog:folder'),
  hotkeyStatus: () => invoke('hotkeys:status'),
  appInfo: () => invoke('app:info'),
  exportSettings: () => invoke('settings:export'),
  importSettings: () => invoke('settings:import'),
  resetSettings: () => invoke('settings:reset'),

  // резервные копии
  backupInfo: () => invoke('backup:info'),
  backupCreate: () => invoke('backup:create'),
  backupRestore: () => invoke('backup:restore'),
  backupOpenDir: () => invoke('backup:openDir'),

  // съёмка
  capture: (mode) => invoke('capture:start', mode),
  onCaptured: (cb) => on('capture:done', cb),
  onNavigate: (cb) => on('nav', cb),

  // серия для лабораторной
  seriesState: () => invoke('series:state'),
  seriesPreview: (o) => invoke('series:preview', o),
  seriesCreate: (o) => invoke('series:create', o),
  seriesOpen: (folder) => invoke('series:open', folder),
  seriesClose: () => invoke('series:close'),
  seriesStep: (mode) => invoke('series:step', mode),
  seriesRetake: (step) => invoke('series:retake', step),
  seriesCaption: (step, text) => invoke('series:caption', step, text),
  seriesRemove: (step) => invoke('series:remove', step),
  seriesThumb: (step) => invoke('series:thumb', step),
  seriesEntry: (step) => invoke('series:entry', step),
  seriesShowFile: (step) => invoke('series:showFile', step),
  onSeriesChanged: (cb) => on('series:changed', cb),

  // история и файлы
  history: () => invoke('history:list'),
  thumb: (id) => invoke('history:thumb', id),
  readImage: (id) => invoke('history:read', id),
  deleteHistory: (id) => invoke('history:delete', id),
  clearHistory: () => invoke('history:clear'),
  showInFolder: (id) => invoke('history:show', id),
  copyHistory: (id) => invoke('history:copy', id),

  // редактор
  saveEdited: (id, bytes) => invoke('editor:save', id, bytes),
  saveAs: (bytes, suggested) => invoke('file:saveAs', bytes, suggested),
  copyImage: (bytes) => invoke('clipboard:writeImage', bytes),
  copyText: (text) => invoke('clipboard:writeText', text),
  addToHistory: (bytes, mode) => invoke('history:addBytes', bytes, mode),

  // запись экрана
  recState: () => invoke('rec:state'),
  recStart: (o) => invoke('rec:start', o),
  recStop: () => invoke('rec:stop'),
  recPause: () => invoke('rec:pause'),
  recWindows: () => invoke('rec:windows'),
  recList: () => invoke('rec:list'),
  recThumb: (id) => invoke('rec:thumb', id),
  recPlay: (id) => invoke('rec:play', id),
  recShow: (id) => invoke('rec:show', id),
  recOpenFolder: () => invoke('rec:openFolder'),
  recDelete: (id) => invoke('rec:delete', id),
  recRename: (id, name) => invoke('rec:rename', id, name),
  // видеоредактор
  vidPick: () => invoke('vid:pick'),
  vidFromLibrary: (id) => invoke('vid:fromLibrary', id),
  vidExport: (payload) => invoke('vid:export', payload),
  vidFrame: (src, time) => invoke('vid:frame', src, time),
  vidCancel: () => invoke('vid:cancel'),
  onVidProgress: (cb) => on('vid:progress', cb),
  onRecState: (cb) => on('rec:state', cb),
  onRecList: (cb) => on('rec:list', cb),

  // негатив
  openImages: () => invoke('files:openImages'),
  readFile: (p) => invoke('files:read', p),
  writeFile: (p, bytes) => invoke('files:write', p, bytes),
  chooseOutFolder: () => invoke('dialog:folder'),
  readClipboardImage: () => invoke('clipboard:readImage'),
  pathForFile: (f) => {
    try { return webUtils.getPathForFile(f); } catch (_) { return ''; }
  },
  openFolder: (p) => invoke('shell:openPath', p)
});

// Для окна выбора области
contextBridge.exposeInMainWorld('overlayApi', {
  onInit: (cb) => on('overlay:init', cb),
  done: (rect) => ipcRenderer.send('overlay:done', rect),
  cancel: () => ipcRenderer.send('overlay:cancel')
});
