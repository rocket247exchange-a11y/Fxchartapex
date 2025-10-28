/* app.js - fully integrated live leaderboard version
   - Canvas candlestick chart + live ticks
   - Notifications (emails) every 5s
   - Leaderboard: dynamic traders, re-sorting & animated moves
   - Mirror actions push toasts + mirrored email
   - No external libraries; safe DOM bounds
*/

/* ---------------- CONFIG ---------------- */
const CANDLES_VISIBLE = 140;
const TICK_MS = 220;
const CANDLE_MS = 2200;
const NOTIFY_MS = 5000;
const LB_UPDATE_MS = 3500;
const MAX_NOTIF = 40;
const NAME_POOL = ['FXTitan','PipHunter','LunaTradez','ForexBoss','CryptoKnight','SatoshiPro','PipQueen','MacroWave','GridMaster','AlphaRex'];
const DOMAIN_POOL = ['proton.me','gmail.com','outlook.com','hotmail.com','yahoo.com','yahoo.co.uk'];
const PAIR_START = { EURUSD:1.07500, GBPUSD:1.27000, USDJPY:154.300, AUDUSD:0.65000, USDCAD:1.34000, USDCHF:0.92000 };

/* ---------------- DOM ---------------- */
const container = document.getElementById('chartContainer');
const canvas = document.getElementById('fxCanvas');
const liveBadge = document.getElementById('live');
const toastsEl = document.getElementById('toasts');
const carouselList = document.getElementById('carouselList');
const mirrorBtn = document.getElementById('mirrorBtn');
const pauseBtn = document.getElementById('pauseBtn');
const emailsCounter = document.getElementById('emailsCounter');
const lastTimeEl = document.getElementById('lastTime');
const pairSelect = document.getElementById('pairSelect');
const pairTitle = document.getElementById('pairTitle');
const bidEl = document.getElementById('bid');
const askEl = document.getElementById('ask');
const spreadEl = document.getElementById('spread');
const volEl = document.getElementById('vol');
const lbRows = document.getElementById('lbRows');

const ctx = canvas.getContext('2d', { alpha:false });

/* ---------------- STATE ---------------- */
let currentPair = 'EURUSD';
let candles = [];
let markers = [];
let traders = [];
let emailCount = 0;
let paused = false;

/* ---------------- HELPERS ---------------- */
const fmt = p => (Number.isFinite(p) ? parseFloat(p).toFixed((currentPair==='USDJPY')?3:5) : p);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
function maskUser(u){
  if (u.length <=4) return u.slice(0,1)+'****';
  if (u.length <=7) return u.slice(0,2)+'****'+u.slice(-1);
  return u.slice(0,4)+'****'+u.slice(-1);
}
function genEmail(){
  const name = pick(['jack','emma','liam','sophia','noah','olivia','mason','mia','ethan','ava','lucas']);
  const num = Math.random()>0.6 ? String(Math.floor(Math.random()*99)) : '';
  const domain = pick(DOMAIN_POOL);
  const raw = `${name}${num}@${domain}`;
  const at = raw.indexOf('@');
  return `${maskUser(raw.slice(0,at))}${raw.slice(at)}`;
}

/* ---------------- CANVAS/CHART ---------------- */
function fitCanvas(){
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(300, rect.width);
  const cssH = Math.max(240, rect.height);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawAll();
}
const ro = new ResizeObserver(fitCanvas);
ro.observe(container);
window.addEventListener('resize', fitCanvas);

/* ---------------- HISTORY ---------------- */
function genHistory(pair = 'EURUSD', n = CANDLES_VISIBLE){
  const start = PAIR_START[pair] || 1.0;
  const out = []; let t = Math.floor(Date.now()/1000) - n*60; let p = start;
  const volFactor = (pair==='USDJPY')?0.12:0.0018;
  for (let i=0;i<n;i++){
    const open = p;
    const change = (Math.random()-0.5)*volFactor;
    const close = Math.max(0.0001, open + change);
    const high = Math.max(open, close) + Math.random()*Math.abs(change)*1.1 + (pair==='USDJPY'?0.02:0.0006);
    const low = Math.min(open, close) - Math.random()*Math.abs(change)*1.1 - (pair==='USDJPY'?0.02:0.0006);
    out.push({ time:t, open:+open.toFixed((pair==='USDJPY')?3:5), high:+high.toFixed((pair==='USDJPY')?3:5), low:+low.toFixed((pair==='USDJPY')?3:5), close:+close.toFixed((pair==='USDJPY')?3:5) });
    p = close; t += 60;
  }
  return out;
}
candles = genHistory(currentPair);

/* ---------------- DRAW HELPERS ---------------- */
const PAD = { left:80, right:18, top:16, bottom:36 };
function computeRange(){
  let min=Infinity,max=-Infinity;
  for(const c of candles){ if (c.low < min) min = c.low; if (c.high > max) max = c.high; }
  for(const m of markers){ if (m.price < min) min = m.price; if (m.price > max) max = m.price; }
  if (!isFinite(min) || !isFinite(max)){ min=1; max=1.1; }
  const pad = (max - min) * 0.12 || (currentPair==='USDJPY' ? 0.5 : 0.0005);
  return { min: min - pad, max: max + pad };
}
function priceToY(price, range, h){
  const usable = h - PAD.top - PAD.bottom;
  const frac = (price - range.min) / (range.max - range.min);
  return PAD.top + (1 - frac) * usable;
}
function clear(){ ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.clientWidth, canvas.clientHeight); }
function drawGrid(range){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
  const rows = 6;
  for (let i=0;i<=rows;i++){
    const y = PAD.top + i*((h - PAD.top - PAD.bottom)/rows);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w - PAD.right, y); ctx.stroke();
    ctx.fillStyle = '#9aa3b2'; ctx.font = '12px Inter, Arial';
    const price = range.max - (range.max - range.min) * (i/rows);
    ctx.fillText(currentPair==='USDJPY' ? price.toFixed(3) : price.toFixed(5), 8, y+4);
  }
}
function drawCandlesAndMarkers(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const visible = candles.slice(-CANDLES_VISIBLE);
  const n = visible.length;
  const spacing = 6;
  const availableW = w - PAD.left - PAD.right;
  const candleW = Math.max(3, (availableW - spacing*(n-1)) / n * 0.78);
  const step = candleW + spacing;
  const startX = w - PAD.right - (n * candleW + (n-1)*spacing);
  const range = computeRange();

  for (let i=0;i<n;i++){
    const c = visible[i];
    const cx = startX + i*step + candleW/2;
    const oY = priceToY(c.open, range, h);
    const cY = priceToY(c.close, range, h);
    const hY = priceToY(c.high, range, h);
    const lY = priceToY(c.low, range, h);
    ctx.strokeStyle = '#c8d2da'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, hY); ctx.lineTo(cx, lY); ctx.stroke();
    const up = c.close >= c.open;
    ctx.fillStyle = up ? '#16a34a' : '#ef4444';
    ctx.fillRect(cx - candleW/2, Math.min(oY,cY), candleW, Math.max(1, Math.abs(cY-oY)));
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.strokeRect(cx - candleW/2, Math.min(oY,cY), candleW, Math.max(1, Math.abs(cY-oY)));
  }

  for (const m of markers){
    const idx = visible.findIndex(b => b.time === m.time);
    if (idx === -1) continue;
    const cx = startX + idx*step + candleW/2;
    const y = priceToY(m.price, range, h);
    ctx.beginPath(); ctx.fillStyle = m.side==='buy' ? '#16a34a' : '#ef4444';
    if (m.side==='buy'){ ctx.moveTo(cx, y-12); ctx.lineTo(cx-8,y-2); ctx.lineTo(cx+8,y-2); }
    else { ctx.moveTo(cx, y+12); ctx.lineTo(cx-8,y+2); ctx.lineTo(cx+8,y+2); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = '10px Inter, Arial';
    ctx.fillText(m.side.toUpperCase(), cx-12, m.side==='buy' ? y-14 : y+26);
  }

  ctx.fillStyle = '#9aa3b2'; ctx.font = '12px Inter, Arial';
  if (n>0){
    const first = visible[0], mid = visible[Math.floor(n/2)], last = visible[n-1];
    ctx.fillText(new Date(first.time*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), startX, h-8);
    ctx.fillText(new Date(mid.time*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), startX + Math.floor(n/2)*step, h-8);
    ctx.fillText(new Date(last.time*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), w - PAD.right - 60, h-8);
  }
}
function drawAll(){ clear(); const range = computeRange(); drawGrid(range); drawCandlesAndMarkers(); }

/* ---------------- MARKET INFO ---------------- */
function updateMarketInfo(){
  const last = candles[candles.length-1];
  if (!last) return;
  const mid = last.close;
  const spread = (currentPair==='USDJPY') ? +(rnd(0.01,0.12)).toFixed(2) : +(rnd(0.00005,0.0009)).toFixed(5);
  const bid = +(mid - spread/2).toFixed(currentPair==='USDJPY'?3:5);
  const ask = +(mid + spread/2).toFixed(currentPair==='USDJPY'?3:5);
  const vol = Math.floor(Math.random()*1200 + 200);
  bidEl.textContent = bid; askEl.textContent = ask; spreadEl.textContent = currentPair==='USDJPY' ? (ask-bid).toFixed(3) : (ask-bid).toFixed(5); volEl.textContent = vol;
}

/* ---------------- SIMULATION ---------------- */
function rnd(a,b){ return a + Math.random()*(b-a); }

function tickUpdate(){
  if (paused) return;
  const last = candles[candles.length-1];
  const delta = (Math.random()-0.5) * (currentPair==='USDJPY' ? 0.02 : 0.00055);
  last.close = +(Math.max(0.0001, last.close + delta)).toFixed(currentPair==='USDJPY'?3:5);
  last.high = Math.max(last.high, last.close);
  last.low = Math.min(last.low, last.close);
  liveBadge.textContent = (currentPair==='USDJPY') ? last.close.toFixed(3) : last.close.toFixed(5);
  liveBadge.style.color = last.close >= last.open ? '#16a34a' : '#ef4444';
  updateMarketInfo();
  drawAll();
}

function finalizeCandle(){
  if (paused) return;
  const last = candles[candles.length-1];
  if (Math.random() < 0.22){
    const side = Math.random()>0.5 ? 'buy' : 'sell';
    markers.push({ time: last.time, price: +last.close, side });
    if (markers.length > 200) markers.shift();
    pushToast(`${side.toUpperCase()} executed`, `Price ${fmt(last.close)} • Mirrored`);
    pushNotification(genEmail(), `mirrored ${side} @ ${fmt(last.close)}`);
    // reward traders randomly when trade happens (makes leaderboard move)
    rewardRandomTrader(last.close);
  }
  if (Math.random() < 0.92) pushNotification(genEmail(), 'mirrored activity');

  const t = last.time + 60;
  const open = last.close;
  const volFactor = (currentPair==='USDJPY') ? 0.02 : 0.0018;
  const change = (Math.random()-0.5)*volFactor;
  const close = Math.max(0.0001, open + change);
  const high = Math.max(open, close) + Math.random()*0.0008 + (currentPair==='USDJPY'?0.02:0);
  const low = Math.min(open, close) - Math.random()*0.0008 - (currentPair==='USDJPY'?0.02:0);
  candles.push({ time: t, open:+open.toFixed((currentPair==='USDJPY')?3:5), high:+high.toFixed((currentPair==='USDJPY')?3:5), low:+low.toFixed((currentPair==='USDJPY')?3:5), close:+close.toFixed((currentPair==='USDJPY')?3:5) });
  if (candles.length > CANDLES_VISIBLE + 20) candles.shift();
  updateMarketInfo();
  drawAll();
}

/* ---------------- NOTIFICATIONS ---------------- */
function pushNotification(address, meta='mirrored activity'){
  const el = document.createElement('div'); el.className = 'notify enter';
  el.innerHTML = `<div class="notify-left"><div class="dot"></div><div><div class="address">${address}</div><div class="meta">${meta}</div></div></div><div style="font-size:12px;color:var(--muted)">${new Date().toLocaleTimeString()}</div>`;
  carouselList.appendChild(el);
  emailCount++; emailsCounter.textContent = 'Emails: ' + emailCount;
  lastTimeEl.textContent = new Date().toLocaleTimeString();
  if (carouselList.children.length > MAX_NOTIF) carouselList.removeChild(carouselList.firstElementChild);
}

/* ---------------- TOASTS ---------------- */
function pushToast(title, body, short=true){
  const t = document.createElement('div'); t.className='toast';
  t.innerHTML = `<div style="font-weight:800">${title}</div><div style="margin-top:6px;opacity:.95">${body}</div>`;
  toastsEl.insertBefore(t, toastsEl.firstChild);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-8px)'; setTimeout(()=> t.remove(),360); }, short?4200:6200);
}

/* ---------------- LEADERBOARD ---------------- */
function seedTraders(){
  const handles = NAME_POOL;
  traders = [];
  for (let i=0;i<8;i++){
    const h = handles[i % handles.length];
    const profit = +(50 + Math.random()*180).toFixed(2);
    const win = Math.floor(60 + Math.random()*35);
    const trades = Math.floor(40 + Math.random()*200);
    traders.push({ id:i+1, handle: '@' + h, profitPct: profit, winRate: win, trades: trades, lastProfit: profit });
  }
  sortTraders();
  renderLeaderboard(true);
}
function sortTraders(){
  traders.sort((a,b)=> b.profitPct - a.profitPct);
  traders.forEach((t, idx)=> t.rank = idx+1);
}
function renderLeaderboard(initial=false){
  const prevOrder = Array.from(lbRows.children).map(n => n.dataset.handle);
  lbRows.innerHTML = '';
  for (const t of traders){
    const row = document.createElement('div'); row.className = 'lb-row'; row.dataset.handle = t.handle;
    row.innerHTML = `
      <div class="lb-rank">${t.rank}</div>
      <div class="lb-handle">${t.handle}</div>
      <div class="lb-profit" style="color:${t.profitPct>=0? '#16a34a':'#ef4444'}">${t.profitPct.toFixed(2)}%</div>
      <div class="lb-win">${t.winRate}%</div>
      <div class="lb-trades">${t.trades}</div>
      <div class="lb-action"><button data-handle="${t.handle}" class="lb-btn">Mirror</button></div>
    `;
    lbRows.appendChild(row);
  }
  lbRows.querySelectorAll('.lb-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const handle = e.currentTarget.dataset.handle;
      pushToast('Top up now to mirror this trades', `Top up now to mirror ${handle}'s trades`, true);
      pushNotification(genEmail(), `mirrored ${handle} (manual)`);
    });
  });

  if (!initial && prevOrder.length){
    const newOrder = Array.from(lbRows.children).map(n=> n.dataset.handle);
    newOrder.forEach((h, idx) => {
      const prevIdx = prevOrder.indexOf(h);
      const node = lbRows.children[idx];
      if (prevIdx === -1) return;
      if (prevIdx > idx){ node.classList.add('up-move'); setTimeout(()=> node.classList.remove('up-move'), 900); }
      else if (prevIdx < idx){ node.classList.add('down-move'); setTimeout(()=> node.classList.remove('down-move'), 900); }
    });
  }
}
function leaderboardTick(){
  for (const t of traders){
    const change = (Math.random()-0.5) * (Math.random()*4);
    t.profitPct = Math.max(-50, +(t.profitPct + change).toFixed(2));
    if (Math.random() > 0.45) t.trades += Math.floor(Math.random()*3);
    if (Math.random() < 0.12) t.winRate = Math.max(40, Math.min(99, t.winRate + (Math.random()>0.5?1:-1)));
  }
  sortTraders();
  renderLeaderboard(false);
}
function rewardRandomTrader(price){
  const t = traders[Math.floor(Math.random()*traders.length)];
  if (!t) return;
  const bump = +( (Math.random()*3 + (Math.random()>0.6?2:0)).toFixed(2) );
  t.profitPct = +(t.profitPct + bump).toFixed(2);
  t.trades += Math.floor(1 + Math.random()*4);
  if (Math.random() < 0.35) pushNotification(genEmail(), `mirrored ${t.handle} @ ${fmt(price)}`);
  sortTraders(); renderLeaderboard(false);
}

/* ---------------- UI EVENTS ---------------- */
mirrorBtn.addEventListener('click', ()=>{
  pushToast('Top up now to mirror this trades', 'Top up now to mirror this trades', true);
  pushNotification(genEmail(), 'mirrored (mirror button)');
});
pauseBtn.addEventListener('click', ()=> {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pushToast(paused ? 'Feed paused' : 'Feed resumed', paused ? 'Live updates paused' : 'Live updates resumed', true);
});
pairSelect.addEventListener('change', (e)=>{
  currentPair = e.target.value;
  pairTitle.textContent = e.target.options[e.target.selectedIndex].text;
  candles = genHistory(currentPair);
  markers = [];
  drawAll();
});

/* ---------------- START ---------------- */
seedTraders();
setInterval(leaderboardTick, LB_UPDATE_MS);

setTimeout(()=> {
  if (container.clientHeight < 140) container.style.height = Math.max(window.innerHeight * 0.45, 380) + 'px';
  fitCanvas();
  updateMarketInfo();
  setInterval(tickUpdate, TICK_MS);
  setInterval(finalizeCandle, CANDLE_MS);
  setInterval(()=> pushNotification(genEmail(), 'mirrored activity'), NOTIFY_MS);
}, 60);

/* Expose */
window.FX_DEMO = { pushNotification, pushToast, candles, markers, traders };t t = last.time + 60;
  const open = last.close;
  const volFactor = (currentPair==='USDJPY') ? 0.02 : 0.0018;
  const change = (Math.random()-0.5)*volFactor;
  const close = Math.max(0.0001, open + change);
  const high = Math.max(open, close) + Math.random()*0.0008 + (currentPair==='USDJPY'?0.02:0);
  const low = Math.min(open, close) - Math.random()*0.0008 - (currentPair==='USDJPY'?0.02:0);
  candles.push({ time: t, open:+open.toFixed((currentPair==='USDJPY')?3:5), high:+high.toFixed((currentPair==='USDJPY')?3:5), low:+low.toFixed((currentPair==='USDJPY')?3:5), close:+close.toFixed((currentPair==='USDJPY')?3:5) });
  if (candles.length > CANDLES_VISIBLE + 20) candles.shift();
  updateMarketInfo();
  drawAll();
}

/* ---------------- NOTIFICATIONS ---------------- */
function pushNotification(address, meta='mirrored activity'){
  const el = document.createElement('div'); el.className = 'notify enter';
  el.innerHTML = `<div class="notify-left"><div class="dot"></div><div><div class="address">${address}</div><div class="meta">${meta}</div></div></div><div style="font-size:12px;color:var(--muted)">${new Date().toLocaleTimeString()}</div>`;
  carouselList.appendChild(el);
  emailCount++; emailsCounter.textContent = 'Emails: ' + emailCount;
  lastTimeEl.textContent = new Date().toLocaleTimeString();
  if (carouselList.children.length > MAX_NOTIF) carouselList.removeChild(carouselList.firstElementChild);
}

/* ---------------- TOASTS ---------------- */
function pushToast(title, body, short=true){
  const t = document.createElement('div'); t.className='toast';
  t.innerHTML = `<div style="font-weight:800">${title}</div><div style="margin-top:6px;opacity:.95">${body}</div>`;
  toastsEl.insertBefore(t, toastsEl.firstChild);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-8px)'; setTimeout(()=> t.remove(),360); }, short?4200:6200);
}

/* ---------------- LEADERBOARD ---------------- */
function seedTraders(){
  const handles = NAME_POOL;
  traders = [];
  for (let i=0;i<8;i++){
    const h = handles[i % handles.length];
    const profit = +(50 + Math.random()*180).toFixed(2);
    const win = Math.floor(60 + Math.random()*35);
    const trades = Math.floor(40 + Math.random()*200);
    traders.push({ id:i+1, handle: '@' + h, profitPct: profit, winRate: win, trades: trades, lastProfit: profit });
  }
  sortTraders();
  renderLeaderboard(true);
}
function sortTraders(){
  traders.sort((a,b)=> b.profitPct - a.profitPct);
  traders.forEach((t, idx)=> t.rank = idx+1);
}
function renderLeaderboard(initial=false){
  const prevOrder = Array.from(lbRows.children).map(n => n.dataset.handle);
  lbRows.innerHTML = '';
  for (const t of traders){
    const row = document.createElement('div'); row.className = 'lb-row'; row.dataset.handle = t.handle;
    row.innerHTML = `
      <div class="lb-rank">${t.rank}</div>
      <div class="lb-handle">${t.handle}</div>
      <div class="lb-profit" style="color:${t.profitPct>=0? '#16a34a':'#ef4444'}">${t.profitPct.toFixed(2)}%</div>
      <div class="lb-win">${t.winRate}%</div>
      <div class="lb-trades">${t.trades}</div>
      <div class="lb-action"><button data-handle="${t.handle}" class="lb-btn">Mirror</button></div>
    `;
    lbRows.appendChild(row);
  }
  lbRows.querySelectorAll('.lb-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const handle = e.currentTarget.dataset.handle;
      pushToast('Top up now to mirror this trades', `Top up now to mirror ${handle}'s trades`, true);
      pushNotification(genEmail(), `mirrored ${handle} (manual)`);
    });
  });

  if (!initial && prevOrder.length){
    const newOrder = Array.from(lbRows.children).map(n=> n.dataset.handle);
    newOrder.forEach((h, idx) => {
      const prevIdx = prevOrder.indexOf(h);
      const node = lbRows.children[idx];
      if (prevIdx === -1) return;
      if (prevIdx > idx){ node.classList.add('up-move'); setTimeout(()=> node.classList.remove('up-move'), 900); }
      else if (prevIdx < idx){ node.classList.add('down-move'); setTimeout(()=> node.classList.remove('down-move'), 900); }
    });
  }
}
function leaderboardTick(){
  // small nudges
  for (const t of traders){
    const change = (Math.random()-0.5) * (Math.random()*4);
    t.profitPct = Math.max(-50, +(t.profitPct + change).toFixed(2));
    if (Math.random() > 0.45) t.trades += Math.floor(Math.random()*3);
    if (Math.random() < 0.12) t.winRate = Math.max(40, Math.min(99, t.winRate + (Math.random()>0.5?1:-1)));
  }
  sortTraders();
  renderLeaderboard(false);
}
// Reward a random trader when a big trade happens (makes leaderboard more lively)
function rewardRandomTrader(price){
  const t = traders[Math.floor(Math.random()*traders.length)];
  if (!t) return;
  // add a bump to profit and trades
  const bump = +( (Math.random()*3 + (Math.random()>0.6?2:0)).toFixed(2) );
  t.profitPct = +(t.profitPct + bump).toFixed(2);
  t.trades += Math.floor(1 + Math.random()*4);
  // slight chance to push a mirrored notification for that trader
  if (Math.random() < 0.35) pushNotification(genEmail(), `mirrored ${t.handle} @ ${fmt(price)}`);
  sortTraders(); renderLeaderboard(false);
}

/* ---------------- UI EVENTS ---------------- */
mirrorBtn.addEventListener('click', ()=>{
  pushToast('Top up now to mirror this trades', 'Top up now to mirror this trades', true);
  pushNotification(genEmail(), 'mirrored (mirror button)');
});
pauseBtn.addEventListener('click', ()=> {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pushToast(paused ? 'Feed paused' : 'Feed resumed', paused ? 'Live updates paused' : 'Live updates resumed', true);
});
pairSelect.addEventListener('change', (e)=>{
  currentPair = e.target.value;
  pairTitle.textContent = e.target.options[e.target.selectedIndex].text;
  candles = genHistory(currentPair);
  markers = [];
  drawAll();
});

/* ---------------- START ---------------- */
seedTraders();
setInterval(leaderboardTick, LB_UPDATE_MS);

// start simulation timers
setTimeout(()=> {
  if (container.clientHeight < 140) container.style.height = Math.max(window.innerHeight * 0.45, 380) + 'px';
  fitCanvas();
  updateMarketInfo();
  setInterval(tickUpdate, TICK_MS);
  setInterval(finalizeCandle, CANDLE_MS);
  setInterval(()=> pushNotification(genEmail(), 'mirrored activity'), NOTIFY_MS);
}, 60);

/* Expose for debugging */
window.FX_DEMO = { pushNotification, pushToast, candles, markers, traders };
