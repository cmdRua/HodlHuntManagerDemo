/**
 * reset-license.js — удаляет сохранённый ключ с этого компьютера
 * Запуск: node reset-license.js
 */
'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Electron хранит userData в:
// Windows: C:\Users\<user>\AppData\Roaming\<appName>
// Пробуем оба возможных имени
const appNames = ['HodlHunt Manager', 'hodlhunt-manager', 'HodlHunt'];
let deleted = false;

for (const name of appNames) {
  const licPath = path.join(os.homedir(), 'AppData', 'Roaming', name, 'license.json');
  if (fs.existsSync(licPath)) {
    fs.unlinkSync(licPath);
    console.log(`[OK] Ключ удалён: ${licPath}`);
    deleted = true;
  }
}

if (!deleted) {
  console.log('[INFO] Файл лицензии не найден (уже удалён или не активировался)');
  // Show where to look manually
  const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
  console.log(`[INFO] Проверь папки в: ${roaming}`);
}
