'use strict';
// Общие функции для основного процесса и интерфейса (работают и в браузере, и в Node).

(function (root) {
const pad = (n, l = 2) => String(n).padStart(l, '0');
  
  // Шаблон имени файла: {yyyy} {MM} {dd} {HH} {mm} {ss} {mode} {n}
  function formatName(template, date, vars = {}) {
    const d = date instanceof Date ? date : new Date(date);
    const map = {
      yyyy: pad(d.getFullYear(), 4),
      MM: pad(d.getMonth() + 1),
      dd: pad(d.getDate()),
      HH: pad(d.getHours()),
      mm: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
      mode: vars.mode || '',
      n: vars.n != null ? String(vars.n) : ''
    };
    let out = String(template || 'Снимок_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}')
      .replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
    // запрещённые в Windows символы
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
    return out || 'screenshot';
  }

  // Перевод KeyboardEvent.code/key в ключ акселератора Electron (для настроек)
  function keyToAccelerator(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    let key = null;
    const code = e.code || '';
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
    else {
      const m = {
        PrintScreen: 'PrintScreen', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
        Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
        PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down',
        ArrowLeft: 'Left', ArrowRight: 'Right', Pause: 'Pause', ScrollLock: 'Scrolllock',
        Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
        Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/'
      };
      key = m[code] || null;
    }
    if (!key) return null; // нажат только модификатор или неподдерживаемая клавиша
    // Одиночные буквы/цифры без модификаторов как глобальные клавиши не годятся
    const single = /^[A-Z0-9]$/.test(key);
    if (single && mods.length === 0) return null;
    return [...mods, key].join('+');
  }


  // ---- имена и подписи серии для лабораторной ----
  // Windows-безопасное имя: без запрещённых символов и без точек/пробелов в конце
  function sanitize(name) {
    return String(name == null ? '' : name)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/, '')
      .trim();
  }

  function applyTemplate(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  // Имя файла шага без расширения
  function stepBase(tpl, v) {
    return sanitize(applyTemplate(tpl, { prefix: v.prefix, lab: v.lab, step: v.step })) || 'step' + v.step;
  }

  // Подпись под рисунком. Если описания нет, хвост шаблона после {text} отбрасывается: «Рисунок 3»
  function captionFor(tpl, n, text) {
    const t = String(text || '').trim();
    const i = String(tpl).indexOf('{text}');
    if (i < 0 || t) return applyTemplate(tpl, { n, text: t }).trim();
    const before = String(tpl).slice(0, i).replace(/[\s\-–—:.,;]+$/, '');
    return applyTemplate(before, { n }).trim();
  }

  const DEFAULT_HOTKEYS = {
    region: 'PrintScreen',
    screen: 'Ctrl+PrintScreen',
    window: 'Alt+PrintScreen',
    seriesStep: 'Ctrl+Shift+PrintScreen',
    recToggle: 'Ctrl+Shift+R',      // начать / остановить запись
    recPause: 'Ctrl+Shift+P',       // пауза / продолжить
    recRegion: 'Ctrl+Shift+A'       // записать выделенную область
  };

  const api = { formatName, keyToAccelerator, sanitize, applyTemplate, stepBase, captionFor, DEFAULT_HOTKEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Shared = api;
})(typeof window !== 'undefined' ? window : globalThis);
