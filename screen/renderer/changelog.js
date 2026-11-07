'use strict';
// История версий. Единственный источник: из него строится вкладка «Что нового» и файл CHANGELOG.md
// (его собирает tools/gen-changelog.js). Новые версии добавляются в начало списка.
// Пока установленная версия не вышла на ПК, все выпуски — бета (beta: true).

(function (root) {
  const CHANGELOG = [
    {
      v: '0.2.0', date: '2026-10-31', beta: true,
      ru: {
        added: [
          'Вкладка «Запись»: запись экрана целиком, окна или выбранной области (область выбирается так же, как для скриншота). Звук системы, микрофон (усиление 0–200%), веб-камера в углу кадра (круг или прямоугольник). Обратного отсчёта нет.',
          'Маленькая плавающая панель записи с таймером, паузой и «Стоп». Она не попадает в запись. Горячие клавиши: Ctrl+Shift+R — начать/остановить, Ctrl+Shift+P — пауза, Ctrl+Shift+A — запись области. Пункты записи есть и в меню трея.',
          'Настройки записи: формат MP4 или WebM, 15/30/60 кадров в секунду, качество, курсор, папка записей (по умолчанию «Скриншоты\\Записи»), лимиты по времени, размеру файла и свободному месту на диске.',
          'Библиотека записей: миниатюры, воспроизведение, показ в папке, переименование, удаление в Корзину. Записи входят в резервные копии. Если программа закрылась во время записи, недописанный файл при следующем запуске восстанавливается.',
          'Видеоредактор: добавление видео с диска или из записей, склейка, разрезание, обрезка ручками на таймлайне, вырезание куска (метки I и O, клавиша X), перемещение клипов, скорость ×0.25–×4, громкость 0–200% и «без звука», надписи, стрелки и размытие на нужное время, отмена и возврат.',
          'Экспорт видео в MP4, WebM и GIF (размер кадра, FPS, качество) и «Кадр в PNG». Исходные файлы не меняются: результат сохраняется отдельным файлом с суффиксом.',
          'В настройках появились переключатели «Анимации» и «Запоминать положение окна».'
        ],
        changed: [
          'Страница настроек оформлена как в «Карточнике»: переключатели вместо флажков, вкладки с подчёркиванием, крупные образцы цвета акцента, подсказки под пунктами.',
          'Для записи и видео в программу встроен ffmpeg (пакет ffmpeg-static). Установщик стал больше примерно на 70 МБ.',
          'Формат настроек обновлён до схемы 3. Перед переносом старый файл копируется в backups\\settings-before-migration-v2.json.'
        ],
        fixed: [],
        check: [
          'Запись экрана, окна и области: появляется файл в папке записей, видео открывается и со звуком.',
          'Звук системы и микрофон: оба слышны в записи; веб-камера в нужном углу.',
          'Панель записи не попадает в кадр, горячие клавиши работают, пауза и «Стоп» из панели и из трея.',
          'Запись поверх полноэкранной игры или окна с защитой от захвата: может получиться чёрный кадр.',
          'Видеоредактор: склейка двух записей, надпись и размытие, экспорт MP4 и GIF, скорость кодирования на твоём ПК.',
          'После сборки установщика: ffmpeg лежит в resources\\app.asar.unpacked, запись работает из установленной версии.'
        ]
      },
      en: {
        added: [
          'Record tab: record the whole screen, a window or a selected area (the area is picked the same way as for a screenshot). System sound, microphone (gain 0–200%), a webcam in a corner of the frame (circle or rectangle). There is no countdown.',
          'A small floating recording panel with a timer, pause and Stop. It is not captured in the video. Hotkeys: Ctrl+Shift+R — start/stop, Ctrl+Shift+P — pause, Ctrl+Shift+A — record an area. The tray menu has recording items too.',
          'Recording settings: MP4 or WebM, 15/30/60 FPS, quality, cursor, recordings folder (by default "Screenshots\\Recordings"), limits by time, file size and free disk space.',
          'Recordings library: thumbnails, playback, show in folder, rename, delete to the Recycle Bin. Recordings are included in backups. If the app closes during a recording, the unfinished file is recovered at the next start.',
          'Video editor: add videos from disk or from recordings, join, split, trim with handles on the timeline, cut out a part (marks I and O, key X), reorder clips, speed ×0.25–×4, volume 0–200% and mute, captions, arrows and blur for a chosen time, undo and redo.',
          'Export to MP4, WebM and GIF (frame size, FPS, quality) and "Frame to PNG". Source files are never changed: the result is saved as a separate file with a suffix.',
          'Settings got "Animations" and "Remember window position" switches.'
        ],
        changed: [
          'The settings page is styled like in "Kartochnik": switches instead of checkboxes, tabs with an underline, large accent color swatches, hints under the items.',
          'ffmpeg (the ffmpeg-static package) is built in for recording and video. The installer is about 70 MB larger.',
          'The settings format is upgraded to schema 3. Before the migration the old file is copied to backups\\settings-before-migration-v2.json.'
        ],
        fixed: [],
        check: [
          'Recording the screen, a window and an area: a file appears in the recordings folder and the video opens with sound.',
          'System sound and microphone: both are audible in the recording; the webcam is in the chosen corner.',
          'The recording panel is not in the frame, hotkeys work, pause and Stop from the panel and the tray.',
          'Recording over a full-screen game or a window with capture protection may give a black frame.',
          'Video editor: join two recordings, a caption and blur, MP4 and GIF export, encoding speed on your PC.',
          'After building the installer: ffmpeg is in resources\\app.asar.unpacked and recording works from the installed version.'
        ]
      }
    },
    {
      v: '0.1.0', date: '2026-10-26', beta: true,
      ru: {
        added: [
          'Настройки разбиты на вкладки: «Основные», «Съёмка», «Серия ЛР», «Данные», «О программе» и «Что нового».',
          'Язык интерфейса: русский и English. Переводятся окна программы, меню в трее, уведомления и подсказка при выборе области.',
          'Темы: тёмная, светлая и «как в Windows». Можно выбрать цвет акцента и масштаб интерфейса (90–150%).',
          'Звук при снимке, подпапки по дате (по месяцам или по дням) и лимит истории (100, 500 или 2000 записей).',
          'Резервные копии настроек и истории: автоматически раз в сутки при запуске (хранятся последние 10) и вручную, восстановление из копии, экспорт и импорт настроек, сброс настроек. Перед восстановлением, импортом и сбросом программа сама делает копию.',
          'Вкладка «О программе»: иконка, версия, описание, сведения о сборке и о том, что программа делает с диском, сетью и памятью.',
          'Вкладка «Что нового»: история всех версий.',
          'Серия для лабораторной: снимки получают имена вида ЛР5_шаг3, рисунки нумеруются сквозно, подписи собираются по шаблону «Рисунок N — …». Горячая клавиша на шаг (Ctrl+Shift+PrintScreen), пункт в меню трея, можно переснять или удалить шаг, исправить подпись, скопировать список подписей. Рядом со снимками лежит series.json, который читает «Отчётник».'
        ],
        changed: [
          'Оформление приведено к общему стилю приложений (тёмный фон, акцент #7c9cff), иконка нарисована заново.',
          'Нумерация версий: прежние выпуски названы бета-версиями 0.0.1 и 0.0.2.',
          'Настройки хранят номер формата. Настройки версий 0.0.x переносятся сами, старый файл остаётся в папке backups.'
        ],
        fixed: [],
        check: [
          'Горячая клавиша шага (Настройки → Серия ЛР): рядом должно быть «работает».',
          'Шаг серии при свёрнутом окне: имя файла, номер рисунка, уведомление.',
          'Смена языка и тема «как в Windows».',
          'Автозапуск после установки: Setup-версия и Portable ведут себя по-разному.'
        ]
      },
      en: {
        added: [
          'Settings are split into tabs: General, Capture, Lab series, Data, About and What\'s new.',
          'Interface language: Русский and English. Windows, the tray menu, notifications and the area-selection hint are translated.',
          'Themes: dark, light and "Follow Windows". You can pick an accent color and the interface scale (90–150%).',
          'Capture sound, date subfolders (by month or by day) and a history limit (100, 500 or 2000 entries).',
          'Backups of settings and history: automatic once a day at startup (the last 10 are kept) and manual, restore from a backup, settings export and import, settings reset. The app makes a backup itself before restoring, importing or resetting.',
          'About tab: icon, version, description, build details and what the app does with disk, network and memory.',
          'What\'s new tab: the history of all versions.',
          'Lab series: screenshots get names like ЛР5_шаг3, figures are numbered continuously, captions follow the "Figure N — …" template. A hotkey for each step (Ctrl+Shift+PrintScreen), a tray menu item, retake or delete a step, edit captions, copy the list of captions. A series.json file lies next to the screenshots for "Отчётник" to read.'
        ],
        changed: [
          'Look and feel matches the shared style of the apps (dark background, #7c9cff accent); the icon was redrawn.',
          'Version numbering: earlier releases are now called betas 0.0.1 and 0.0.2.',
          'Settings store a format number. Settings from 0.0.x are migrated automatically; the old file stays in the backups folder.'
        ],
        fixed: [],
        check: [
          'The step hotkey (Settings → Lab series): it should show "works".',
          'A series step while the window is minimized: file name, figure number, notification.',
          'Switching the language and the "Follow Windows" theme.',
          'Autostart after installing: the Setup and Portable builds behave differently.'
        ]
      }
    },
    {
      v: '0.0.2', date: '2026-10-24', beta: true,
      ru: {
        added: ['В README описана ошибка сборки «Cannot create symbolic link» и способы её обойти.'],
        changed: [],
        fixed: [
          'Сборка установщика падала на Windows с ошибкой «Cannot create symbolic link». BUILD-INSTALLER.bat теперь предупреждает об отсутствии прав администратора, удаляет недораспакованный кэш electron-builder и подсказывает, что делать.'
        ],
        check: ['Запуск BUILD-INSTALLER.bat от имени администратора или при включённом режиме разработчика.']
      },
      en: {
        added: ['The README describes the "Cannot create symbolic link" build error and how to get around it.'],
        changed: [],
        fixed: [
          'Building the installer failed on Windows with "Cannot create symbolic link". BUILD-INSTALLER.bat now warns when it is not run as administrator, removes a half-extracted electron-builder cache and tells you what to do.'
        ],
        check: ['Run BUILD-INSTALLER.bat as administrator or with Developer Mode turned on.']
      }
    },
    {
      v: '0.0.1', date: '2026-10-24', beta: true,
      note: {
        ru: 'Первая сборка. Тогда она называлась 1.0.0, теперь считается бета-версией 0.0.1.',
        en: 'The first build. It used to be called 1.0.0 and now counts as beta 0.0.1.'
      },
      ru: {
        added: [
          'Съёмка выделенной области, всего экрана и активного окна. Горячие клавиши PrintScreen, Ctrl+PrintScreen и Alt+PrintScreen.',
          'Значок в трее с меню и автозапуск вместе с Windows.',
          'После снимка: копирование в буфер, сохранение в папку, открытие редактора, уведомление, задержка.',
          'История снимков с миниатюрами; удаление отправляет файл в Корзину.',
          'Редактор: стрелка, линия, рамка, овал, карандаш, маркер, текст, нумерация, пиксели, размытие, негатив области, обрезка, отмена и возврат.',
          'Вкладка «Негатив»: полный негатив, «только яркость» и чёрно-белый режим; прозрачность сохраняется; файлы, перетаскивание, буфер и история; пакетная обработка с суффиксом _negative.',
          'Настройки: горячие клавиши, папка, формат PNG или JPG, качество, шаблон имени файла, тёмная и светлая тема.',
          'Установщик (Setup) и Portable-версия, START.bat и BUILD-INSTALLER.bat.'
        ],
        changed: [],
        fixed: ['Выбор области не завершался: браузер принимал снимок за перетаскиваемую картинку.'],
        check: []
      },
      en: {
        added: [
          'Capture of a selected area, the whole screen and the active window. Hotkeys PrintScreen, Ctrl+PrintScreen and Alt+PrintScreen.',
          'Tray icon with a menu and autostart with Windows.',
          'After a capture: copy to the clipboard, save to a folder, open the editor, a notification, a delay.',
          'Capture history with thumbnails; deleting sends the file to the Recycle Bin.',
          'Editor: arrow, line, rectangle, ellipse, pen, marker, text, numbering, pixelate, blur, area negative, crop, undo and redo.',
          'Negative tab: full negative, "lightness only" and grayscale modes; transparency is kept; files, drag and drop, clipboard and history; batch processing with the _negative suffix.',
          'Settings: hotkeys, folder, PNG or JPG format, quality, file name template, dark and light theme.',
          'Installer (Setup) and Portable build, START.bat and BUILD-INSTALLER.bat.'
        ],
        changed: [],
        fixed: ['Area selection never finished: the browser treated the screenshot as a draggable image.'],
        check: []
      }
    }
  ];

  const api = { CHANGELOG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CHANGELOG = CHANGELOG;
})(typeof window !== 'undefined' ? window : globalThis);
