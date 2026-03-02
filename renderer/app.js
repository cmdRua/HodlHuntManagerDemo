// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
const PREY_COOLDOWN  = 7 * 24 * 60 * 60;
const PLACE_WINDOW      = 24 * 60 * 60;
const ORANGE_THRESHOLD  = 24 * 60 * 60 + 30 * 60; // 24h 30min
const HIGH_THRESHOLD = 3  * 60 * 60;

let myFish       = JSON.parse(localStorage.getItem('myFish') || '[]');
let allFish      = [];   // from last scan
let filtered     = [];
let selectedHunter = null; // pubkey string
let selectedPrey   = null; // pubkey string
let sortField    = 'timer';
let sortAsc      = true;
let cdInterval   = null;
let earlyStart   = 5;     // seconds, loaded from config

// ══════════════════════════════════════════
//  DEMO SAFE WRAPPER — предотвращает краши при обращении к удалённым элементам
const _origGetById = document.getElementById.bind(document);
document.getElementById = function(id) {
  const el = _origGetById(id);
  if (el) return el;
  // Возвращаем заглушку чтобы не падало на .classList, .textContent, etc.
  return {
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    get textContent() { return ''; }, set textContent(_) {},
    get innerHTML() { return ''; }, set innerHTML(_) {},
    get value() { return ''; }, set value(_) {},
    get disabled() { return false; }, set disabled(_) {},
    get checked() { return false; }, set checked(_) {},
    get display() { return ''; },
    querySelectorAll: () => [],
    querySelector: () => null,
    focus: () => {}, click: () => {}, blur: () => {},
  };
};

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  // Bind all button/input event listeners (no inline onclick)
  bindEvents();

  const cfg = await window.api.getConfig();
  earlyStart = cfg.earlyStart || 5;

  // Listen to log events from main process (demo: no modals)
  window.api.onLog(({ msg, type }) => { /* demo: modals removed */ });


  updateBtns(); // ensure buttons start disabled
  initTabs();
  setupResize();
  setStatus('Готов. Нажми REFRESH.', 'info');

  // Live timer tick every second
  setInterval(() => { if (filtered.length) renderRows(); }, 1000);
});

// ══════════════════════════════════════════
//  RESIZE LEFT PANEL
// ══════════════════════════════════════════
function setupResize() {
  const handle = document.getElementById('resizeHandle');
  const panel  = document.getElementById('panelLeft');
  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(150, Math.min(320, startW + (e.clientX - startX)));
    panel.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

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
  el.innerHTML = `Разработчики сказали что скрипты и боты тут не помогут — я принял это как вызов и сделал 🦈 &nbsp;За ключами: Телеграмм <a id="tgPromoLink" style="color:#ff8c00;font-weight:700;text-decoration:none;cursor:pointer;">@cmdRua</a> &nbsp; 7 дней 30$ &nbsp; Полная версия`;
  document.getElementById('tgPromoLink').addEventListener('click', () => {
    window.api.openExternal('https://t.me/cmdRua');
  });
}

// ══════════════════════════════════════════
//  REFRESH / SCAN
// ══════════════════════════════════════════
// demo: loadWalletBalance removed

async function doRefresh() {
  // Snapshot lastFedAt of my fish before refresh
  const _fedSnapshot = {};
  for (const mf of myFish) {
    const live = allFish.find(f => f.pubkey === mf.pubkey);
    if (live) _fedSnapshot[mf.pubkey] = live.lastFedAt;
  }
  // Snapshot живых рыб до рефреша — для определения съеденных
  const _aliveSnapshot = {};
  for (const f of allFish) {
    if (f.alive) _aliveSnapshot[f.pubkey] = { name: f.name, ownerStr: f.ownerStr };
  }

  const btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> SCANNING...';
  setStatus('Сканируем океан...', 'info');

  document.getElementById('emptyMsg').style.display   = 'none';
  document.getElementById('mainTable').style.display  = 'none';

  try {
    const result = await window.api.scanOcean();
    allFish = result.fishes;

    // Update header ocean info
    const o = result.ocean;
    document.getElementById('oceanDot').className  = 'ocean-dot' + (o.isStorm ? ' storm' : '');
    document.getElementById('oceanMode').textContent  = o.isStorm ? '⛈ ШТОРМ' : '☀ СПОКОЙНО';
    document.getElementById('oceanBal').textContent   = o.balanceSol + ' SOL';
    document.getElementById('oceanFish').textContent  = o.totalFish + ' рыб';

    // Refresh my fish values
    for (const mf of myFish) {
      const found = allFish.find(f => f.pubkey === mf.pubkey);
      if (found) { mf.name = found.name; mf.valueSol = found.valueSol; mf.alive = found.alive; mf.id = found.id; }
    }
    saveMyFish();
    renderMyFish();

    // Stats (elements removed from UI, just keep the count for status)

    applyFilters();
    document.getElementById('mainTable').style.display = 'table';
    setStatusPromo();
    // Check if any of my fish got fed since last refresh
    for (const mf of myFish) {
      const live = allFish.find(f => f.pubkey === mf.pubkey);
      if (!live) continue;
      if (_fedSnapshot[mf.pubkey] !== undefined && live.lastFedAt !== _fedSnapshot[mf.pubkey]) {
        addHistory('info', `🍖 ${live.name || shortPk(mf.pubkey)} покормилась`, `lastFed обновился`);
      }
    }
    checkScheduleAfterRefresh();
    // Проверяем кто был съеден с момента последнего рефреша
    for (const pubkey of Object.keys(_aliveSnapshot)) {
      const fresh = allFish.find(f => f.pubkey === pubkey);
      // Рыба была жива, теперь мертва (share=0 или не найдена)
      if (!fresh || !fresh.alive) {
        const { name, ownerStr } = _aliveSnapshot[pubkey];
        addPreyLog(ownerStr, name);
      }
    }
  } catch (e) {
    setStatus('Ошибка: ' + e.message, 'err');
    document.getElementById('emptyMsg').style.display = 'flex';
  }

  btn.disabled = false;
  btn.innerHTML = '⟳ REFRESH';
}

// ══════════════════════════════════════════
//  FILTERS & SORT
// ══════════════════════════════════════════
function toggleMin() {
  document.getElementById('fMinPrice').disabled = !document.getElementById('fMinPriceOn').checked;
  applyFilters();
}

function applyFilters() {
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const noMarked  = document.getElementById('fNoMark').checked;
  const minOn     = document.getElementById('fMinPriceOn').checked;
  const minVal    = parseFloat(document.getElementById('fMinPrice').value) || 0;
  const nowSec    = Math.floor(Date.now() / 1000);

  filtered = allFish.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (!f.alive) return false;
    if (noMarked && f.markedByHunterId !== '0') {
      const expiresIn = f.markExpiresAt - nowSec;
      if (expiresIn > 0) return false;
    }
    if (minOn && parseFloat(f.valueSol) < minVal) return false;
    return true;
  });

  renderRows();
}

function sortBy(col) {
  if (sortField === col) sortAsc = !sortAsc;
  else { sortField = col; sortAsc = true; }
  renderRows();
}

// ══════════════════════════════════════════
//  RENDER TABLE ROWS
// ══════════════════════════════════════════
function renderRows() {
  const nowSec = Math.floor(Date.now() / 1000);
  const tbody  = document.getElementById('tbody');

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortField === 'name')   return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    if (sortField === 'value')  { av = parseFloat(a.valueSol); bv = parseFloat(b.valueSol); }
    if (sortField === 'pubkey') return sortAsc ? a.pubkey.localeCompare(b.pubkey) : b.pubkey.localeCompare(a.pubkey);
    if (sortField === 'wallet') return sortAsc ? a.ownerStr.slice(-4).localeCompare(b.ownerStr.slice(-4)) : b.ownerStr.slice(-4).localeCompare(a.ownerStr.slice(-4));
    if (sortField === 'timer')  {
      av = (a.lastFedAt + PREY_COOLDOWN) - nowSec;
      bv = (b.lastFedAt + PREY_COOLDOWN) - nowSec;
    }
    if (av === undefined) return 0;
    return sortAsc ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  });

  // Compute once — O(n) not O(n²)
  const myHunterIds = myFish.map(mf => {
    const live = allFish.find(af => af.pubkey === mf.pubkey);
    return live ? live.id : null;
  }).filter(Boolean);

  tbody.innerHTML = sorted.map(f => {
    const tuh = (f.lastFedAt + PREY_COOLDOWN) - nowSec;
    const { canMark, hungry, urgency } = f.preyStatus;

    // Timer cell
    let timerCls, timerTxt;
    if (hungry || tuh <= 0) {
      timerCls = 'hungry'; timerTxt = '🎯 ЖЕРТВА';
    } else if (tuh <= HIGH_THRESHOLD) {
      timerCls = 'urgent'; timerTxt = fmtTime(tuh);
    } else if (tuh <= PLACE_WINDOW) {
      timerCls = 'soon';   timerTxt = fmtTime(tuh);
    } else if (tuh <= ORANGE_THRESHOLD) {
      timerCls = 'orange'; timerTxt = fmtTime(tuh);
    } else {
      timerCls = 'ok';     timerTxt = fmtTimeLong(tuh);
    }

    // Row highlight
    let rowCls = '';
    if (canMark && urgency === 'HIGH')   rowCls = 'mark-high';
    if (canMark && urgency === 'NORMAL') rowCls = 'mark-normal';
    if (selectedPrey === f.pubkey) rowCls += ' sel-row';

    const icons     = activityIcons(f, nowSec);
    const walletEnd = f.ownerStr.slice(-4);

    const markCell = (f.markedByHunterId !== '0' && f.markExpiresAt > nowSec)
      ? (myHunterIds.includes(f.markedByHunterId)
          ? `<span class="mark-mine">${esc(f.markedByHunterName || '?')}</span>`
          : `<span class="mark-other">${esc(f.markedByHunterName || shortPk(f.markedByHunterId))}</span>`)
      : '';

    const walIcons = walletActivityIcons(f.walletActivity || []);

    // Mark expiry timer
    let markExpCell = '';
    if (f.markedByHunterId !== '0' && f.markExpiresAt > nowSec) {
      const secLeft = f.markExpiresAt - nowSec;
      const isMine  = myHunterIds.includes(f.markedByHunterId);
      const cls     = isMine ? (secLeft < 600 ? 'mine-urgent' : 'mine-ok') : 'other';
      markExpCell   = `<span class="td-markexp ${cls}">${fmtTime(secLeft)}</span>`;
    }

    return `<tr class="${rowCls}" data-pubkey="${f.pubkey}">
      <td class="td-name">${esc(f.name)}</td>
      <td class="td-mark">${markCell}</td>
      <td class="td-val">${f.valueSol}</td>
      <td class="td-timer ${timerCls}">${timerTxt}</td>
      <td class="td-markexp">${markExpCell}</td>
      <td class="td-wallet"><a class="wallet-link" href="https://solscan.io/account/${f.ownerStr}" target="_blank" data-ext="1">${walletEnd}</a></td>
      <td class="td-act" title="${icons.tips}">${icons.html}</td>
      <td class="td-act" title="${walIcons.tips}">${walIcons.html}</td>

    </tr>`;
  }).join('');
}

function preyLogCell(ownerStr) {
  const entry = preyLog.find(p => p.ownerStr === ownerStr);
  if (!entry) return '';
  return `<span class="prey-badge" title="Съедено рыб с этого кошелька: ${entry.count}">🍖${entry.count}</span>`;
}

// ══════════════════════════════════════════
//  HUNT NOTIFICATION (10min warning for marked prey)
// ══════════════════════════════════════════
let notifyShownFor = new Set();

function checkHuntNotifications() {
  const nowSec = Math.floor(Date.now() / 1000);
  const WARN   = 600; // 10 minutes

  const myHunterIds = myFish.map(mf => {
    const live = allFish.find(af => af.pubkey === mf.pubkey);
    return live ? live.id : null;
  }).filter(Boolean);

  for (const f of allFish) {
    if (!myHunterIds.includes(f.markedByHunterId)) continue;
    if (f.markExpiresAt <= nowSec) continue; // mark expired

    const tuh = (f.lastFedAt + PREY_COOLDOWN) - nowSec;
    if (tuh > WARN || tuh <= 0) continue; // not in warning window
    if (notifyShownFor.has(f.pubkey)) continue; // already notified

    notifyShownFor.add(f.pubkey);
    showHuntNotify(f.name, tuh);
  }

  // Clean up stale entries
  for (const pk of notifyShownFor) {
    const f = allFish.find(x => x.pubkey === pk);
    if (!f || (f.lastFedAt + PREY_COOLDOWN) - nowSec <= 0) notifyShownFor.delete(pk);
  }
}

function showHuntNotify(fishName, secLeft) {
  const el = document.getElementById('huntNotify');
  const tx = document.getElementById('huntNotifyText');
  if (!el || !tx) return;
  tx.textContent = `🦈 СКОРО ОХОТА! ${esc(fishName)} — через ${fmtTime(secLeft)}`;
  el.style.display = 'flex';
  playNotifySound();
  // Auto-hide after 30s
  setTimeout(() => { if (el) el.style.display = 'none'; }, 30000);
}

function playNotifySound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, start, dur, vol=0.18) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + start);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.1);
    };
    play(523, 0.0,  0.3);  // C5
    play(659, 0.35, 0.3);  // E5
    play(784, 0.7,  0.5);  // G5
  } catch(_) {}
}

function activityIcons(f, nowSec) {
  const icons = [], tips = [];
  if (f.totalHunts !== '0') {
    icons.push('🗡️'); tips.push(`Охотился ${f.totalHunts}x`);
  }
  if (f.activity.includes('fed')) {
    icons.push('🍖'); tips.push('Кормился');
  }
  if (f.activity.includes('new')) {
    icons.push('🐟'); tips.push('Только создан');
  }
  if (f.activity.includes('idle_dead')) {
    icons.push('💀'); tips.push('Создан >7д, ничего не делал');
  }

  return { html: icons.join(''), tips: tips.join(', ') };
}

function walletActivityIcons(activity) {
  const icons = [], tips = [];
  if (activity.includes('hunter'))    { icons.push('🗡️'); tips.push('Кошелёк охотился'); }
  if (activity.includes('fed'))       { icons.push('🍖'); tips.push('Кошелёк кормился'); }
  if (activity.includes('new'))       { icons.push('🐟'); tips.push('Есть новые рыбы'); }
  if (activity.includes('idle_dead')) { icons.push('💀'); tips.push('Есть мёртвые без активности'); }
  if (!icons.length)                  { icons.push('—'); }
  return { html: icons.join(''), tips: tips.join(', ') };
}

// ══════════════════════════════════════════
//  SELECTION
// ══════════════════════════════════════════
function selectPrey(pubkey) {
  selectedPrey = selectedPrey === pubkey ? null : pubkey;
  renderRows();
  updateBtns();
}

function selectHunter(pubkey) {
  selectedHunter = selectedHunter === pubkey ? null : pubkey;
  renderMyFish();
  updateBtns();
}

function updateBtns() { /* demo */ }

// ══════════════════════════════════════════
//  MY FISH
// ══════════════════════════════════════════
function saveMyFish() { localStorage.setItem('myFish', JSON.stringify(myFish)); }

function renderMyFish() {
  const list = document.getElementById('myList');
  document.getElementById('myCount').textContent = myFish.length;
  checkHuntNotifications();

  if (!myFish.length) {
    list.innerHTML = '<div class="hint">Добавь рыб через + ADD</div>';
    return;
  }

  const nowSecMF = Math.floor(Date.now() / 1000);
  list.innerHTML = myFish.map(mf => {
    const selCls = selectedHunter === mf.pubkey ? ' sel' : '';
    const val    = mf.valueSol ? mf.valueSol + ' SOL' : '—';
    const alive  = mf.alive === false ? ' 💀' : '';

    // Hunger timer from live data
    let hungerHtml = '';
    const liveData = allFish.find(f => f.pubkey === mf.pubkey);
    if (liveData && liveData.lastFedAt) {
      const tuh = (liveData.lastFedAt + PREY_COOLDOWN) - nowSecMF;
      if (tuh <= 0) {
        hungerHtml = `<div class="itimer hungry">🎯 ЖЕРТВА</div>`;
      } else if (tuh <= 3600) {
        hungerHtml = `<div class="itimer urgent">⚡ ${fmtTime(tuh)}</div>`;
      } else {
        hungerHtml = `<div class="itimer ok">🕐 ${fmtTimeLong(tuh)}</div>`;
      }
    }

    return `<div class="my-item${selCls}" data-hunter="${mf.pubkey}">
      <div class="ico">🎣</div>
      <div class="info">
        <div class="iname">${esc(mf.name || shortPk(mf.pubkey))}${alive}</div>
        <div class="ival">${val}</div>
        ${hungerHtml}
        <div class="ikey">${shortPk(mf.pubkey)}</div>
      </div>
      <div class="del" data-del="${mf.pubkey}" title="Удалить">×</div>
    </div>`;
  }).join('');
}

function showAdd() {
  document.getElementById('addForm').classList.add('show');
  document.getElementById('btnAdd').style.display = 'none';
  document.getElementById('addInput').focus();
}
function cancelAdd() {
  document.getElementById('addForm').classList.remove('show');
  document.getElementById('btnAdd').style.display = '';
  document.getElementById('addInput').value = '';
}
async function confirmAdd() {
  const val = document.getElementById('addInput').value.trim();
  if (!val || val.length < 32) { setStatus('Неверный pubkey', 'err'); return; }
  if (myFish.find(f => f.pubkey === val)) { setStatus('Уже добавлена', 'err'); return; }

  setStatus('Загрузка...', 'info');
  let name = shortPk(val), valueSol = null, alive = null, id = null;

  const found = allFish.find(f => f.pubkey === val);
  if (found) {
    name = found.name; valueSol = found.valueSol; alive = found.alive; id = found.id;
  } else {
    try {
      const f = await window.api.fetchFish(val);
      name = f.name; valueSol = f.valueSol; alive = f.alive; id = f.id;
    } catch(e) { setStatus('Ошибка загрузки: ' + e.message, 'err'); }
  }

  myFish.push({ pubkey: val, name, valueSol, alive, id });
  saveMyFish(); renderMyFish(); cancelAdd();
  setStatus(`Добавлена: ${name}`, 'ok');
}

function removeFish(pubkey) {
  myFish = myFish.filter(f => f.pubkey !== pubkey);
  if (selectedHunter === pubkey) { selectedHunter = null; updateBtns(); }
  saveMyFish(); renderMyFish();
}

// ══════════════════════════════════════════
//  PLACE MARK MODAL
// ══════════════════════════════════════════
function doMark() {
  if (!selectedPrey || !selectedHunter) return;
  const prey   = allFish.find(f => f.pubkey === selectedPrey);
  const hunter = myFish.find(f => f.pubkey === selectedHunter)
               || allFish.find(f => f.pubkey === selectedHunter);
  if (!prey) { setStatus('Жертва не найдена', 'err'); return; }

  const nowSec  = Math.floor(Date.now() / 1000);
  const tuh     = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;
  const costSol = prey.preyStatus.canMark
    ? (Number(prey.preyStatus.markCost) / 1e9).toFixed(6) + ' SOL'
    : '—';
  const pct = tuh <= HIGH_THRESHOLD ? '10%' : '5%';

  document.getElementById('markLog').innerHTML = '';
  document.getElementById('markLog').classList.remove('show');

  document.getElementById('markInfo').innerHTML = `
    <div class="row"><span class="lbl">Жертва</span>     <span class="val acc">${esc(prey.name)}</span></div>
    <div class="row"><span class="lbl">Pubkey</span>      <span class="val" style="font-size:9px">${prey.pubkey}</span></div>
    <div class="row"><span class="lbl">Цена рыбы</span>   <span class="val acc">${prey.valueSol} SOL</span></div>
    <div class="row"><span class="lbl">Цена метки</span>  <span class="val yel">${costSol} (${pct})</span></div>
    <div class="row"><span class="lbl">Охотник</span>     <span class="val">${esc(hunter?.name || shortPk(selectedHunter))}</span></div>
    <div class="row"><span class="lbl">Срочность</span>   <span class="val ${prey.preyStatus.urgency==='HIGH'?'red':'yel'}">
      ${prey.preyStatus.canMark ? (prey.preyStatus.urgency==='HIGH'?'🔴 HIGH':'🟡 NORMAL') : '⌛ Ждём окно'}</span></div>
  `;

  // Countdown до окна (PLACE_WINDOW + earlyStart)
  const openInSec = tuh - PLACE_WINDOW - earlyStart;
  const cdBox = document.getElementById('cdBox');
  const cdVal = document.getElementById('cdVal');
  if (cdInterval) clearInterval(cdInterval);

  if (openInSec > 0) {
    cdBox.style.display = 'block';
    const tick = () => {
      const n  = Math.floor(Date.now() / 1000);
      const t2 = (prey.lastFedAt + PREY_COOLDOWN) - PLACE_WINDOW - earlyStart - n;
      if (t2 <= 0) {
        cdVal.textContent = '00:00:00';
        cdVal.className   = 'cd-val live';
      } else {
        cdVal.textContent = fmtTime(t2);
        cdVal.className   = 'cd-val';
      }
    };
    tick();
    cdInterval = setInterval(tick, 1000);
  } else {
    cdBox.style.display = 'none';
  }

  document.getElementById('btnDoMark').disabled = true;
  document.getElementById('ovMark').classList.add('show');

  // Автозапуск — сразу начинаем, solana.js сам подождёт нужное время
  execMark();
}

async function execMark(skipWait = false) {
  document.getElementById('btnDoMark').disabled = true;
  document.getElementById('markLog').innerHTML = '';
  document.getElementById('markLog').classList.add('show');

  const _mHunterName = myFish.find(f=>f.pubkey===selectedHunter)?.name
    || allFish.find(f=>f.pubkey===selectedHunter)?.name || shortPk(selectedHunter);
  const _mPreyName = allFish.find(f=>f.pubkey===selectedPrey)?.name || shortPk(selectedPrey);

  // Ждём нужного момента (чужая метка / окно постановки)
  if (!skipWait) {
    // Читаем свежие данные — кэш может быть устаревшим
    try {
      const fresh = await window.api.fetchFish(selectedPrey);
      if (fresh) { const i = allFish.findIndex(f=>f.pubkey===selectedPrey); if(i>=0) allFish[i]=fresh; else allFish.push(fresh); }
    } catch(_) {}

    let first = true;
    await new Promise((resolve) => {
      const checkNow = () => {
        const p = allFish.find(f => f.pubkey === selectedPrey);
        if (!p) return true; // нет данных — идём
        const { waitSec, mode } = getTimingInfo(p, selectedHunter, 'mark');
        if (waitSec <= 0) return true;
        const lbl = mode === 'foreignMark'
          ? `⏳ Чужая метка — ждём конца... ${fmtTime(waitSec)}`
          : `⏳ Ждём окно постановки... ${fmtTime(waitSec)}`;
        if (first) { appendLog('markLog', lbl, 'info'); first = false; }
        else { const el = document.getElementById('markLog'); if (el.lastChild) el.lastChild.textContent = lbl; }
        return false;
      };
      if (checkNow()) { resolve(); return; }
      const iv = setInterval(() => { if (checkNow()) { clearInterval(iv); resolve(); } }, 500);
    });
    appendLog('markLog', '🚀 Время! Спамим...', 'info');
  } else {
    appendLog('markLog', '🚀 Спамим place_hunting_mark...', 'info');
  }

  // Автозакрытие через 6 секунд после старта спама
  const autoClose = setTimeout(() => {
    appendLog('markLog', '⏱ 6 сек истекло — останавливаем', 'info');
    clearInterval(windowGuard);
    window.api.cancelTx().catch(() => {});
    addHistory('warn', `⏱ Метка — 6с истекло`, `${_mHunterName} → ${_mPreyName}`);
    closeOverlay('ovMark');
    doRefresh();
  }, 6000);

  // Мониторинг закрытия окна: если tuh <= 0 — останавливаем спам
  const windowGuard = setInterval(async () => {
    try {
      const fresh = await window.api.fetchFish(selectedPrey);
      if (!fresh) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const tuh = (fresh.lastFedAt + PREY_COOLDOWN) - nowSec;
      if (tuh <= 0) {
        clearInterval(windowGuard);
        clearTimeout(autoClose);
        appendLog('markLog', '⚠️ Окно закрылось (жертва голодна) — останавливаем', 'warn');
        window.api.cancelTx().catch(() => {});
        addHistory('warn', `⚠️ Метка — окно закрылось`, `${_mHunterName} → ${_mPreyName}`);
        closeOverlay('ovMark');
        doRefresh();
      }
    } catch(_) {}
  }, 500);

  try {
    const result = await window.api.placeMark(selectedHunter, selectedPrey, true);
    clearTimeout(autoClose);
    clearInterval(windowGuard);
    appendLog('markLog', `✅ Метка поставлена!`, 'ok');
    appendLog('markLog', `TX: ${result.sig}`, 'ok');
    appendLog('markLog', `https://solscan.io/tx/${result.sig}`, 'ok');
    addHistory('ok', `✅ Метка поставлена`, `${_mHunterName} → ${_mPreyName}`);
    // Удаляем все mark-задачи этого охотника — он уже поставил метку
    // Удаляем mark-задачи этого охотника на эту конкретную жертву
    schedule.filter(t => t.type === 'mark' && t.hunterPk === selectedHunter && t.preyPk === selectedPrey)
      .forEach(t => removeScheduleTask(t.id));
    setTimeout(() => { closeOverlay('ovMark'); doRefresh(); }, 2000);
  } catch(e) {
    clearTimeout(autoClose);
    clearInterval(windowGuard);
    const cancelled = e.message.includes('Отменено') || e.message.includes('cancelled') || e.message.includes('aborted');
    if (!cancelled) {
      appendLog('markLog', '❌ ' + e.message, 'err');
      addHistory('err', `❌ Метка не удалась`, `${_mHunterName} → ${_mPreyName}: ${e.message.slice(0,60)}`);
      setTimeout(() => closeOverlay('ovMark'), 3000);
    } else {
      closeOverlay('ovMark');
    }
  }
}


// ── Единая точка определения тайминга ──────────────────────────────────
// Возвращает { waitSec, mode }
// mode: 'foreignMark' | 'myMark' | 'hungry' | 'waitHungry'
// context: 'mark' | 'hunt' (по умолчанию 'hunt')
// Для 'mark': waitSec = 0 если окно уже открыто (tuh <= PLACE_WINDOW), иначе ждём открытия окна
// Для 'hunt': waitSec = tuh (ждём голода)
function getTimingInfo(prey, hunterPk, context = 'hunt') {
  if (!prey) return { waitSec: 0, mode: 'hungry' };
  const nowSec   = Math.floor(Date.now() / 1000);
  const tuh      = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;

  // Ищем охотника по pubkey во всех возможных источниках
  const hunter   = myFish.find(f => f.pubkey === hunterPk) || allFish.find(f => f.pubkey === hunterPk);
  const myFishId = hunter?.id != null ? String(hunter.id) : null;

  const markActive = prey.markedByHunterId && prey.markedByHunterId !== '0'
                  && Number(prey.markExpiresAt) > nowSec;
  const markerId   = markActive ? String(prey.markedByHunterId) : null;

  // Своя метка: id известен И совпадает
  const hasMyMark    = markActive && myFishId !== null && markerId === myFishId;
  // Чужая метка: активна И (id не известен ИЛИ не совпадает) — НО не своя
  const hasForeignMark = markActive && !hasMyMark;



  if (hasForeignMark) {
    // Для hunt: открываем за 8 сек до конца метки (фиксировано)
    // Для mark: ждём полного конца метки - earlyStart
    const HUNT_FOREIGN_EARLY = 8;
    if (context === 'hunt') {
      const foreignWait = Number(prey.markExpiresAt) - nowSec - HUNT_FOREIGN_EARLY;
      return { waitSec: foreignWait > 0 ? foreignWait : 0, mode: 'foreignMark' };
    }
    const foreignWait = Number(prey.markExpiresAt) - nowSec - earlyStart;
    return { waitSec: foreignWait > 0 ? foreignWait : 0, mode: 'foreignMark' };
  } else if (hasMyMark) {
    // Охота по своей метке: ждём tuh + 1 сек (момент голода)
    return { waitSec: Number(tuh) + 1, mode: 'myMark' };
  } else {
    if (context === 'mark') {
      const windowWait = tuh - PLACE_WINDOW - earlyStart;
      return { waitSec: windowWait > 0 ? windowWait : 0, mode: tuh > earlyStart ? 'waitHungry' : 'hungry' };
    } else {
      return { waitSec: Number(tuh) - earlyStart, mode: tuh > earlyStart ? 'waitHungry' : 'hungry' };
    }
  }
}

// Обратная совместимость для updateHuntCountdown
function getHuntWaitSec(prey, hunterPk) {
  return getTimingInfo(prey, hunterPk).waitSec;
}

// ══════════════════════════════════════════
//  HUNT MODAL
// ══════════════════════════════════════════
let huntCdTimer = null;

let _huntAutoFired = false; // флаг чтобы execHunt не запустился дважды

function doHunt() {
  if (!selectedPrey || !selectedHunter) return;
  const prey   = allFish.find(f => f.pubkey === selectedPrey);
  const hunter = myFish.find(f => f.pubkey === selectedHunter)
               || allFish.find(f => f.pubkey === selectedHunter);
  if (!prey) { setStatus('Жертва не найдена', 'err'); return; }

  _huntAutoFired = false;

  document.getElementById('huntLog').innerHTML = '';
  document.getElementById('huntLog').classList.remove('show');
  document.getElementById('ovHunt').classList.add('show');

  // Запускаем тик — он сам запустит execHunt когда придёт время
  if (huntCdTimer) clearInterval(huntCdTimer);
  updateHuntCountdown(prey);
  huntCdTimer = setInterval(() => {
    const p = allFish.find(f => f.pubkey === selectedPrey) || prey;
    updateHuntCountdown(p);
  }, 500);
}

function updateHuntCountdown(prey) {
  if (!prey) return;
  const hunter  = myFish.find(f => f.pubkey === selectedHunter)
                || allFish.find(f => f.pubkey === selectedHunter);
  const nowSec  = Math.floor(Date.now() / 1000);
  const tuh       = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;
  const openInSec = getHuntWaitSec(prey, selectedHunter); // учитывает чужую метку

  const cdHuntBox = document.getElementById('cdHuntBox');
  const cdHuntVal = document.getElementById('cdHuntVal');

  // Инфо блок — используем getTimingInfo для правильного определения метки
  const nowSec2   = Math.floor(Date.now() / 1000);
  const { mode: tiMode } = getTimingInfo(prey, selectedHunter, 'hunt');
  const myFishId2 = allFish.find(f => f.pubkey === selectedHunter)?.id
                 || myFish.find(f => f.pubkey === selectedHunter)?.id || null;
  const foreignMark = tiMode === 'foreignMark';
  const myMark      = tiMode === 'myMark';
  const markLabel = foreignMark
    ? `⚠️ Чужая метка — конец через ${fmtTime(Number(prey.markExpiresAt) - nowSec2)}`
    : myMark
      ? '✅ Моя метка'
      : '○ Нет метки';

  document.getElementById('huntInfo').innerHTML = `
    <div class="row"><span class="lbl">Жертва</span>    <span class="val acc">${esc(prey.name)}</span></div>
    <div class="row"><span class="lbl">Стоимость</span> <span class="val acc">${prey.valueSol} SOL</span></div>
    <div class="row"><span class="lbl">Охотник</span>   <span class="val">${esc(hunter?.name || shortPk(selectedHunter))}</span></div>
    <div class="row"><span class="lbl">Метка</span>     <span class="val ${foreignMark ? 'red' : 'grn'}">${markLabel}</span></div>
    <div class="row"><span class="lbl">Статус</span>    <span class="val ${openInSec <= 0 ? 'grn' : 'yel'}">
      ${openInSec <= 0 ? '🟢 Спамим транзакции...' : `⏳ Автозапуск через ${fmtTime(openInSec)}`}
    </span></div>
  `;

  if (openInSec > 0) {
    // Ещё ждём — показываем таймер
    cdHuntBox.style.display = 'block';
    cdHuntVal.textContent   = fmtTime(openInSec);
  } else {
    // Время пришло — скрываем таймер и автозапускаем один раз
    cdHuntBox.style.display = 'none';
    if (!_huntAutoFired) {
      _huntAutoFired = true;
      stopHuntCountdown();
      execHunt();
    }
  }
}

function stopHuntCountdown() {
  if (huntCdTimer) { clearInterval(huntCdTimer); huntCdTimer = null; }
  const cdHuntBox = document.getElementById('cdHuntBox');
  if (cdHuntBox) cdHuntBox.style.display = 'none';
  const btn = document.getElementById('btnDoHunt');
  if (btn) btn.classList.remove('pulse');
}

async function execHunt(skipWait = false, singleShot = false) {
  stopHuntCountdown();
  document.getElementById('btnDoHunt').disabled = true;
  document.getElementById('huntLog').innerHTML = '';
  document.getElementById('huntLog').classList.add('show');

  const _hHunterName = myFish.find(f=>f.pubkey===selectedHunter)?.name
    || allFish.find(f=>f.pubkey===selectedHunter)?.name || shortPk(selectedHunter);
  const _hPreyName  = allFish.find(f=>f.pubkey===selectedPrey)?.name || shortPk(selectedPrey);
  const _hPreyOwner = allFish.find(f=>f.pubkey===selectedPrey)?.ownerStr || null; // сохраняем до спама

  // Ждём нужного момента (чужая метка / голод)
  if (!skipWait) {
    const prey = allFish.find(f => f.pubkey === selectedPrey);
    if (prey) {
      let first = true;
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const p = allFish.find(f => f.pubkey === selectedPrey) || prey;
          const { waitSec, mode } = getTimingInfo(p, selectedHunter);
          if (waitSec <= 0) { clearInterval(iv); resolve(); return; }
          const lbl = mode === 'foreignMark'
            ? `⏳ Чужая метка — ждём конца... ${fmtTime(waitSec)}`
            : `⏳ Ждём голода жертвы... ${fmtTime(waitSec)}`;
          if (first) { appendLog('huntLog', lbl, 'info'); first = false; }
          else { const el = document.getElementById('huntLog'); if (el.lastChild) el.lastChild.textContent = lbl; }
        }, 500);
        const { waitSec } = getTimingInfo(prey, selectedHunter);
        if (waitSec <= 0) { clearInterval(iv); resolve(); }
      });
      appendLog('huntLog', '🗡️ Время! Спамим...', 'info');
    } else {
      appendLog('huntLog', '🗡️ Спамим hunt_fish...', 'info');
    }
  } else {
    appendLog('huntLog', '🗡️ Спамим hunt_fish...', 'info');
  }

  // Автозакрытие: чужая метка = 8 сек, своя = не нужен (одна транзакция), обычно = 6 сек
  const autoCloseMs = singleShot ? 8000 : 8000; // для чужой тоже 8 чтобы хватило
  const autoClose = setTimeout(() => {
    appendLog('huntLog', `⏱ ${autoCloseMs/1000} сек истекло — останавливаем`, 'info');
    clearInterval(huntGuard);
    window.api.cancelTx().catch(() => {});
    addHistory('warn', `⏱ Охота — ${autoCloseMs/1000}с истекло`, `${_hHunterName} → ${_hPreyName}`);
    closeOverlay('ovHunt');
    doRefresh();
  }, autoCloseMs);

  // Стоп если окно закрылось вручную (следим за DOM)
  const huntGuard = setInterval(() => {
    const overlay = document.getElementById('ovHunt');
    if (!overlay || !overlay.classList.contains('show')) {
      clearInterval(huntGuard);
      clearTimeout(autoClose);
      window.api.cancelTx().catch(() => {});
    }
  }, 200);

  try {
    const result = await window.api.huntFish(selectedHunter, selectedPrey, true, singleShot);
    clearTimeout(autoClose);
    clearInterval(huntGuard);
    appendLog('huntLog', `✅ Рыба съедена!`, 'ok');
    appendLog('huntLog', `TX: ${result.sig}`, 'ok');
    appendLog('huntLog', `https://solscan.io/tx/${result.sig}`, 'ok');
    addHistory('ok', `🎯 Охота удалась!`, `${_hHunterName} съел ${_hPreyName}`);
    // Лог кормов обновится автоматически при doRefresh()
    // Удаляем все hunt-задачи для этой жертвы от этого охотника
    // Удаляем hunt-задачи этого охотника на эту конкретную жертву
    schedule.filter(t => t.type === 'hunt' && t.hunterPk === selectedHunter && t.preyPk === selectedPrey)
      .forEach(t => removeScheduleTask(t.id));
    setTimeout(() => { closeOverlay('ovHunt'); doRefresh(); }, 2000);
  } catch(e) {
    clearTimeout(autoClose);
    clearInterval(huntGuard);
    const cancelled = e.message.includes('Отменено') || e.message.includes('cancelled') || e.message.includes('aborted');
    const stolenByOther = e.message.includes('кто-то другой');
    if (stolenByOther) {
      appendLog('huntLog', '⚡ Рыбу съел другой охотник', 'err');
      addHistory('warn', `⚡ Рыбу съели раньше нас`, `${_hHunterName} → ${_hPreyName}`);
      setTimeout(() => { closeOverlay('ovHunt'); doRefresh(); }, 2000);
    } else if (!cancelled) {
      appendLog('huntLog', '❌ ' + e.message, 'err');
      addHistory('err', `❌ Охота не удалась`, `${_hHunterName} → ${_hPreyName}: ${e.message.slice(0,60)}`);
      setTimeout(() => closeOverlay('ovHunt'), 3000);
    } else {
      closeOverlay('ovHunt');
    }
  }
}

function closeOverlay(id) {
  document.getElementById(id).classList.remove('show');
  if (cdInterval) { clearInterval(cdInterval); cdInterval = null; }
  if (id === 'ovHunt') stopHuntCountdown();
  // Cancel any running transaction spam
  window.api.cancelTx().catch(() => {});
}

function appendLog(id, text, type = 'info') {
  const el = document.getElementById(id);
  el.classList.add('show');
  const line = document.createElement('div');
  const cls  = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-inf';
  line.className   = cls;
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ══════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════
function fmtTime(sec) {
  const s = Math.abs(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}:${pad(h)}:${pad(m)}:${pad(ss)}`;
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}
function fmtTimeLong(sec) {
  const s = Math.abs(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}д ${h}ч ${m}м ${ss}с`;
  if (h >= 1) return `${h}ч ${m}м ${ss}с`;
  return `${m}м ${ss}с`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function shortPk(pk) { return pk.slice(0,4) + '…' + pk.slice(-4); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ══════════════════════════════════════════
//  BIND ALL EVENT LISTENERS (no inline onclick needed)
// ══════════════════════════════════════════
function bindEvents() {
  // Toolbar
  document.getElementById('btnRefresh').addEventListener('click', doRefresh);

  // Scheduler
;

  document.getElementById('btnSchedClear').addEventListener('click', clearSchedule);

  document.getElementById('schedList').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) removeScheduleTask(parseFloat(del.dataset.del));
  });

  // Resume tasks from previous session
  resumeSchedule();
  
  // Add form
    
  // Filters
  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('fNoMark').addEventListener('change', applyFilters);
  document.getElementById('fMinPriceOn').addEventListener('change', toggleMin);
  document.getElementById('fMinPrice').addEventListener('input', applyFilters);

  // Sort headers
  document.getElementById('th-name').addEventListener('click',   () => sortBy('name'));
  document.getElementById('th-value').addEventListener('click',  () => sortBy('value'));
  document.getElementById('th-timer').addEventListener('click',  () => sortBy('timer'));
  document.getElementById('th-wallet').addEventListener('click', () => sortBy('wallet'));

  // Modal buttons
  document.getElementById('btnCancelMark').addEventListener('click', () => closeOverlay('ovMark'));
  // btnDoMark — авто-режим, запуск только через таймер в doMark
  document.getElementById('btnCancelHunt').addEventListener('click', () => closeOverlay('ovHunt'));
  // btnDoHunt — только остановить, не запускать вручную (авто-режим)

  document.getElementById('huntNotifyClose')?.addEventListener('click', () => {
    document.getElementById('huntNotify').style.display = 'none';
  });

  // Delegated: ocean table rows (prey selection)
  document.getElementById('tbody').addEventListener('click', e => {
    // Don't intercept wallet links
    if (e.target.closest('[data-ext]')) return;
    const tr = e.target.closest('tr[data-pubkey]');
    if (tr) selectPrey(tr.dataset.pubkey);
  });

  // Delegated: my fish list (hunter selection + delete)
  document.getElementById('myList').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) { removeFish(delBtn.dataset.del); return; }
    const item = e.target.closest('[data-hunter]');
    if (item) selectHunter(item.dataset.hunter);
  });
}

// ══════════════════════════════════════════
//  SCHEDULER
// ══════════════════════════════════════════

let schedule = JSON.parse(localStorage.getItem('schedule') || '[]');
// task: { id, hunterPk, hunterName, preyPk, preyName, type:'mark'|'hunt', status:'wait'|'running'|'ok'|'err', statusMsg }

function saveSchedule() { localStorage.setItem('schedule', JSON.stringify(schedule)); }

function addToSchedule(type) {
  if (!selectedPrey || !selectedHunter) return;
  const prey   = allFish.find(f => f.pubkey === selectedPrey);
  const hunter = myFish.find(f => f.pubkey === selectedHunter)
               || allFish.find(f => f.pubkey === selectedHunter);
  if (!prey || !hunter) return;

  // Avoid duplicate same hunter+prey+type
  if (schedule.find(t => t.hunterPk === selectedHunter && t.preyPk === selectedPrey && t.type === type)) {
    setStatus('Эта задача уже в планировщике', 'yel');
    return;
  }

  const task = {
    id:          Date.now() + Math.random(),
    hunterPk:    selectedHunter,
    hunterName:  hunter.name || shortPk(selectedHunter),
    preyPk:      selectedPrey,
    preyName:    prey.name || shortPk(selectedPrey),
    type,
    status:      'wait',
    statusMsg:   '',
  };

  schedule.push(task);
  saveSchedule();
  renderSchedule();
  startSchedulerTask(task);
  setStatus(`Добавлено в планировщик: ${type === 'mark' ? 'Mark' : 'Hunt'} ${prey.name}`, 'ok');
}

function removeScheduleTask(id) {
  const task = schedule.find(t => t.id === id);
  if (task) task._abort?.abort(); // stop background loop
  schedule = schedule.filter(t => t.id !== id);
  saveSchedule();
  renderSchedule();
}

function clearSchedule() {
  schedule = [];
  saveSchedule();
  renderSchedule();
}

function updateTaskStatus(id, status, msg) {
  const t = schedule.find(t => t.id === id);
  if (!t) return;
  t.status    = status;
  t.statusMsg = msg;
  saveSchedule();
  renderSchedule();
}

function renderSchedule() {
  const list  = document.getElementById('schedList');
  const count = document.getElementById('schedCount');
  if (!list) return;

  count.textContent = schedule.length + ' задач';

  if (!schedule.length) {
    list.innerHTML = '<div class="sched-empty">Нет задач — выбери охотника и жертву, нажми + В ПЛАН</div>';
    return;
  }

  list.innerHTML = schedule.map(t => {
    const prey   = allFish.find(f => f.pubkey === t.preyPk);
    let timerTxt = '—';
    if (prey && t.status === 'wait') {
      const nowSec = Math.floor(Date.now() / 1000);
      const tuh    = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;
      if (t.type === 'mark') {
        const left = tuh - PLACE_WINDOW - earlyStart;
        timerTxt = left > 0 ? fmtTime(left) : '🟡 Скоро';
      } else {
        const left = getHuntWaitSec(prey, t.hunterPk);
        // Определяем есть ли чужая метка для подсказки
        const myId = allFish.find(f => f.pubkey === t.hunterPk)?.id || null;
        const hasForeign = myId !== null
          && prey.markedByHunterId && prey.markedByHunterId !== '0'
          && Number(prey.markExpiresAt) > nowSec
          && String(prey.markedByHunterId) !== String(myId);
        const hasMyMark = myId !== null
          && prey.markedByHunterId && prey.markedByHunterId !== '0'
          && Number(prey.markExpiresAt) > nowSec
          && String(prey.markedByHunterId) === String(myId);
        if (left > 0) {
          if (hasForeign)     timerTxt = `⚠️ ${fmtTime(left)}`;
          else if (hasMyMark) timerTxt = `✅ ${fmtTime(left)}`;
          else                timerTxt = fmtTime(left);
        } else {
          if (hasForeign)     timerTxt = '⚠️ Скоро';
          else if (hasMyMark) timerTxt = '✅ Скоро';
          else                timerTxt = '🔴 Скоро';
        }
      }
    }

    return `<div class="sched-item ${t.status}" data-id="${t.id}">
      <div class="sched-item-top">
        <span class="sched-type-${t.type}">${t.type.toUpperCase()}</span>
        <span class="sched-name" title="${t.hunterPk}">${esc(t.hunterName)}</span>
        <span class="sched-del" data-del="${t.id}">×</span>
      </div>
      <div class="sched-item-bottom">
        <span class="sched-arrow">→</span>
        <span class="sched-name" title="${t.preyPk}">${esc(t.preyName)}</span>
        <span class="sched-timer">${timerTxt}</span>
      </div>
    </div>`;
  }).join('');
}

// Refresh timers in scheduler every second
setInterval(() => { if (schedule.length) renderSchedule(); }, 1000);

// Check schedule after every refresh — validate tasks against fresh data
function checkScheduleAfterRefresh() {
  if (!schedule.length || !allFish.length) return;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const task of [...schedule]) {
    if (task.status !== 'wait') continue;
    const prey = allFish.find(f => f.pubkey === task.preyPk);

    // Fish gone or dead (share = 0)
    if (!prey || prey.alive === false) {
      updateTaskStatus(task.id, 'err', '❌ Рыба съедена/мертва');
      addHistory('warn', `🐟 Рыба исчезла из океана`, `Задача отменена: ${task.hunterName} → ${task.preyName}`);
      task._abort?.abort();
      setTimeout(() => removeScheduleTask(task.id), 10000);
      continue;
    }

    // Fish was fed — timer reset (tuh > 6 days means freshly fed)
    const tuh = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;
    if (tuh > 6 * 24 * 60 * 60) {
      updateTaskStatus(task.id, 'err', '❌ Рыба покормилась');
      addHistory('info', `🍖 Рыба покормилась`, `${task.preyName} — задача ${task.hunterName} отменена`);
      task._abort?.abort();
      setTimeout(() => removeScheduleTask(task.id), 10000);
      continue;
    }
  }
}

// Один авторефреш за 60 секунд до каждой задачи
setInterval(() => {
  if (!schedule.length || !allFish.length) return;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const task of schedule) {
    if (task.status !== 'wait' || task._autoRefreshDone) continue;
    const prey = allFish.find(f => f.pubkey === task.preyPk);
    if (!prey) continue;

    let secsLeft;
    if (task.type === 'mark') {
      secsLeft = (prey.lastFedAt + PREY_COOLDOWN) - PLACE_WINDOW - earlyStart - nowSec;
    } else {
      secsLeft = getHuntWaitSec(prey, task.hunterPk);
    }

    if (secsLeft !== null && secsLeft <= 60 && secsLeft > 5) {
      task._autoRefreshDone = true;
      doRefresh();
      break; // один рефреш на все задачи за раз
    }
  }
}, 10000);

// Start a scheduler task — waits for the right moment then fires
async function startSchedulerTask(task) {
  const abortCtrl = new AbortController();
  task._abort = abortCtrl;

  try {
    if (task.type === 'mark') {
      await waitAndExecuteMark(task, abortCtrl.signal);
    } else {
      await waitAndExecuteHunt(task, abortCtrl.signal);
    }
  } catch(e) {
    if (!abortCtrl.signal.aborted) {
      updateTaskStatus(task.id, 'err', '❌ ' + e.message.slice(0, 40));
      addHistory('err', `❌ Ошибка задачи`, `${task.hunterName} → ${task.preyName}: ${e.message.slice(0,60)}`);
      setTimeout(() => removeScheduleTask(task.id), 5000);
    }
  }
}

// Ждём нужного момента, потом открываем то же окно что и ручной запуск
async function waitAndExecuteMark(task, signal) {
  while (true) {
    if (signal.aborted) return;

    // Читаем свежие данные
    let prey;
    try { prey = await window.api.fetchFish(task.preyPk); } catch(e) {
      updateTaskStatus(task.id, 'wait', '⚠ Ошибка чтения...');
      await sleep(10000, signal); if (signal.aborted) return; continue;
    }

    if (!prey || prey.alive === false) {
      updateTaskStatus(task.id, 'err', '❌ Рыба недоступна');
      addHistory('warn', `🐟 Рыба недоступна`, `${task.hunterName} → ${task.preyName}`);
      setTimeout(() => removeScheduleTask(task.id), 5000); return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const tuh    = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;

    // Для place mark: чужая метка → ждём её конца, иначе ждём открытия окна
    const { waitSec: effectiveWait, mode: markMode } = getTimingInfo(prey, task.hunterPk, 'mark');

    if (tuh <= 0) {
      updateTaskStatus(task.id, 'err', '❌ Уже голодна');
      addHistory('warn', `❌ Уже голодна`, `${task.hunterName} → ${task.preyName}`);
      setTimeout(() => removeScheduleTask(task.id), 5000); return;
    }

    if (effectiveWait > 0) {
      updateTaskStatus(task.id, 'wait', markMode === 'foreignMark' ? '⚠️ Чужая метка' : '');
      await sleep(Math.min(effectiveWait * 1000, 30000), signal);
      if (signal.aborted) return; continue;
    }

    break; // время пришло
  }

  if (signal.aborted) return;

  // Получаем свежие данные жертвы
  let freshPrey;
  try {
    freshPrey = await window.api.fetchFish(task.preyPk);
    if (freshPrey) {
      const idx = allFish.findIndex(f => f.pubkey === task.preyPk);
      if (idx >= 0) allFish[idx] = freshPrey; else allFish.push(freshPrey);
    }
  } catch(e) {
    updateTaskStatus(task.id, 'err', '❌ Ошибка чтения данных');
    addHistory('err', `❌ Ошибка перед Mark`, `${task.hunterName} → ${task.preyName}`);
    setTimeout(() => removeScheduleTask(task.id), 5000); return;
  }

  if (signal.aborted) return;

  // Устанавливаем выбор
  selectedHunter = task.hunterPk;
  selectedPrey   = task.preyPk;
  updateTaskStatus(task.id, 'running', '🔥 Спамим...');

  // Напрямую открываем окно и запускаем execMark — без проверок doMark()
  const prey   = allFish.find(f => f.pubkey === selectedPrey);
  const hunter = myFish.find(f => f.pubkey === selectedHunter) || allFish.find(f => f.pubkey === selectedHunter);
  const nowSec = Math.floor(Date.now() / 1000);
  const tuh    = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;
  const costSol = prey.preyStatus?.markCost ? (Number(prey.preyStatus.markCost) / 1e9).toFixed(6) + ' SOL' : '—';
  const pct    = tuh <= HIGH_THRESHOLD ? '10%' : '5%';

  document.getElementById('markLog').innerHTML = '';
  document.getElementById('markLog').classList.remove('show');
  document.getElementById('markInfo').innerHTML = `
    <div class="row"><span class="lbl">Жертва</span>     <span class="val acc">${esc(prey.name)}</span></div>
    <div class="row"><span class="lbl">Pubkey</span>      <span class="val" style="font-size:9px">${prey.pubkey}</span></div>
    <div class="row"><span class="lbl">Цена рыбы</span>   <span class="val acc">${prey.valueSol} SOL</span></div>
    <div class="row"><span class="lbl">Цена метки</span>  <span class="val yel">${costSol} (${pct})</span></div>
    <div class="row"><span class="lbl">Охотник</span>     <span class="val">${esc(hunter?.name || shortPk(selectedHunter))}</span></div>
    <div class="row"><span class="lbl">Режим</span>       <span class="val grn">📋 Из планировщика</span></div>
  `;
  document.getElementById('cdBox').style.display = 'none';
  document.getElementById('btnDoMark').disabled = true;
  document.getElementById('ovMark').classList.add('show');
  execMark(true);

  // Ждём пока окно закроется — max 25с страховка
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 9000);
    const check = setInterval(() => {
      if (signal.aborted) { clearInterval(check); clearTimeout(timeout); resolve(); return; }
      const overlay = document.getElementById('ovMark');
      if (!overlay || !overlay.classList.contains('show')) {
        clearInterval(check); clearTimeout(timeout); resolve();
      }
    }, 300);
  });

  // Если планировщик отменили — останавливаем транзакции
  signal.addEventListener('abort', () => { window.api.cancelTx().catch(() => {}); }, { once: true });

  if (signal.aborted) { window.api.cancelTx().catch(() => {}); return; }
  // Удаляем все mark-задачи этого охотника — он уже поставил метку
  // Удаляем mark-задачи этого охотника на эту конкретную жертву
  schedule.filter(t => t.type === 'mark' && t.hunterPk === task.hunterPk && t.preyPk === task.preyPk)
    .forEach(t => removeScheduleTask(t.id));
}

async function waitAndExecuteHunt(task, signal) {
  while (true) {
    if (signal.aborted) return;

    let prey;
    try { prey = await window.api.fetchFish(task.preyPk); } catch(e) {
      updateTaskStatus(task.id, 'wait', '⚠ Ошибка чтения...');
      await sleep(10000, signal); if (signal.aborted) return; continue;
    }

    if (!prey || prey.alive === false) {
      updateTaskStatus(task.id, 'err', '❌ Рыба съедена/недоступна');
      addHistory('warn', `🐟 Рыба съедена`, `${task.hunterName} → ${task.preyName}`);
      setTimeout(() => removeScheduleTask(task.id), 5000); return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const tuh    = (prey.lastFedAt + PREY_COOLDOWN) - nowSec;

    // Используем ту же логику что и в ручном режиме через getTimingInfo
    const { waitSec, mode: huntMode } = getTimingInfo(prey, task.hunterPk, 'hunt');

    // Слишком поздно — рыба голодна, нет метки и давно прошло время
    if (huntMode !== 'foreignMark' && tuh < -120) {
      updateTaskStatus(task.id, 'err', '❌ Слишком поздно');
      addHistory('warn', `❌ Слишком поздно`, `${task.hunterName} → ${task.preyName}`);
      setTimeout(() => removeScheduleTask(task.id), 5000); return;
    }

    if (waitSec > 0) {
      const statusLabel = huntMode === 'foreignMark'
        ? `⚠️ Чужая метка — через ${fmtTime(waitSec)}`
        : huntMode === 'myMark'
          ? `✅ Моя метка — через ${fmtTime(waitSec)}`
          : '';
      updateTaskStatus(task.id, 'wait', statusLabel);
      // Спим точно — но не больше 15 сек за раз чтобы обновлять статус
      await sleep(Math.min(waitSec * 1000, 15000), signal);
      if (signal.aborted) return; continue;
    }

    break;
  }

  if (signal.aborted) return;

  // Получаем свежие данные прямо перед запуском
  let freshPrey, freshHunter;
  try {
    const fp = await window.api.fetchFish(task.preyPk);
    if (fp) { const i = allFish.findIndex(f => f.pubkey === task.preyPk); if (i>=0) allFish[i]=fp; else allFish.push(fp); freshPrey = fp; }
    const fh = await window.api.fetchFish(task.hunterPk);
    if (fh) { const i = allFish.findIndex(f => f.pubkey === task.hunterPk); if (i>=0) allFish[i]=fh; else allFish.push(fh); freshHunter = fh; }
  } catch(e) {
    updateTaskStatus(task.id, 'err', '❌ Ошибка чтения данных');
    addHistory('err', `❌ Ошибка перед Hunt`, `${task.hunterName} → ${task.preyName}`);
    setTimeout(() => removeScheduleTask(task.id), 5000); return;
  }

  if (signal.aborted) return;
  if (!freshPrey || freshPrey.alive === false) {
    updateTaskStatus(task.id, 'err', '❌ Рыба уже съедена');
    addHistory('warn', `🐟 Рыба съедена`, `${task.hunterName} → ${task.preyName}`);
    setTimeout(() => removeScheduleTask(task.id), 5000); return;
  }

  selectedHunter = task.hunterPk;
  selectedPrey   = task.preyPk;

  // Определяем режим запуска
  const nowSecFinal  = Math.floor(Date.now() / 1000);
  const myFishIdFinal = freshHunter?.id?.toString() || null;
  const markActiveFinal = freshPrey.markedByHunterId && freshPrey.markedByHunterId !== '0'
    && Number(freshPrey.markExpiresAt) > nowSecFinal;
  const isForeignMark = markActiveFinal && (
    myFishIdFinal === null || String(freshPrey.markedByHunterId) !== myFishIdFinal
  );
  const isMyMark = markActiveFinal && myFishIdFinal !== null
    && String(freshPrey.markedByHunterId) === myFishIdFinal;

  updateTaskStatus(task.id, 'running', isForeignMark ? '🗡️ Чужая метка!' : isMyMark ? '🗡️ Моя метка!' : '🗡️ Спамим...');

  const preyH   = freshPrey;
  const hunterH = freshHunter || myFish.find(f => f.pubkey === selectedHunter);

  _huntAutoFired = false;
  document.getElementById('huntLog').innerHTML = '';
  document.getElementById('huntLog').classList.remove('show');

  const markLabelH = isForeignMark ? '⚠️ Чужая метка' : isMyMark ? '✅ Моя метка' : '○ Нет метки';

  document.getElementById('huntInfo').innerHTML = `
    <div class="row"><span class="lbl">Жертва</span>    <span class="val acc">${esc(preyH.name)}</span></div>
    <div class="row"><span class="lbl">Стоимость</span> <span class="val acc">${preyH.valueSol} SOL</span></div>
    <div class="row"><span class="lbl">Охотник</span>   <span class="val">${esc(hunterH?.name || shortPk(selectedHunter))}</span></div>
    <div class="row"><span class="lbl">Метка</span>     <span class="val ${isForeignMark ? 'red' : 'grn'}">${markLabelH}</span></div>
    <div class="row"><span class="lbl">Режим</span>     <span class="val grn">📋 Из планировщика</span></div>
    <div class="row"><span class="lbl">Статус</span>    <span class="val grn">🟢 Спамим транзакции...</span></div>
  `;
  document.getElementById('cdHuntBox').style.display = 'none';
  document.getElementById('ovHunt').classList.add('show');

  // Чужая метка — спамим 8 сек (окно охоты)
  // Своя метка — одна транзакция (точечный момент)
  execHunt(true, isMyMark);

  // Ждём пока окно закроется — страховка 12с для чужой метки, 5с для своей/без метки
  const maxWait = isForeignMark ? 12000 : 5000;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, maxWait);
    const check = setInterval(() => {
      if (signal.aborted) { clearInterval(check); clearTimeout(timeout); resolve(); return; }
      const overlay = document.getElementById('ovHunt');
      if (!overlay || !overlay.classList.contains('show')) {
        clearInterval(check); clearTimeout(timeout); resolve();
      }
    }, 200);
  });

  signal.addEventListener('abort', () => { window.api.cancelTx().catch(() => {}); }, { once: true });
  if (signal.aborted) { window.api.cancelTx().catch(() => {}); return; }
  // Удаляем hunt-задачи этого охотника на эту конкретную жертву
  schedule.filter(t => t.type === 'hunt' && t.hunterPk === task.hunterPk && t.preyPk === task.preyPk)
    .forEach(t => removeScheduleTask(t.id));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Отменено')); }, { once: true });
  });
}

// On startup — resume waiting tasks
function resumeSchedule() {
  for (const task of schedule) {
    if (task.status === 'wait' || task.status === 'running') {
      task.status    = 'wait';
      task.statusMsg = '';
      startSchedulerTask(task);
    }
  }
  renderSchedule();
}

// ══════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════

const MAX_HISTORY = 100;
// ══════════════════════════════════════════
//  PREY LOG (Корм) — кошельки съеденных рыб
// ══════════════════════════════════════════
let preyLog = JSON.parse(localStorage.getItem('preyLog') || '[]');
// preyLog: [{ ownerStr, count, lastFishName, lastTime }]

function savePreyLog() { localStorage.setItem('preyLog', JSON.stringify(preyLog)); }

function addPreyLog(ownerStr, fishName) {
  const existing = preyLog.find(p => p.ownerStr === ownerStr);
  const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  if (existing) {
    existing.count++;
    existing.lastFishName = fishName;
    existing.lastTime = date + ' ' + time;
  } else {
    preyLog.unshift({ ownerStr, count: 1, lastFishName: fishName, lastTime: date + ' ' + time });
  }
  savePreyLog();
  renderPreyLog();
}

function renderPreyLog() {
  const list  = document.getElementById('preyList');
  const count = document.getElementById('preyCount');
  if (!list) return;
  // Сортируем по количеству съеденных (больше — выше)
  const sorted = [...preyLog].sort((a, b) => b.count - a.count);
  count.textContent = sorted.length + ' кошельков';
  if (!sorted.length) {
    list.innerHTML = '<div class="sched-empty">Нет данных</div>';
    return;
  }
  list.innerHTML = sorted.map(p => {
    const shortAddr = '...' + p.ownerStr.slice(-4);
    const solscanUrl = 'https://solscan.io/account/' + p.ownerStr;
    return '<div class="hist-item ok prey-row" data-url="' + solscanUrl + '">' +
      '<div class="hist-time">' + p.lastTime + '</div>' +
      '<div class="hist-msg">\u{1F356} <strong>' + shortAddr + '</strong> \u2014 \u0441\u044a\u0435\u0434\u0435\u043d\u043e \u0440\u044b\u0431: <strong>' + p.count + '</strong></div>' +
      '<div class="hist-sub">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f: ' + esc(p.lastFishName) + '</div>' +
      '</div>';
  }).join('');
  // Клики по строкам
  list.querySelectorAll('.prey-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => window.api.openExternal(row.dataset.url));
  });
}

function clearPreyLog() {
  preyLog = [];
  savePreyLog();
  renderPreyLog();
}

let history = JSON.parse(localStorage.getItem('actionHistory') || '[]');

function saveHistory() { localStorage.setItem('actionHistory', JSON.stringify(history)); }

function addHistory(type, msg, sub = '') {
  const now  = new Date();
  const time = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  history.unshift({ type, msg, sub, time, date });
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const list  = document.getElementById('histList');
  const count = document.getElementById('histCount');
  if (!list) return;
  count.textContent = history.length + ' событий';
  if (!history.length) {
    list.innerHTML = '<div class="sched-empty">История пуста</div>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="hist-item ${h.type}">
      <div class="hist-time">${h.date} ${h.time}</div>
      <div class="hist-msg">${h.msg}</div>
      ${h.sub ? `<div class="hist-sub">${h.sub}</div>` : ''}
    </div>
  `).join('');
}

function clearHistory() {
  history = [];
  saveHistory();
  renderHistory();
}

// ── Tab switching ──────────────────────────
function initTabs() { /* demo: no tabs */ }
