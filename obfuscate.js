/**
 * obfuscate.js — запускается перед electron-builder
 * Копирует проект в dist-obf/ с обфусцированными JS файлами
 * Запуск с --restore удаляет dist-obf/
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Restore mode: clean up dist-obf ───────────────────────────────────────
if (process.argv.includes('--restore')) {
  if (fs.existsSync('dist-obf')) {
    fs.rmSync('dist-obf', { recursive: true, force: true });
    console.log('[obfuscate] dist-obf cleaned up');
  }
  process.exit(0);
}

// ── Check javascript-obfuscator is available ──────────────────────────────
let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
  console.error('[obfuscate] javascript-obfuscator not found — run npm install first');
  process.exit(1);
}

const SRC  = __dirname;
const DEST = path.join(__dirname, 'dist-obf');

// Files/folders to copy as-is (no obfuscation)
const COPY_AS_IS = [
  'renderer/index.html',
  'renderer/license.html',
  'renderer/setup.html',
  'renderer/styles.css',
  'renderer/icon.ico',
  'renderer/icon.png',
  '.env',
  // node_modules: electron-builder picks them up from project root automatically
  // package.json is handled separately below — build section must be stripped
];

// JS files to obfuscate
const OBFUSCATE = [
  'main.js',
  'preload.js',
  'src/solana.js',
  'src/license.js',
  'src/notify.js',
  'src/keycheck.js',
  'renderer/app.js',
];

// Obfuscation options — aggressive but keeps functionality
const OBF_OPTIONS = {
  compact:                          true,
  controlFlowFlattening:            true,
  controlFlowFlatteningThreshold:   0.4,
  deadCodeInjection:                true,
  deadCodeInjectionThreshold:       0.2,
  debugProtection:                  false,
  disableConsoleOutput:             false,
  identifierNamesGenerator:         'hexadecimal',
  renameGlobals:                    false,
  rotateStringArray:                true,
  selfDefending:                    false,   // causes issues in Electron
  shuffleStringArray:               true,
  splitStrings:                     true,
  splitStringsChunkLength:          8,
  stringArray:                      true,
  stringArrayCallsTransform:        true,
  stringArrayEncoding:              ['base64'],
  stringArrayThreshold:             0.8,
  transformObjectKeys:              true,
  unicodeEscapeSequence:            false,
  // Protect critical identifiers from being renamed/mangled
  reservedNames: [
    'DISC_HUNT', 'DISC_PLACE_MARK', 'DISC_FISH', 'DISC_OCEAN',
    'EARLY_START_SEC', 'PREY_COOLDOWN', 'PLACE_WINDOW', 'HIGH_THRESHOLD',
    'PRIORITY_MICRO_LAMPORTS', 'COMPUTE_UNIT_LIMIT',
    'PROGRAM_ID', 'SEED_OCEAN', 'SEED_VAULT', 'SEED_NAME',
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const f of fs.readdirSync(src)) {
      copyRecursive(path.join(src, f), path.join(dest, f));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log('[obfuscate] Building obfuscated bundle → dist-obf/');

if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
ensureDir(DEST);

// 0. Write stripped package.json (no 'build' section — electron-builder reads it from root)
{
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  const stripped = {
    name:         pkg.name,
    version:      pkg.version,
    description:  pkg.description,
    main:         pkg.main,
    productName:  pkg.productName,
    dependencies: pkg.dependencies,
  };
  ensureDir(DEST);
  fs.writeFileSync(path.join(DEST, 'package.json'), JSON.stringify(stripped, null, 2), 'utf8');
  console.log('  [pkg]  package.json (build section stripped)');
}

// 1. Copy as-is items
for (const item of COPY_AS_IS) {
  const src  = path.join(SRC,  item);
  const dest = path.join(DEST, item);
  if (!fs.existsSync(src)) { console.warn(`  [skip] ${item} not found`); continue; }
  copyRecursive(src, dest);
  console.log(`  [copy] ${item}`);
}

// 2. Obfuscate JS files
for (const file of OBFUSCATE) {
  const src  = path.join(SRC,  file);
  const dest = path.join(DEST, file);
  if (!fs.existsSync(src)) { console.warn(`  [skip] ${file} not found`); continue; }

  const code = fs.readFileSync(src, 'utf8');
  try {
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...OBF_OPTIONS,
      sourceMap: false,
    });
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, result.getObfuscatedCode(), 'utf8');
    const origSize = Buffer.byteLength(code);
    const obfSize  = Buffer.byteLength(result.getObfuscatedCode());
    console.log(`  [obf]  ${file}  (${(origSize/1024).toFixed(1)}kb → ${(obfSize/1024).toFixed(1)}kb)`);
  } catch (e) {
    console.error(`  [ERR]  ${file}: ${e.message}`);
    // Fallback: copy as-is so build doesn't break
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

console.log('[obfuscate] Done → dist-obf/');
