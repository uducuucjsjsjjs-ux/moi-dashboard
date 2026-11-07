'use strict';
// Собирает CHANGELOG.md из renderer/changelog.js (русская версия). Запуск: npm run changelog
const fs = require('fs');
const path = require('path');
const { CHANGELOG } = require('../renderer/changelog');

const TITLES = { added: 'Добавлено', changed: 'Изменено', fixed: 'Исправлено', check: 'Что проверить' };

function build() {
  const out = ['# История версий', '', 'Пока установленная версия не вышла на ПК, все выпуски считаются бета-версиями.', ''];
  for (const e of CHANGELOG) {
    out.push('## ' + e.v + ' — ' + e.date + (e.beta ? ' (бета)' : ''), '');
    if (e.note) out.push('_' + e.note.ru + '_', '');
    for (const k of ['added', 'changed', 'fixed', 'check']) {
      const items = e.ru[k] || [];
      if (!items.length) continue;
      out.push('### ' + TITLES[k], '');
      for (const it of items) out.push('- ' + it);
      out.push('');
    }
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), build(), 'utf8');
  console.log('CHANGELOG.md обновлён');
}

module.exports = { build };
