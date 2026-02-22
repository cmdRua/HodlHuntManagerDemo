// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
const PREY_COOLDOWN     = 7 * 24 * 60 * 60;
const PLACE_WINDOW      = 24 * 60 * 60;
const ORANGE_THRESHOLD  = 24 * 60 * 60 + 30 * 60;
const HIGH_THRESHOLD    = 3 * 60 * 60;

let allFish   = [];
let filtered  = [];
let sortField = 'timer';
let sortAsc   = true;

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  setStatus('Готов. Нажми REFRESH.', 'info');
  setInterval(() => { if (filtered.length) renderRows(); }, 1000);
});

// ══════════════════════════════════════════
//  STATUS
// ══════════════════════════════════════════
function setStatus(msg, type = '') {
  const el = document.getElementById('stMsg');
  el.textContent = msg;
  el.className = type;
}

function setStatusPromo() {
  const el = document.getElementById('stMsg');
  el.className = 'ok';
  el.innerHTML = `🦈 Полная версия (метки, охота, планировщик): <a id="tgPromoLink" style="color:#ff8c00;font-weight:700;text-decoration:none;cursor:pointer;">@cmdRua</a> &nbsp;|&nbsp; 1 day — $25 &nbsp;•&nbsp; 7 day — $100`;
  document.getElementById('tgPromoLink').addEventListener('click', () => {
    window.api.openExternal('https://t.me/cmdRua');
  });
}

// ══════════════════════════════════════════
//  REFRESH / SCAN
// ══════════════════════════════════════════
async function doRefresh() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> SCANNING...';
  setStatus('Сканируем океан...', 'info');

  document.getElementById('emptyMsg').style.display  = 'none';
  document.getElementById('mainTable').style.display = 'none';

  try {
    const result = await window.api.scanOcean();
    allFish = result.fishes;

    const o = result.ocean;
    document.getElementById('oceanMode').textContent = o.mode || '—';
    document.getElementById('oceanBal').textContent  = o.balanceSol ? o.balanceSol + ' SOL' : '—';
    document.getElementById('oceanFish').textContent = allFish.length + ' рыб';
    document.getElementById('oceanDot').className    = 'ocean-dot active';

    applyFilters();
    setStatusPromo();
  } catch(e) {
    setStatus('Ошибка: ' + e.message, 'err');
    document.getElementById('emptyMsg').style.display = 'flex';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⟳ REFRESH';
  }
}

// ══════════════════════════════════════════
//  FILTERS & SORT
// ══════════════════════════════════════════
function applyFilters() {
  const q        = (document.getElementById('searchInput').value || '').toLowerCase();
  const noMark   = document.getElementById('fNoMark').checked;
  const minPrOn  = document.getElementById('fMinPriceOn').checked;
  const minPr    = parseFloat(document.getElementById('fMinPrice').value) || 0;

  filtered = allFish.filter(f => {
    if (!f.alive) return false;
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (noMark && f.markedByHunterId && f.markedByHunterId !== '0') return false;
    if (minPrOn && parseFloat(f.valueSol) < minPr) return false;
    return true;
  });

  sortBy(sortField, true);
}

function sortBy(col, keepDir = false) {
  if (!keepDir) sortAsc = (sortField === col) ? !sortAsc : true;
  sortField = col;

  const nowSec = Math.floor(Date.now() / 1000);
  filtered.sort((a, b) => {
    let va, vb;
    if (col === 'timer') {
      va = (a.lastFedAt + PREY_COOLDOWN) - nowSec;
      vb = (b.lastFedAt + PREY_COOLDOWN) - nowSec;
    } else if (col === 'value') {
      va = parseFloat(a.valueSol);
      vb = parseFloat(b.valueSol);
    } else if (col === 'name') {
      va = a.name.toLowerCase();
      vb = b.name.toLowerCase();
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    } else if (col === 'wallet') {
      va = a.ownerStr || '';
      vb = b.ownerStr || '';
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    } else { va = 0; vb = 0; }
    return sortAsc ? va - vb : vb - va;
  });

  ['name','value','timer','wallet'].forEach(c => {
    const th = document.getElementById('th-' + c);
    if (th) th.querySelector('.arr').textContent = c === col ? (sortAsc ? '↑' : '↓') : '↕';
  });

  renderRows();
}

// ══════════════════════════════════════════
//  RENDER TABLE
// ══════════════════════════════════════════
function renderRows() {
  const tbody  = document.getElementById('tbody');
  const nowSec = Math.floor(Date.now() / 1000);

  if (!filtered.length) {
    document.getElementById('mainTable').style.display = 'none';
    document.getElementById('emptyMsg').style.display  = 'flex';
    document.getElementById('emptyMsg').querySelector('div:last-child').textContent = 'Нет рыб по фильтру';
    return;
  }

  document.getElementById('mainTable').style.display = '';
  document.getElementById('emptyMsg').style.display  = 'none';

  tbody.innerHTML = filtered.map(f => {
    const tuh = (f.lastFedAt + PREY_COOLDOWN) - nowSec;
    let timerCls = '', timerTxt = '';
    if (tuh <= 0) { timerCls = 'red blink'; timerTxt = '🔴 ГОЛОДНА'; }
    else if (tuh <= HIGH_THRESHOLD) { timerCls = 'red'; timerTxt = fmtTime(tuh); }
    else if (tuh <= ORANGE_THRESHOLD) { timerCls = 'orange'; timerTxt = fmtTime(tuh); }
    else { timerCls = ''; timerTxt = fmtTimeLong(tuh); }

    const hasMarkId   = f.markedByHunterId && f.markedByHunterId !== '0';
    const markExpired = hasMarkId && Number(f.markExpiresAt) <= nowSec;
    const markActive  = hasMarkId && !markExpired;
    let markCell = '—';
    if (markActive) {
      const left = Number(f.markExpiresAt) - nowSec;
      markCell = `<span class="mark-badge">🔪 ${fmtTime(left)}</span>`;
    }
    let markExpCell = '—';
    if (markActive) {
      const left = Number(f.markExpiresAt) - nowSec;
      markExpCell = `<span class="${left < 3600 ? 'red' : ''}">${fmtTime(left)}</span>`;
    }

    const actFish   = activityIcons(f, nowSec);
    const actWallet = walletActivityIcons(f.activity || []);

    return `<tr>
      <td class="tname">${esc(f.name)}</td>
      <td>${markCell}</td>
      <td class="accent">${f.valueSol}</td>
      <td class="${timerCls}">${timerTxt}</td>
      <td>${markExpCell}</td>
      <td class="dim mono" style="font-size:9px">${shortPk(f.ownerStr || '')}</td>
      <td>${actFish}</td>
      <td>${actWallet}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
//  ACTIVITY ICONS
// ══════════════════════════════════════════
function activityIcons(f, nowSec) {
  const acts = f.activity || [];
  const icons = [];
  if (acts.includes('dead'))      icons.push('<span title="Мертва">💀</span>');
  if (acts.includes('hungry'))    icons.push('<span title="Голодна — можно охотиться">🔴</span>');
  if (acts.includes('soon'))      icons.push('<span title="Скоро голодна">🟡</span>');
  if (acts.includes('marked'))    icons.push('<span title="Помечена">🔪</span>');
  if (acts.includes('protected')) icons.push('<span title="Защищена">🛡️</span>');
  if (acts.includes('idle_dead')) icons.push('<span title="Давно не кормили">💤</span>');
  return icons.join(' ') || '—';
}

function walletActivityIcons(activity) {
  const icons = [];
  if (activity.includes('idle_dead')) icons.push('<span title="Кошелёк неактивен">💤</span>');
  if (activity.includes('active'))    icons.push('<span title="Активный кошелёк">✅</span>');
  return icons.join(' ') || '—';
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function fmtTime(sec) {
  if (sec <= 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtTimeLong(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}д ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function shortPk(pk) { return pk ? pk.slice(0,4) + '…' + pk.slice(-4) : '—'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ══════════════════════════════════════════
//  BIND EVENTS
// ══════════════════════════════════════════
function bindEvents() {
  document.getElementById('btnRefresh').addEventListener('click', doRefresh);

  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('fNoMark').addEventListener('change', applyFilters);
  document.getElementById('fMinPriceOn').addEventListener('change', e => {
    document.getElementById('fMinPrice').disabled = !e.target.checked;
    applyFilters();
  });
  document.getElementById('fMinPrice').addEventListener('input', applyFilters);

  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => sortBy(th.dataset.col));
  });

  document.getElementById('tgBannerLink').addEventListener('click', () => {
    window.api.openExternal('https://t.me/cmdRua');
  });
}
