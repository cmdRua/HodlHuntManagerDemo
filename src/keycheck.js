'use strict';
/**
 * keycheck.js — одноразовые ключи через Telegram
 *
 * Хранение: одно закреплённое сообщение в чате содержит JSON со всеми ключами.
 * Читается через getChat().pinned_message — это всегда доступно боту.
 * Обновляется через editMessageText на том же message_id.
 *
 * Кейстор: { "XXXX-XXXX-XXXX-XXXX": { status:"free"|"used", ... }, ... }
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

function _r(h1,h2,h3){const b1=Buffer.from(h1,'hex'),b2=Buffer.from(h2,'hex'),b3=Buffer.from(h3,'hex');return Buffer.from(b1.map((b,i)=>b^b2[i]^b3[i])).toString('utf8');}
const _t1='854a255ba641e6382ef80c3271747b333abf75179c9af55fbab4feec3112a79c8b30d5676b89303bbd1d5ddfb8bd';
const _t2='236938dfd634b0b0b2836564c0ad7d924ed9fb336123ac706a6781844f028fa0032b8dd7a6e81a99efc1a47a87cf';
const _t3='91142cb5444266baa94f5317f09f60d40111c46c9c94741b81a10e203624195efc2c16c6b9176ff03bada6ca5605';
const _c1='9e163767a1cde5a354';
const _c2='0a9c53c221cf7b9237';
const _c3='a0b35494b537a8035a';

function getToken()  { return _r(_t1,_t2,_t3); }
function getChatId() { return _r(_c1,_c2,_c3); }

const STORE_PREFIX = '🗄KEYS:';

// ── HTTP ──────────────────────────────────────────────────────────────────
function tgPost(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${getToken()}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout:  12000,
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('TG parse error: ' + raw.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.write(data); req.end();
  });
}

// ── Local msgId cache ─────────────────────────────────────────────────────
function getCachePath() {
  try {
    const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'HodlHunt Manager');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'keystore_id.json');
  } catch { return path.join(os.tmpdir(), 'hh_ks_id.json'); }
}
function loadCachedMsgId() {
  try { return JSON.parse(fs.readFileSync(getCachePath(), 'utf8')).msgId || null; }
  catch { return null; }
}
function saveCachedMsgId(id) {
  try { fs.writeFileSync(getCachePath(), JSON.stringify({ msgId: id }), 'utf8'); } catch {}
}

// ── Read keystore ─────────────────────────────────────────────────────────
// Strategy: read pinned message from chat (always accessible by bot)
async function readStore() {
  // Try pinned message first (most reliable)
  const chatRes = await tgPost('getChat', { chat_id: getChatId() });
  if (chatRes.ok && chatRes.result.pinned_message) {
    const text = chatRes.result.pinned_message.text || '';
    if (text.startsWith(STORE_PREFIX)) {
      const msgId = chatRes.result.pinned_message.message_id;
      saveCachedMsgId(msgId);
      try { return { store: JSON.parse(text.slice(STORE_PREFIX.length)), msgId }; }
      catch {}
    }
  }
  // No pinned message yet — empty store
  return { store: {}, msgId: null };
}

// ── Write keystore ────────────────────────────────────────────────────────
async function writeStore(store, msgId) {
  const text    = STORE_PREFIX + JSON.stringify(store);
  const chatId  = getChatId();

  if (msgId) {
    // Edit existing pinned message
    const res = await tgPost('editMessageText', { chat_id: chatId, message_id: msgId, text });
    if (res.ok) return msgId;
  }

  // Create new message and pin it
  const sendRes = await tgPost('sendMessage', { chat_id: chatId, text });
  if (!sendRes.ok) throw new Error('sendMessage failed: ' + JSON.stringify(sendRes));
  const newId = sendRes.result.message_id;

  // Pin it (so we can always find it via getChat)
  await tgPost('pinChatMessage', {
    chat_id:              chatId,
    message_id:           newId,
    disable_notification: true,
  });

  saveCachedMsgId(newId);
  return newId;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * registerKey — вызывается из кейгена при генерации ключа
 */
async function registerKey(key, daysLeft, expDate) {
  const { store, msgId } = await readStore();

  if (store[key]) throw new Error('Ключ уже зарегистрирован');

  store[key] = {
    status:    'free',
    days:      daysLeft,
    expDate,
    createdAt: new Date().toISOString(),
  };

  await writeStore(store, msgId);

  // Human-readable notification
  await tgPost('sendMessage', {
    chat_id:    getChatId(),
    text:       `🔑 <b>Новый ключ</b>\n<code>${key}</code>\n📅 ${daysLeft} дн. (до ${expDate})`,
    parse_mode: 'HTML',
  });

  return { ok: true };
}

/**
 * checkAndConsumeKey — вызывается при активации в программе
 */
async function checkAndConsumeKey(key) {
  const { store, msgId } = await readStore();

  const entry = store[key];

  if (!entry)                  return { status: 'UNKNOWN', reason: 'Ключ не найден. Обратитесь к продавцу.' };
  if (entry.status === 'used') return { status: 'USED',    reason: 'Ключ уже был активирован на другом компьютере.' };

  // Mark as used
  const hostname = (() => { try { return os.hostname(); } catch { return '?'; } })();
  const user     = (() => { try { return os.userInfo().username; } catch { return '?'; } })();

  store[key] = {
    ...entry,
    status:   'used',
    usedAt:   new Date().toISOString(),
    machine:  hostname,
    username: user,
  };

  await writeStore(store, msgId);

  // Human-readable notification
  await tgPost('sendMessage', {
    chat_id:    getChatId(),
    text:       `✅ <b>Ключ активирован</b>\n<code>${key}</code>\n💻 ${hostname} / ${user}\n🕐 ${new Date().toLocaleString('ru-RU')}`,
    parse_mode: 'HTML',
  });

  return { status: 'OK' };
}

module.exports = { registerKey, checkAndConsumeKey };
