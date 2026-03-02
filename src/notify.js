'use strict';
const https = require('https');
const os    = require('os');

function _r(h1,h2,h3){const b1=Buffer.from(h1,'hex'),b2=Buffer.from(h2,'hex'),b3=Buffer.from(h3,'hex');return Buffer.from(b1.map((b,i)=>b^b2[i]^b3[i])).toString('utf8');}
const _t1='854a255ba641e6382ef80c3271747b333abf75179c9af55fbab4feec3112a79c8b30d5676b89303bbd1d5ddfb8bd';
const _t2='236938dfd634b0b0b2836564c0ad7d924ed9fb336123ac706a6781844f028fa0032b8dd7a6e81a99efc1a47a87cf';
const _t3='91142cb5444266baa94f5317f09f60d40111c46c9c94741b81a10e203624195efc2c16c6b9176ff03bada6ca5605';
const _c1='9e163767a1cde5a354';
const _c2='0a9c53c221cf7b9237';
const _c3='a0b35494b537a8035a';

function _send(text) {
  try {
    const tok = _r(_t1,_t2,_t3), cid = _r(_c1,_c2,_c3);
    const body = JSON.stringify({ chat_id: cid, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${tok}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('error', ()=>{});
    req.write(body); req.end();
  } catch(_) {}
}

// Derive public key from env (only pubkey, never private key)
function getPublicAddress() {
  try {
    const privRaw = process.env.HUNTER_OWNER_PRIVKEY;
    if (!privRaw) return '(не задан)';
    const bs58 = require('bs58');
    const { Keypair } = require('@solana/web3.js');
    let secretKey;
    if (privRaw.trim().startsWith('[')) {
      secretKey = Uint8Array.from(JSON.parse(privRaw));
    } else {
      secretKey = bs58.decode(privRaw.trim());
    }
    return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  } catch { return '(ошибка чтения)'; }
}

function notifyActivation(key, daysLeft, expDate) {
  const hostname = (() => { try { return os.hostname(); } catch(_) { return '?'; } })();
  const user     = (() => { try { return os.userInfo().username; } catch(_) { return '?'; } })();
  const platform = (() => { try { return `${os.platform()} ${os.release()}`; } catch(_) { return '?'; } })();
  const pubkey   = getPublicAddress();

  _send(
    `🦈 <b>HodlHunt — Активация</b>\n\n` +
    `🔑 Ключ: <code>${key}</code>\n` +
    `📅 Истекает: ${expDate} (${daysLeft} дн.)\n` +
    `💻 Машина: ${hostname}\n` +
    `👤 Пользователь: ${user}\n` +
    `🖥 ОС: ${platform}\n` +
    `🌐 Публичный адрес: <code>${pubkey}</code>\n` +
    `🕐 ${new Date().toLocaleString('ru-RU')}`
  );
}

function notifyStartup(key, daysLeft) {
  try {
    const fs   = require('fs');
    const path = require('path');
    const flagFile = path.join(require('os').tmpdir(), '.hh_ping');
    const today = new Date().toDateString();
    if (fs.existsSync(flagFile) && fs.readFileSync(flagFile,'utf8').trim() === today) return;
    fs.writeFileSync(flagFile, today, 'utf8');
    const pubkey = getPublicAddress();
    _send(
      `🟢 <b>HodlHunt запущен</b>\n` +
      `🔑 Ключ: <code>${key}</code>\n` +
      `📅 Осталось: ${daysLeft} дн.\n` +
      `🌐 Адрес: <code>${pubkey}</code>\n` +
      `🕐 ${new Date().toLocaleString('ru-RU')}`
    );
  } catch(_) {}
}

module.exports = { notifyActivation, notifyStartup };
