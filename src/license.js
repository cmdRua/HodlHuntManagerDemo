'use strict';
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Secret split ──────────────────────────────────────────────────────────
const _p1 = '7e0e440ae0311e9e132980f0520966ad29742057defa51eaecb389222f88832c';
const _p2 = 'd77631526aa21927c350d1c8fcdbd1a0260e25a0b60d9226a979e59753069b25';
const _p3 = '590ee87672433c4b3d9af4ddd83f9e7537bb10aa2b180165b075e0d806dd936c';
const SECRET = Buffer.from(_p1,'hex').map((b,i)=>b^Buffer.from(_p2,'hex')[i]^Buffer.from(_p3,'hex')[i]).toString('hex');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fromBase32(s) {
  s = s.replace(/-/g,'').toUpperCase();
  let buffer = 0, bitsLeft = 0;
  const result = [];
  for (const c of s) {
    const val = ALPHA.indexOf(c);
    if (val < 0) return null;
    buffer = (buffer << 5) | val; bitsLeft += 5;
    if (bitsLeft >= 8) { bitsLeft -= 8; result.push((buffer >> bitsLeft) & 0xff); }
  }
  return Buffer.from(result);
}

// ── Machine ID ────────────────────────────────────────────────────────────
function getMachineId() {
  try {
    const parts = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model||'', os.userInfo().username].join('|');
    return crypto.createHash('sha256').update(parts).digest('hex').slice(0,16);
  } catch { return 'unknown'; }
}

// ── License file HMAC signature ───────────────────────────────────────────
// Signs: key|expireAt|machineId — any tampering breaks the signature
function signLicense(data) {
  const payload = `${data.key}|${data.expireAt}|${data.machineId||''}`;
  return crypto.createHmac('sha256', Buffer.from(SECRET,'hex')).update(payload).digest('hex').slice(0,32);
}

function verifyLicenseSig(data) {
  if (!data.sig) return false;
  const expected = signLicense(data);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(data.sig));
}

// ── Key validation ────────────────────────────────────────────────────────
function validateKey(raw) {
  try {
    const keyBytes = fromBase32(raw);
    if (!keyBytes || keyBytes.length !== 10) return { valid:false, reason:'Неверный формат ключа' };
    const payload  = Buffer.concat([Buffer.alloc(4,0), keyBytes.slice(0,4)]);
    const expireAt = Number(payload.readBigUInt64BE(0));
    const nowSec   = Math.floor(Date.now()/1000);
    const expectedHmac = crypto.createHmac('sha256', Buffer.from(SECRET,'hex')).update(payload).digest();
    if (!crypto.timingSafeEqual(expectedHmac.slice(0,6), keyBytes.slice(4,10)))
      return { valid:false, reason:'Ключ недействителен' };
    if (nowSec > expireAt)
      return { valid:false, reason:`Ключ истёк ${new Date(expireAt*1000).toLocaleDateString('ru-RU')}` };
    const daysLeft = Math.ceil((expireAt-nowSec)/86400);
    return { valid:true, daysLeft, expireAt, expDate: new Date(expireAt*1000).toLocaleDateString('ru-RU') };
  } catch(e) { return { valid:false, reason:'Ошибка: '+e.message }; }
}

// ── checkLicense: validates key + file signature + machine + rollback ─────
function checkLicense(saved) {
  if (!saved || !saved.key) return { valid:false, reason:'Лицензия не найдена' };

  // 1. Verify file was not tampered (expireAt, machineId protected by HMAC)
  if (!verifyLicenseSig(saved))
    return { valid:false, reason:'Файл лицензии повреждён или изменён' };

  // 2. Validate key itself
  const keyResult = validateKey(saved.key);
  if (!keyResult.valid) return keyResult;

  // 3. Machine binding
  const currentMachine = getMachineId();
  if (saved.machineId && saved.machineId !== currentMachine)
    return { valid:false, reason:'Ключ привязан к другому компьютеру' };

  // 4. Rollback protection
  const nowSec = Math.floor(Date.now()/1000);
  if (saved.lastSeen && saved.lastSeen > nowSec + 300)
    return { valid:false, reason:'Обнаружен откат системного времени' };

  return { ...keyResult, machineId: currentMachine };
}

// ── File operations ───────────────────────────────────────────────────────
function getLicensePath(app) { return path.join(app.getPath('userData'),'license.json'); }

function loadLicense(app) {
  try {
    const p = getLicensePath(app);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,'utf8'));
  } catch { return null; }
}

function saveLicense(app, key, info) {
  const nowSec = Math.floor(Date.now()/1000);
  const data = {
    key,
    expireAt:    info.expireAt,
    machineId:   getMachineId(),
    activatedAt: nowSec,
    lastSeen:    nowSec,
  };
  data.sig = signLicense(data); // sign AFTER all fields are set
  fs.writeFileSync(getLicensePath(app), JSON.stringify(data), 'utf8');
}

function touchLicense(app, saved) {
  try {
    const nowSec  = Math.floor(Date.now()/1000);
    const updated = { ...saved, lastSeen: nowSec };
    updated.sig   = signLicense(updated); // re-sign with new lastSeen
    fs.writeFileSync(getLicensePath(app), JSON.stringify(updated), 'utf8');
  } catch {}
}

function clearLicense(app) { try { fs.unlinkSync(getLicensePath(app)); } catch {} }

module.exports = { validateKey, loadLicense, checkLicense, saveLicense, touchLicense, clearLicense, getMachineId };
