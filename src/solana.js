// @ts-check
'use strict';
// Fix UTF-8 output on Windows
if (process.platform === 'win32') {
  process.stdout.reconfigure?.({ encoding: 'utf8' });
  process.stderr.reconfigure?.({ encoding: 'utf8' });
  try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch(_) {}
}

const {
  Connection, PublicKey,
  TransactionInstruction, Transaction, sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const crypto = require('crypto');

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const PROGRAM_ID_STR = 'B1osUCap5eJ2iJnbRqfCQB87orhJM5EqZqPcGMbjJvXz';
const PROGRAM_ID     = new PublicKey(PROGRAM_ID_STR);

const PREY_COOLDOWN    = BigInt(7 * 24 * 60 * 60);
const PLACE_WINDOW     = BigInt(24 * 60 * 60);
const HIGH_THRESHOLD   = BigInt(3 * 60 * 60);
const MIN_MARK_COST    = BigInt(10_000_000);
const EARLY_START_SEC  = 3n;

const PRIORITY_MICRO_LAMPORTS = 1_000_000;
const COMPUTE_UNIT_LIMIT      = 80_000;

// ─────────────────────────────────────────────
//  LOGGING
// ─────────────────────────────────────────────
let _logCb = null;
function onLog(cb) { _logCb = cb; }
function log(msg, type = 'info') {
  console.log(`[${type}] ${msg}`);
  if (_logCb) _logCb(msg, type);
}

// ─────────────────────────────────────────────
//  SEEDS & PDA
// ─────────────────────────────────────────────
const SEED_OCEAN = Buffer.from('ocean');
const SEED_VAULT = Buffer.from('vault');
const SEED_NAME  = Buffer.from('fish_name');

function getOceanPda() {
  return PublicKey.findProgramAddressSync([SEED_OCEAN], PROGRAM_ID)[0];
}
function getVaultPda(oceanPk) {
  return PublicKey.findProgramAddressSync([SEED_VAULT, oceanPk.toBuffer()], PROGRAM_ID)[0];
}
function getNameRegistryPda(name) {
  // seeds.rs: [b"fish_name", sha256(name)]
  const nameHash = crypto.createHash('sha256').update(name, 'utf8').digest();
  return PublicKey.findProgramAddressSync([SEED_NAME, nameHash], PROGRAM_ID)[0];
}

// ─────────────────────────────────────────────
//  DISCRIMINATORS
// ─────────────────────────────────────────────
function sighash(name) {
  return Buffer.from(
    crypto.createHash('sha256').update(`global:${name}`).digest()
  ).slice(0, 8);
}
function accountDisc(name) {
  return Buffer.from(
    crypto.createHash('sha256').update(`account:${name}`).digest()
  ).slice(0, 8);
}

const DISC_FISH  = accountDisc('Fish');
const DISC_OCEAN = accountDisc('Ocean');
const DISC_PLACE_MARK = sighash('place_hunting_mark');
const DISC_HUNT       = sighash('hunt_fish');

// ─────────────────────────────────────────────
//  BORSH PARSER
// ─────────────────────────────────────────────
class Reader {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8()     { return this.b.readUInt8(this.o++); }
  u16()    { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u64()    { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i64()    { const v = this.b.readBigInt64LE(this.o);  this.o += 8; return v; }
  bool()   { return this.u8() !== 0; }
  pubkey() { const p = new PublicKey(this.b.slice(this.o, this.o + 32)); this.o += 32; return p; }
  str()    { const len = this.b.readUInt32LE(this.o); this.o += 4; const s = this.b.slice(this.o, this.o + len).toString('utf8'); this.o += len; return s; }
}

function parseOcean(data) {
  const r = new Reader(Buffer.from(data));
  r.o = 8;
  const admin          = r.pubkey();
  const totalFishCount = r.u64();
  const totalShares    = r.u64();
  const balanceFishes  = r.u64();
  r.u8();   // vaultBump (unused)
  r.i64();  // lastFeedingUpd (unused)
  r.u64();  // nextFishId (unused)
  const vault          = r.pubkey();
  const isStorm        = r.bool();
  const feedingPct     = r.u16();
  r.u16();  // stormBps (unused)
  r.u8();   // lastCycleMode (unused)
  r.i64();  // cycleStart (unused)
  const nextModeChange = r.i64();
  return { admin, totalFishCount, totalShares, balanceFishes, vault, isStorm, feedingPct, nextModeChange };
}

function parseFish(data) {
  const r = new Reader(Buffer.from(data));
  r.o = 8;
  const id                    = r.u64();
  const owner                 = r.pubkey();
  const share                 = r.u64();
  const name                  = r.str();
  const createdAt             = r.i64();
  const lastFedAt             = r.i64();
  const lastHuntAt            = r.i64();
  const canHuntAfter          = r.i64();
  const isProtected           = r.bool();
  const protectionEndsAt      = r.i64();
  const totalHunts = r.u64();
  r.u64();  // totalHuntIncome (unused)
  r.u64();  // receivedFromHuntValue (unused)
  r.u8();   // huntingMarksPlaced (unused)
  r.i64();  // lastMarkReset (unused)
  const markedByHunterId = r.u64();
  const markPlacedAt          = r.i64();
  const markExpiresAt         = r.i64();
  const markCost              = r.u64();
  return {
    id, owner, share, name,
    createdAt, lastFedAt, lastHuntAt, canHuntAfter,
    isProtected, protectionEndsAt,
    totalHunts,
    markedByHunterId, markExpiresAt, markCost,
  };
}

// ─────────────────────────────────────────────
//  MATH  (точное зеркало math.rs)
// ─────────────────────────────────────────────
function shareToValue(ocean, share) {
  if (ocean.totalShares === 0n) return 0n;
  return (share * ocean.balanceFishes + ocean.totalShares / 2n) / ocean.totalShares;
}

// ─────────────────────────────────────────────
//  CONNECTION
// ─────────────────────────────────────────────
let _connection = null;
function getConnection() {
  if (!_connection) _connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  return _connection;
}
// Call this when RPC_URL changes (e.g. after setup)
function resetConnection() { _connection = null; }

function analyzeActivity(fish, nowSec) {
  if (fish.share === 0n) return ['dead'];
  const tags = [];
  const hasFed    = fish.lastFedAt > fish.createdAt;
  const hasHunted = fish.totalHunts > 0n;

  if (hasHunted) tags.push('hunter');
  if (hasFed)    tags.push('fed');
  if (!hasFed && !hasHunted) {
    if ((nowSec - fish.createdAt) > PREY_COOLDOWN) tags.push('idle_dead');
    else tags.push('new');
  }
  if (fish.markedByHunterId > 0n && nowSec <= fish.markExpiresAt) tags.push('marked');
  return tags;
}

// ─────────────────────────────────────────────
//  PREY STATUS
// ─────────────────────────────────────────────
function getPreyStatus(fish, ocean, nowSec) {
  if (fish.share === 0n) return { canMark: false, reason: 'dead' };
  const tuh = (fish.lastFedAt + PREY_COOLDOWN) - nowSec;

  if (fish.isProtected && nowSec < fish.protectionEndsAt)
    return { canMark: false, reason: 'protected', timeLeft: fish.protectionEndsAt - nowSec };

  if (tuh <= 0n)
    return { canMark: false, hungry: true, reason: 'hungry', tuh };

  if (tuh > PLACE_WINDOW)
    return { canMark: false, reason: 'early', tuh, waitSec: tuh - PLACE_WINDOW };

  if (fish.markedByHunterId > 0n && nowSec <= fish.markExpiresAt)
    return { canMark: false, reason: 'marked', expiresIn: fish.markExpiresAt - nowSec };

  const preyValue   = shareToValue(ocean, fish.share);
  const costPct     = tuh <= HIGH_THRESHOLD ? 100n : 50n;
  const raw         = preyValue * costPct / 1000n;
  const markCost    = raw < MIN_MARK_COST ? MIN_MARK_COST : raw;

  return {
    canMark: true,
    tuh,
    markCost,
    urgency: tuh <= HIGH_THRESHOLD ? 'HIGH' : 'NORMAL',
  };
}

// ─────────────────────────────────────────────
//  SCAN OCEAN
// ─────────────────────────────────────────────
async function scanOcean() {
  const connection = getConnection();
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  log('Загружаем Ocean...', 'info');
  const oceanPk   = getOceanPda();
  const oceanInfo = await connection.getAccountInfo(oceanPk);
  if (!oceanInfo) throw new Error('Ocean аккаунт не найден');
  const ocean = parseOcean(oceanInfo.data);

  log(`Сканируем Fish-аккаунты...`, 'info');
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: DISC_FISH.toString('base64'), encoding: 'base64' } }],
    commitment: 'confirmed',
  });

  log(`Найдено ${accounts.length} Fish-аккаунтов`, 'info');

  const fishes = [];
  for (const { pubkey, account } of accounts) {
    try {
      const fish       = parseFish(account.data);
      const value      = shareToValue(ocean, fish.share);
      const preyStatus = getPreyStatus(fish, ocean, nowSec);
      const activity   = analyzeActivity(fish, nowSec);
      fishes.push({
        pubkey:    pubkey.toBase58(),
        ownerStr:  fish.owner.toBase58(),
        id:        fish.id.toString(),
        name:      fish.name,
        share:     fish.share.toString(),
        valueLamp: value.toString(),
        valueSol:  (Number(value) / 1e9).toFixed(6),
        lastFedAt:        Number(fish.lastFedAt),
        createdAt:        Number(fish.createdAt),
        totalHunts:       fish.totalHunts.toString(),
        markedByHunterId: fish.markedByHunterId.toString(),
        markExpiresAt:    Number(fish.markExpiresAt),
        isProtected:      fish.isProtected,
        protectionEndsAt: Number(fish.protectionEndsAt),
        alive:            fish.share > 0n,
        preyStatus: {
          canMark:  preyStatus.canMark,
          hungry:   preyStatus.hungry || false,
          reason:   preyStatus.reason || '',
          urgency:  preyStatus.urgency || '',
          tuh:      preyStatus.tuh   ? preyStatus.tuh.toString()   : '0',
          waitSec:  preyStatus.waitSec ? preyStatus.waitSec.toString() : '0',
          markCost: preyStatus.markCost ? preyStatus.markCost.toString() : '0',
          expiresIn: preyStatus.expiresIn ? preyStatus.expiresIn.toString() : '0',
        },
        activity,
      });
    } catch (e) {
      console.warn('Ошибка парсинга', pubkey.toBase58(), e.message);
    }
  }

  // Build id->name map for hunter name lookup on marks
  const idToName = {};
  for (const f of fishes) idToName[f.id] = f.name;
  for (const f of fishes) {
    f.markedByHunterName = idToName[f.markedByHunterId] || null;
  }

  // Build owner->activity map for wallet activity column
  const ownerActivity = {};
  for (const f of fishes) {
    const o = f.ownerStr;
    if (!ownerActivity[o]) ownerActivity[o] = { hunter: false, fed: false, new: false, idle_dead: false };
    if (f.activity.includes('hunter'))    ownerActivity[o].hunter    = true;
    if (f.activity.includes('fed'))       ownerActivity[o].fed       = true;
    if (f.activity.includes('new'))       ownerActivity[o].new       = true;
    if (f.activity.includes('idle_dead')) ownerActivity[o].idle_dead = true;
  }
  for (const f of fishes) {
    const o = ownerActivity[f.ownerStr];
    f.walletActivity = [
      o.hunter    ? 'hunter'    : null,
      o.fed       ? 'fed'       : null,
      o.new       ? 'new'       : null,
      o.idle_dead ? 'idle_dead' : null,
    ].filter(Boolean);
  }

  return {
    ocean: {
      pubkey:       oceanPk.toBase58(),
      admin:        ocean.admin.toBase58(),
      vault:        ocean.vault.toBase58(),
      isStorm:      ocean.isStorm,
      feedingPct:   ocean.feedingPct,
      totalShares:  ocean.totalShares.toString(),
      balanceLamp:  ocean.balanceFishes.toString(),
      balanceSol:   (Number(ocean.balanceFishes) / 1e9).toFixed(4),
      totalFish:    ocean.totalFishCount.toString(),
      nextModeChange: Number(ocean.nextModeChange),
    },
    fishes,
  };
}

// ─────────────────────────────────────────────
//  FETCH SINGLE FISH
// ─────────────────────────────────────────────
async function fetchFish(pubkeyStr) {
  const connection = getConnection();
  const pk   = new PublicKey(pubkeyStr);
  const info = await connection.getAccountInfo(pk);
  if (!info) throw new Error('Fish аккаунт не найден: ' + pubkeyStr);

  const fish = parseFish(info.data);

  const oceanPk   = getOceanPda();
  const oceanInfo = await connection.getAccountInfo(oceanPk);
  const ocean     = parseOcean(oceanInfo.data);
  const value     = shareToValue(ocean, fish.share);
  const nowSec    = BigInt(Math.floor(Date.now() / 1000));

  return {
    pubkey:    pubkeyStr,
    ownerStr:  fish.owner.toBase58(),
    id:        fish.id.toString(),
    name:      fish.name,
    share:     fish.share.toString(),
    valueLamp: value.toString(),
    valueSol:  (Number(value) / 1e9).toFixed(6),
    alive:     fish.share > 0n,
    activity:  analyzeActivity(fish, nowSec),
    lastFedAt: Number(fish.lastFedAt),
    canHuntAfter: Number(fish.canHuntAfter),
    totalHunts: fish.totalHunts.toString(),
    markedByHunterId: fish.markedByHunterId.toString(),
    markExpiresAt: Number(fish.markExpiresAt),
  };
}

// ─────────────────────────────────────────────
//  PLACE HUNTING MARK
//  Accounts (contexts/place_hunting_mark.rs):
//  ocean, hunter, prey, vault, hunter_owner(signer), admin, system_program
// ─────────────────────────────────────────────

module.exports = { scanOcean, fetchFish, resetConnection, onLog };
