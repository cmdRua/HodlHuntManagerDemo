# HodlHunt Manager

## Установка (один раз)

```bash
npm install
Заполни .env: RPC_URL, HUNTER_OWNER_PRIVKEY, EARLY_START_SEC
```

## Запуск для разработки

```bash
npm start                  # с терминалом
start-silent.vbs           # без терминала
```

## Сборка .exe для раздачи игрокам

```bash
npm run build
```

Что происходит автоматически:
1. `obfuscate.js` обфусцирует все JS файлы в папку `dist-obf/`
2. `electron-builder` упаковывает `dist-obf/` в `dist/HodlHunt Manager Setup.exe`
3. `obfuscate.js --restore` удаляет временную папку

**Раздавай только `dist/HodlHunt Manager Setup.exe`** — исходников там нет.

## Ярлык на рабочий стол (один раз)

Запусти `create-shortcut.bat` — появится ярлык с иконкой акулы.

## Лицензионные ключи

Ключи генерируются отдельным инструментом `keygen-tool` (только у тебя).
Без валидного ключа программа показывает экран активации и не запускается.
