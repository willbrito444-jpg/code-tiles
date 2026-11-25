/* Code Tiles — accounts, friends, solo, multiplayer */
(() => {
const SUPABASE = { url: 'https://taugktxsoxjvospvugsz.supabase.co', key: 'sb_publishable__j-BvKxt03-gRKuMF0pcHg_hgRg4GxF' };
const EMAIL_DOMAIN = 'codetiles.local';

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d'), field = $('field'), msg = $('msg');
const LANES = 3, COL = ['#5cc8ff', '#c084fc', '#ffa657'], GLYPH = ['(', '[', '{'];
const FREEZE_BY_MODE = { 10: .5, 20: 1, 30: 1.5 }, TILE_H = 100, SLIDE_SPEED = 1000;
const LOG_MIN = { 10: 1, 20: 1, 30: 1 };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let sb = null, me = null, token = null;
function client() {
  if (!sb && window.supabase) sb = window.supabase.createClient(SUPABASE.url, SUPABASE.key, { realtime: { params: { eventsPerSecond: 20 } } });
  return sb;
}
const headers = () => ({ apikey: SUPABASE.key, Authorization: 'Bearer ' + (token || SUPABASE.key) });
const jhead = () => ({ ...headers(), 'Content-Type': 'application/json' });

/* ---------- keybinds ---------- */
const DEFAULT_BINDS = ['g', 'h', 'j'];
let BINDS = [...DEFAULT_BINDS];
try { const s = JSON.parse(ls.get('codeTilesBinds', 'null')); if (Array.isArray(s) && s.length === 3) BINDS = s; } catch (e) {}
let listening = -1, KEY = {};
const keyLabel = k => k === ' ' ? 'spc' : k.replace('arrow', '').slice(0, 5);
function rebuildKeys() {
  KEY = { arrowleft: 0, arrowdown: 1, arrowright: 2 };
  BINDS.forEach((k, i) => KEY[k] = i);
  document.querySelectorAll('#pad button').forEach((b, i) => b.querySelector('small').textContent = keyLabel(BINDS[i]).toUpperCase());
}
const KEYS_HTML = () => '<div id="keys">keys: ' + [0, 1, 2].map(i => '<button data-k="' + i + '" style="color:' + COL[i] + '">' + keyLabel(BINDS[i]) + '</button>').join('') + '<button class="reset">reset</button></div>';
function bindKeys() {
  document.querySelectorAll('#keys button[data-k]').forEach(b => b.addEventListener('click', () => {
    listening = +b.dataset.k;
    document.querySelectorAll('#keys button').forEach(x => x.classList.remove('listen'));
    b.classList.add('listen'); b.textContent = '...';
  }));
  const r = document.querySelector('#keys button.reset');
  if (r) r.addEventListener('click', () => { BINDS = [...DEFAULT_BINDS]; saveBinds(); });
}
function saveBinds() {
  ls.set('codeTilesBinds', JSON.stringify(BINDS)); rebuildKeys();
  const k = $('keys'); if (k) { k.outerHTML = KEYS_HTML(); bindKeys(); }
  listening = -1; field.focus();
}

/* ---------- helpers ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let AC = null;
function beep(f, d = .08, type = 'square', g = .08) {
  if (!AC) return;
  try { const o = AC.createOscillator(), v = AC.createGain(); o.type = type; o.frequency.value = f; v.gain.setValueAtTime(g, AC.currentTime); v.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.connect(v).connect(AC.destination); o.start(); o.stop(AC.currentTime + d); } catch (e) {}
}
function audioOn() { try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (e) {} }
const NOTES = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659];

let W = 0, H = 0, dpr = 1;
function resize() { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
addEventListener('resize', resize); resize();
const laneX = l => l * W / LANES;
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ---------- game ---------- */
let DURATION = +ls.get('codeTilesMode', 30) || 30;
let tiles = [], score = 0, best = 0, timeLeft = DURATION, running = false, started = false, waitForFirstKey = true;
let last = 0, freeze = 0, frozenTotal = 0, misses = 0, wrongLane = -1, offset = 0, note = 0, lastLane = -1;
let rng = Math.random, onRoundEnd = null;
const FREEZE = () => FREEZE_BY_MODE[DURATION] || 1;

function loadBest() { best = +ls.get('codeTilesSprint' + DURATION, 0) || 0; $('best').textContent = best; }
function projected() { const active = (DURATION - timeLeft) - frozenTotal; return active > .5 ? Math.round(score / active * DURATION) : null; }
function hud() {
  $('score').textContent = score;
  const p = projected(); $('proj').textContent = p !== null ? '(' + p + ')' : '';
  const tm = $('timer'); tm.textContent = Math.max(0, timeLeft).toFixed(1);
  const low = running && timeLeft <= 5, warn = running && timeLeft > 5 && timeLeft <= 10;
  tm.classList.toggle('low', low); tm.classList.toggle('warn', warn);
  $('bgred').style.opacity = running ? Math.min(1, Math.max(0, (10 - timeLeft) / 10)) : 0;
}
function addTile() { let lane; do { lane = Math.floor(rng() * LANES); } while (lane === lastLane && rng() < .6); lastLane = lane; tiles.push(lane); }
function startRun(opts) {
  opts = opts || {};
  audioOn();
  rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
  onRoundEnd = opts.onEnd || null;
  waitForFirstKey = !opts.autoStart;
  tiles = []; score = 0; timeLeft = DURATION; freeze = 0; frozenTotal = 0; misses = 0; wrongLane = -1;
  offset = 0; note = 0; lastLane = -1;
  running = true; started = !!opts.autoStart; last = performance.now();
  for (let i = 0; i < 24; i++) addTile();
  msg.style.display = 'none'; hud(); resize(); field.focus();
  requestAnimationFrame(loop);
}
function press(l) {
  if (!running || freeze > 0) return;
  started = true;
  if (tiles[0] === l) {
    tiles.shift(); addTile(); score++; offset += TILE_H;
    beep(NOTES[note++ % NOTES.length], .1, 'triangle', .08);
    if (wrongLane >= 0) wrongLane = -1;
  } else { freeze = FREEZE(); misses++; wrongLane = l; beep(110, .3, 'sawtooth', .1); }
  hud();
}
function loop(now) {
  if (!running) return;
  const dt = Math.min((now - last) / 1000, .05); last = now;
  if (started) timeLeft -= dt;
  offset = Math.max(0, offset - SLIDE_SPEED * dt);
  if (freeze > 0) { frozenTotal += Math.min(freeze, dt); freeze -= dt; if (freeze <= 0) { freeze = 0; wrongLane = -1; } }
  hud(); draw();
  if (timeLeft <= 0) { timeLeft = 0; running = false; hud(); return finish(); }
  requestAnimationFrame(loop);
}
function finish() {
  beep(523, .15, 'triangle', .1); setTimeout(() => beep(659, .15, 'triangle', .1), 120); setTimeout(() => beep(784, .3, 'triangle', .1), 240);
  const pb = score > best;
  if (pb) { best = score; ls.set('codeTilesSprint' + DURATION, best); $('best').textContent = best; }
  const logging = logRun(DURATION, score, misses);
  if (onRoundEnd) { const cb = onRoundEnd; onRoundEnd = null; cb(score); return; }
  soloResult(pb, logging);
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  const lw = W / LANES;
  for (let l = 0; l < LANES; l++) {
    ctx.fillStyle = l % 2 ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,0)'; ctx.fillRect(laneX(l), 0, lw, H);
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(laneX(l), 0); ctx.lineTo(laneX(l), H); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const baseY = H * .65 - TILE_H / 2;
  ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, baseY - 4, W, TILE_H + 2);
  for (let i = 0; i < tiles.length; i++) {
    const y = baseY - i * TILE_H - offset; if (y + TILE_H < 0) break;
    const lane = tiles[i], x = laneX(lane) + 4, w = lw - 8, c = COL[lane];
    ctx.globalAlpha = i === 0 ? 1 : Math.max(.35, 1 - i * .12);
    const g = ctx.createLinearGradient(0, y, 0, y + TILE_H); g.addColorStop(0, c); g.addColorStop(1, c + '99');
    ctx.fillStyle = g; roundRect(x, y, w, TILE_H - 6, 10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = "800 40px 'JetBrains Mono',ui-monospace,monospace"; ctx.fillText(GLYPH[lane], x + w / 2, y + TILE_H / 2 - 3);
    if (i === 0 && freeze <= 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; roundRect(x, y, w, TILE_H - 6, 10); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.globalAlpha = 1;
  }
  ctx.font = "500 12px 'JetBrains Mono',ui-monospace,monospace"; ctx.fillStyle = 'rgba(255,255,255,.3)';
  BINDS.forEach((k, i) => ctx.fillText(keyLabel(k).toUpperCase(), laneX(i) + lw / 2, H - 14));
  if (!started && waitForFirstKey) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = "800 16px 'JetBrains Mono',ui-monospace,monospace"; ctx.fillText('press the first key to start the clock', W / 2, H * .9); }
  if (freeze > 0) {
    ctx.fillStyle = 'rgba(170,220,255,.22)'; ctx.fillRect(0, 0, W, H);
    const fr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .7);
    fr.addColorStop(0, 'rgba(220,245,255,0)'); fr.addColorStop(1, 'rgba(220,245,255,.55)'); ctx.fillStyle = fr; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.5;
    const cx = laneX(wrongLane >= 0 ? wrongLane : 1) + lw / 2, cy = H * .65;
    for (let i = 0; i < 9; i++) { const a = i * .7 + .3, len = 60 + ((i * 37) % 80); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = "800 26px 'JetBrains Mono',ui-monospace,monospace";
    [[.12, .12], [.88, .2], [.1, .8], [.9, .85], [.5, .08]].forEach(p => ctx.fillText('\u2744', W * p[0], H * p[1]));
    ctx.fillStyle = '#bfe8ff'; ctx.fillText('FROZEN', W / 2, H * .38);
    ctx.font = "800 64px 'JetBrains Mono',ui-monospace,monospace"; ctx.fillText(freeze.toFixed(1), W / 2, H * .5);
  }
}

/* ---------- scores ---------- */
let lbTab = ls.get('codeTilesLbTab', 'day'), lbReq = 0;
const cache = {};
function sinceIso(tab) {
  const d = new Date();
  if (tab === 'day') { d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (tab === 'week') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  return null;
}
async function fetchBoard(mode, tab) {
  const k = mode + '|' + tab, c = cache[k];
  if (c && Date.now() - c.t < 15000) return c.rows;
  let q = SUPABASE.url + '/rest/v1/scores?select=username,score,user_id&mode=eq.' + mode + '&order=score.desc,created_at.asc&limit=10';
  const s = sinceIso(tab); if (s) q += '&created_at=gte.' + encodeURIComponent(s);
  const r = await fetch(q, { headers: headers() });
  if (!r.ok) throw new Error('board ' + r.status);
  const rows = await r.json(); cache[k] = { t: Date.now(), rows }; return rows;
}
function logRun(mode, sc, ms) {
  if (!me || !token || sc < (LOG_MIN[mode] || 0)) return null;
  for (const k in cache) delete cache[k];
  const body = { user_id: me.id, username: me.username, mode, score: sc, misses: ms };
  if (MP && MP.cfg && MP.cfg.quick && MP.code && MP.active) { body.match_id = MP.code; body.round = MP.round; }
  return fetch(SUPABASE.url + '/rest/v1/scores', {
    method: 'POST', headers: { ...jhead(), Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  }).then(r => r.ok ? 'ok' : 'fail').catch(() => 'fail');
}
function LB_HTML(body) {
  const tabs = '<div class="tabs">' + [['day', 'today'], ['week', 'this week'], ['all', 'all time']].map(t => '<button data-tab="' + t[0] + '"' + (lbTab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>').join('') + '</div>';
  return '<div id="lb"><div class="lbt">leaderboard <span>' + DURATION + 's mode</span></div>' + tabs + '<div id="lbbody">' + (body || '') + '</div></div>';
}
// where the signed-in player stands among everyone, for the tab on screen
async function myRank(mode, tab) {
  if (!me || !token) return null;
  try {
    const r = await rpc('my_board_rank', { p_mode: mode, p_since: sinceIso(tab) });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.length ? rows[0] : null;
  } catch (e) { return null; }
}
function renderLb() {
  const el = $('lb'); if (!el) return;
  el.outerHTML = LB_HTML('<div class="empty">loading…</div>');
  const req = ++lbReq, mode = DURATION, tab = lbTab;
  fetchBoard(mode, tab).then(async rows => {
    if (req !== lbReq) return; const b = $('lbbody'); if (!b) return;
    b.innerHTML = rows.length
      ? '<ol>' + rows.map(r => '<li' + (me && r.user_id === me.id ? ' class="me"' : '') + '><span>' + esc((r.username || 'anon').slice(0, 16)) + '</span><b>' + (r.score | 0) + '</b></li>').join('') + '</ol>'
      : '<div class="empty">no scores ' + (tab === 'day' ? 'today' : tab === 'week' ? 'this week' : 'yet') + '. be the first!</div>';
    const mine = await myRank(mode, tab);
    if (req !== lbReq || !mine) return;
    const b2 = $('lbbody'); if (!b2) return;
    b2.insertAdjacentHTML('beforeend',
      (mine.rnk > rows.length ? '<div class="lbgap">⋯</div>' : '') +
      '<div class="myrank"><span class="rk">#' + mine.rnk + '</span><span class="nm">' + esc(me.username) + '</span><b>' + (mine.best | 0) + '</b></div>' +
      '<div class="rankof">of ' + mine.players + ' player' + (+mine.players === 1 ? '' : 's') + '</div>');
  }).catch(() => { const b = $('lbbody'); if (b) b.innerHTML = '<div class="empty">couldn\'t load the board</div>'; });
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#lb button[data-tab]');
  if (!b) return; lbTab = b.dataset.tab; ls.set('codeTilesLbTab', lbTab); renderLb(); field.focus();
});

/* ---------- modes ---------- */
const MODES_HTML = '<div id="modes"><button data-d="10"><span>\uD83C\uDFCE\uFE0F</span>10s</button><button data-d="20"><span>\uD83D\uDC07</span>20s</button><button data-d="30"><span>\uD83D\uDC22</span>30s</button></div>';
function setMode(d) {
  DURATION = d; ls.set('codeTilesMode', d);
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', +b.dataset.d === d));
  const m = $('mascot'); if (m) { m.textContent = { 10: '\uD83C\uDFCE\uFE0F', 20: '\uD83D\uDC07', 30: '\uD83D\uDC22' }[d]; m.className = 'm' + d; }
  loadBest(); timeLeft = DURATION; hud(); renderLb();
}
function bindModes() {
  document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', () => { setMode(+b.dataset.d); field.focus(); }));
}
function show(html, top) { msg.innerHTML = html; msg.className = top ? 'top' : ''; msg.style.display = 'flex'; }

/* ---------- friends ---------- */
let friends = [], online = new Set(), reqs = [];
const rpc = (fn, body) => fetch(SUPABASE.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: jhead(), body: JSON.stringify(body || {}) });
async function loadFriends() {
  if (!me) return [];
  try {
    const r = await fetch(SUPABASE.url + '/rest/v1/friends?select=friend_id&user_id=eq.' + me.id, { headers: headers() });
    const rows = await r.json();
    const ids = rows.map(x => x.friend_id);
    if (!ids.length) friends = [];
    else {
      const p = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=in.(' + ids.join(',') + ')', { headers: headers() });
      friends = await p.json();
    }
  } catch (e) { friends = []; }
  try { const q = await rpc('my_requests'); reqs = q.ok ? await q.json() : []; } catch (e) { reqs = []; }
  return friends;
}
async function sendRequest(name) {
  const r = await rpc('send_friend_request', { target: name });
  if (!r.ok) throw new Error('Could not send that');
  const out = (await r.json() + '').replace(/"/g, '');
  if (out === 'nouser') throw new Error('No player called ' + name);
  if (out === 'self') throw new Error('That is you.');
  if (out === 'already') throw new Error('Already friends.');
  return out;
}
async function acceptRequest(id) { await rpc('accept_friend_request', { req_from: id }); }
async function declineRequest(id, dir) {
  const q = dir === 'in' ? 'from_id=eq.' + id + '&to_id=eq.' + me.id : 'from_id=eq.' + me.id + '&to_id=eq.' + id;
  await fetch(SUPABASE.url + '/rest/v1/friend_requests?' + q, { method: 'DELETE', headers: headers() });
}
async function removeFriend(id) { await rpc('remove_friend', { other: id }); }
function FRIENDS_HTML(inLobby) {
  const incoming = reqs.filter(r => r.direction === 'in'), outgoing = reqs.filter(r => r.direction === 'out');
  const reqHtml = incoming.length ? '<div class="reqs">' + incoming.map(r =>
    '<div class="f"><div class="n">' + esc(r.username) + '</div>' +
    '<button class="small acc" data-acc="' + r.other_id + '">accept</button>' +
    '<button class="small" data-dec="' + r.other_id + '">\u00d7</button></div>').join('') + '</div>' : '';
  const list = friends.length ? friends.map(f => {
    const on = online.has(f.id);
    return '<div class="f"><div class="dot' + (on ? ' on' : '') + '"></div><div class="n">' + esc(f.username) + '</div>' +
      '<div class="bns"></div>' +
      (inLobby && on ? '<button class="small" data-inv="' + f.id + '">invite</button>' : '') +
      '<button class="small" data-unfriend="' + f.id + '" title="remove">\u00d7</button></div>';
  }).join('') : '<div class="empty">no friends yet \u2014 send someone a request</div>';
  const pend = outgoing.length ? '<div class="empty">pending: ' + outgoing.map(r => esc(r.username)).join(', ') + '</div>' : '';
  return '<div class="friends" id="fr"><h4>FRIENDS <span style="color:var(--dim);font-weight:500">' +
    (incoming.length ? '<b style="color:var(--gold)">' + incoming.length + ' request' + (incoming.length > 1 ? 's' : '') + '</b> \u00b7 ' : '') +
    friends.filter(f => online.has(f.id)).length + ' online</span></h4>' +
    reqHtml + list + pend +
    '<div class="addrow"><input id="fadd" maxlength="16" placeholder="REQUEST BY USERNAME" class="uc"><button class="small" id="fgo">send</button></div><div id="ferr"></div></div>';
}
function bindFriends(inLobby) {
  const go = $('fgo'), inp = $('fadd');
  if (go) go.onclick = async () => {
    const n = (inp.value || '').trim().toUpperCase(); if (!n) return;
    go.disabled = true;
    try {
      const out = await sendRequest(n);
      inp.value = '';
      if (out === 'sent') { const t = await findId(n); if (t) pingUser(t, 'friendreq'); }
      await loadFriends(); refreshFriends(inLobby);
      const er = $('ferr'); if (er) er.innerHTML = '<span class="ok">' + (out === 'friends' ? 'you are now friends' : 'request sent') + '</span>';
    } catch (e) { const er = $('ferr'); if (er) er.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; go.disabled = false; }
  };
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  document.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { b.disabled = true; await acceptRequest(b.dataset.acc); pingUser(b.dataset.acc, 'friendok'); await loadFriends(); refreshFriends(inLobby); });
  document.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => { b.disabled = true; await declineRequest(b.dataset.dec, 'in'); await loadFriends(); refreshFriends(inLobby); });
  document.querySelectorAll('[data-unfriend]').forEach(b => b.onclick = async () => { await removeFriend(b.dataset.unfriend); await loadFriends(); refreshFriends(inLobby); });
  document.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { MP.invite(b.dataset.inv); b.textContent = 'sent'; b.disabled = true; });
}
function refreshFriends(inLobby) {
  const el = $('fr'); if (!el) return;
  el.outerHTML = FRIENDS_HTML(inLobby); bindFriends(inLobby);
}

/* ---------- banners ---------- */
const TIERS = {
  10: [['bronze', 45], ['silver', 55], ['gold', 62], ['insane', 70]],
  20: [['bronze', 90], ['silver', 110], ['gold', 125], ['insane', 142]],
  30: [['bronze', 130], ['silver', 160], ['gold', 185], ['insane', 210]]
};
const MODE_ICON = { 10: '\uD83C\uDFCE\uFE0F', 20: '\uD83D\uDC07', 30: '\uD83D\uDC22' };
const bannerCache = {};
// badges and banners are cached hard, so any save has to drop the caches
function invalidateBanners() {
  for (const k in bannerCache) delete bannerCache[k];
  if (typeof MP !== 'undefined' && MP) MP.bannerKey = '';
}
async function fetchStats(ids) {
  if (!ids.length) return {};
  const key = ids.slice().sort().join(',');
  const c = bannerCache[key];
  if (c && Date.now() - c.t < 20000) return c.v;
  const r = await rpc('player_banners', { ids });
  const rows = r.ok ? await r.json() : [];
  const by = {};
  rows.forEach(x => {
    const b = (by[x.uid] = by[x.uid] || {});
    if (x.mode) b[x.mode] = x;
    if (x.og) b.og = x.og;
    if (x.duels) b.duels = x.duels;
  });
  bannerCache[key] = { t: Date.now(), v: by };
  return by;
}
// rarity, rarest last — the sort below puts the rarest banner first
const RARITY = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'og'];
const TIER_RARITY = ['common', 'uncommon', 'rare', 'epic'];
const GAMES_TIERS = [[10, 'common'], [100, 'uncommon'], [1000, 'rare']];
const DUEL_TIERS = [[10, 'common'], [50, 'uncommon'], [250, 'rare']];
const WORLD_MIN_PLAYERS = 1;
// every banner a player has actually earned, best tier per mode plus specials
function earnedBanners(st) {
  if (!st) return [];
  const out = [];
  let games = 0;
  [10, 20, 30].forEach(m => {
    const s = st[m]; if (!s) return;
    games += (s.games | 0);
    const counts = [s.c1, s.c2, s.c3, s.c4];
    for (let i = TIERS[m].length - 1; i >= 0; i--) {
      if (counts[i] > 0) { out.push({ id: 't' + m + i, rar: TIER_RARITY[i], label: s.best + ' ' + MODE_ICON[m] }); break; }
    }
    // a world placing is a standing among players, not a row on the board,
    // and it stays dark until there is a real field to place in
    if (s.rnk && s.rnk <= 100 && s.players >= WORLD_MIN_PLAYERS) out.push({ id: 'w' + m, rar: 'mythic', rnk: s.rnk, label: 'world #' + s.rnk + ' ' + MODE_ICON[m] });
  });
  for (let i = GAMES_TIERS.length - 1; i >= 0; i--) {
    if (games >= GAMES_TIERS[i][0]) { out.push({ id: 'g' + i, rar: GAMES_TIERS[i][1], label: GAMES_TIERS[i][0] + ' games 🎮' }); break; }
  }
  // duels won, derived server-side from the round rows themselves
  for (let i = DUEL_TIERS.length - 1; i >= 0; i--) {
    if ((st.duels | 0) >= DUEL_TIERS[i][0]) { out.push({ id: 'd' + i, rar: DUEL_TIERS[i][1], label: '1v1 winner ' + DUEL_TIERS[i][0] + 'x' }); break; }
  }
  if (st[30] && st[30].clean_best >= 130) out.push({ id: 'flawless', rar: 'common', label: '🧊 Flawless' });
  if (st[20] && st[20].clean_best >= 125) out.push({ id: 'untouch', rar: 'epic', label: '💎 Untouchable' });
  if (st[10] && st[10].best >= 62 && st[20] && st[20].best >= 125 && st[30] && st[30].best >= 185) out.push({ id: 'crown', rar: 'epic', label: '👑 Triple crown' });
  // one of the first 100 accounts ever made: numbered, permanent, finite
  if (st.og) out.push({ id: 'og', rar: 'og', label: 'OG #' + st.og });
  return out.sort((a, b) => RARITY.indexOf(b.rar) - RARITY.indexOf(a.rar));
}
// banners dress the whole lobby box; badges are the pills inside it
function earnedSkins(st) {
  const out = [{ id: 'none', cls: 'none', label: 'Plain' }];
  if (!st) return out;
  if (st.og) out.push({ id: 'og', cls: 'og', label: 'OG #' + st.og });
  const ranks = [10, 20, 30].map(m => st[m] && st[m].players >= WORLD_MIN_PLAYERS && st[m].rnk <= 100 ? st[m].rnk : 0).filter(Boolean);
  if (ranks.length) out.push({ id: 'world', cls: 'world', label: 'WORLD #' + Math.min.apply(null, ranks) });
  return out;
}
// only ever wear a banner you have actually earned
function pickSkin(st, id) {
  const all = earnedSkins(st);
  return all.find(x => x.id === id) || all[0];
}
function pickShown(all, shown) {
  if (!Array.isArray(shown)) return all.slice(0, 3);
  return shown.map(id => all.find(b => b.id === id)).filter(Boolean).slice(0, 3);
}
let myStats = {}, myShown = [], myBanner = 'none';
async function loadMyProfile() {
  if (!me) return;
  const by = await fetchStats([me.id]); myStats = by[me.id] || {};
  try {
    const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=shown,banner&id=eq.' + me.id, { headers: headers() });
    const rows = r.ok ? await r.json() : [];
    myShown = rows.length ? (rows[0].shown || null) : null;
    myBanner = rows.length && rows[0].banner ? rows[0].banner : 'none';
  } catch (e) { myShown = null; myBanner = 'none'; }
}
async function saveBanner(id) {
  myBanner = id;
  await fetch(SUPABASE.url + '/rest/v1/profiles?id=eq.' + me.id, { method: 'PATCH', headers: { ...jhead(), Prefer: 'return=minimal' }, body: JSON.stringify({ banner: id }) });
  invalidateBanners();
}
async function saveShown(list) {
  myShown = list;
  await fetch(SUPABASE.url + '/rest/v1/profiles?id=eq.' + me.id, { method: 'PATCH', headers: { ...jhead(), Prefer: 'return=minimal' }, body: JSON.stringify({ shown: list }) });
  invalidateBanners();
}
async function findId(name) {
  try { const r = await rpc('find_player', { q: name }); const rows = r.ok ? await r.json() : []; return rows.length ? rows[0].id : null; }
  catch (e) { return null; }
}
function pingUser(uid, event) {
  const c = client(); if (!c) return;
  const ch = c.channel('inv-' + uid);
  ch.subscribe(st => {
    if (st === 'SUBSCRIBED') {
      ch.send({ type: 'broadcast', event, payload: { from: me.username } });
      setTimeout(() => { try { ch.unsubscribe(); } catch (e) {} }, 1500);
    }
  });
}

/* ---------- presence + invites ---------- */
let onlineCh = null, invCh = null;
function startPresence() {
  const c = client(); if (!c || !me) return;
  if (onlineCh) { try { onlineCh.unsubscribe(); } catch (e) {} }
  onlineCh = c.channel('online', { config: { presence: { key: me.id } } });
  onlineCh.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(onlineCh.presenceState()));
    refreshFriends(!!MP.code);
  }).subscribe(s => { if (s === 'SUBSCRIBED') onlineCh.track({ id: me.id, name: me.username }); });
  if (invCh) { try { invCh.unsubscribe(); } catch (e) {} }
  invCh = c.channel('inv-' + me.id);
  invCh
    .on('broadcast', { event: 'invite' }, ({ payload }) => toastInvite(payload))
    .on('broadcast', { event: 'friendreq' }, ({ payload }) => toastMsg((payload && payload.from ? payload.from : 'Someone') + ' sent you a friend request'))
    .on('broadcast', { event: 'friendok' }, ({ payload }) => toastMsg((payload && payload.from ? payload.from : 'Someone') + ' accepted your friend request'))
    .subscribe();
}
async function toastMsg(text) {
  const t = toastEl(), d = document.createElement('div');
  d.className = 't';
  d.innerHTML = '<div>' + esc(text) + '</div><div class="row"><button class="small" data-x="1">OK</button></div>';
  t.appendChild(d);
  beep(620, .1, 'triangle', .08);
  d.querySelector('[data-x]').onclick = () => d.remove();
  setTimeout(() => d.remove(), 20000);
  await loadFriends(); refreshFriends(!!MP.code);
}
function toastEl() {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  return t;
}
function toastInvite(p) {
  if (!p || !p.code) return;
  const t = toastEl(), d = document.createElement('div');
  d.className = 't';
  d.innerHTML = '<div><b>' + esc(p.from || 'someone') + '</b> invited you to a lobby</div><div class="row"><button class="small" data-j="1">Join</button><button class="small" data-x="1">Dismiss</button></div>';
  t.appendChild(d);
  beep(660, .1, 'triangle', .09); setTimeout(() => beep(880, .12, 'triangle', .09), 110);
  d.querySelector('[data-j]').onclick = () => { d.remove(); MP.join(p.code, false); };
  d.querySelector('[data-x]').onclick = () => d.remove();
  setTimeout(() => d.remove(), 30000);
}

/* ---------- accounts ---------- */
const emailFor = n => n.toLowerCase().replace(/[^a-z0-9_]/g, '') + '@' + EMAIL_DOMAIN;
async function loadSession() {
  const c = client(); if (!c) return false;
  const { data } = await c.auth.getSession();
  if (!data.session) return false;
  token = data.session.access_token;
  const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=eq.' + data.session.user.id, { headers: headers() });
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) { await c.auth.signOut(); token = null; return false; }
  me = { id: rows[0].id, username: rows[0].username };
  return true;
}
function loginScreen(err, mode) {
  mode = mode || 'in';
  show('<h1 class="hero">Code Tiles</h1>' +
    '<p>' + (mode === 'up' ? 'Pick a username and a password. No email, no recovery \u2014 lose the password and the account is gone.' : 'Sign in to keep your scores, banners and friends.') + '</p>' +
    '<div class="row"><input id="u" maxlength="16" placeholder="USERNAME" autocomplete="username" class="uc"></div>' +
    '<div class="row"><input id="p" type="password" maxlength="64" placeholder="password" autocomplete="current-password"></div>' +
    (err ? '<div class="err">' + esc(err) + '</div>' : '') +
    '<div class="row"><button class="primary" id="doit">' + (mode === 'up' ? 'Create account' : 'Sign in') + '</button></div>' +
    '<div class="row"><button class="ghost" id="swap">' + (mode === 'up' ? 'I already have an account' : 'Create an account') + '</button></div>' +
    '<p>Passwords need 6 characters or more.</p>', true);
  $('swap').onclick = () => loginScreen('', mode === 'up' ? 'in' : 'up');
  const go = async () => {
    const u = ($('u').value || '').trim().toUpperCase(), p = $('p').value || '';
    if (u.length < 2) return loginScreen('Username needs at least 2 characters.', mode);
    if (!/^[A-Z0-9_]+$/.test(u)) return loginScreen('Usernames can use letters, numbers and _ only.', mode);
    if (p.length < 6) return loginScreen('Password needs at least 6 characters.', mode);
    $('doit').disabled = true; $('doit').textContent = 'working\u2026';
    const c = client();
    try {
      if (mode === 'up') {
        const { data, error } = await c.auth.signUp({ email: emailFor(u), password: p });
        if (error) throw error;
        if (!data.session) throw new Error('That username is taken.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles', { method: 'POST', headers: { ...jhead(), Prefer: 'return=representation' }, body: JSON.stringify({ id: data.session.user.id, username: u }) });
        if (!r.ok) { await c.auth.signOut(); token = null; throw new Error('That username is taken.'); }
        me = { id: data.session.user.id, username: u };
      } else {
        const { data, error } = await c.auth.signInWithPassword({ email: emailFor(u), password: p });
        if (error) throw new Error('Wrong username or password.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=eq.' + data.session.user.id, { headers: headers() });
        const rows = r.ok ? await r.json() : [];
        me = rows.length ? { id: rows[0].id, username: rows[0].username } : { id: data.session.user.id, username: u };
      }
      startPresence(); await loadFriends(); home();
    } catch (e) { loginScreen(e && e.message ? e.message : 'That did not work.', mode); }
  };
  $('doit').onclick = go;
  $('p').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('u').addEventListener('keydown', e => { if (e.key === 'Enter') $('p').focus(); });
  setTimeout(() => { const u = $('u'); if (u) u.focus(); }, 50);
}
async function signOut() {
  const c = client(); if (c) await c.auth.signOut();
  if (onlineCh) { try { onlineCh.unsubscribe(); } catch (e) {} onlineCh = null; }
  if (invCh) { try { invCh.unsubscribe(); } catch (e) {} invCh = null; }
  me = null; token = null; friends = []; MP.leave(); loginScreen('', 'in');
}

function home() {
  MP.leave(); running = false; started = false; freeze = 0; frozenTotal = 0; offset = 0; tiles = []; score = 0; timeLeft = DURATION;
  $('mpbar').style.display = 'none';
  show('<h1 class="hero">Code Tiles</h1><div id="mascot"></div>' + MODES_HTML +
    '<p>Hit as many tiles as you can before the clock runs out. Press the key for the <b>lowest</b> tile\'s lane.</p>' +
    '<div class="row"><button class="primary" id="go">Start</button><button class="ghost" id="mp">\u2694 Play a friend</button></div>' +
    '<div class="row"><button class="ghost" id="duel">\u2694 1v1</button></div>' +
    '<div class="row"><button class="ghost" id="prof">\uD83D\uDC64 Profile</button><button class="ghost" id="frs">\uD83D\uDC65 Friends' +
      (reqs.filter(r => r.direction === 'in').length ? ' <span class="rdy y">' + reqs.filter(r => r.direction === 'in').length + '</span>' : '') + '</button></div>' +
    KEYS_HTML() + LB_HTML() +
    '<p>Signed in as <b>' + esc(me ? me.username : '') + '</b> \u00b7 <a href="#" id="out" style="color:var(--dim)">sign out</a><br>' +
    'A wrong key <b style="color:#bfe8ff">freezes you</b>: 0.5s / 1s / 1.5s \u00b7 <kbd>Space</kbd> start \u00b7 <kbd>R</kbd> restart \u00b7 <kbd>Esc</kbd> home</p>', true);
  $('go').onclick = () => startRun();
  $('mp').onclick = () => MP.menu();
  $('duel').onclick = () => MP.duel();
  $('prof').onclick = () => profileScreen();
  $('frs').onclick = () => friendsScreen();
  $('out').onclick = e => { e.preventDefault(); signOut(); };
  bindModes(); bindKeys(); setMode(DURATION); hud(); draw();
}

function friendsScreen() {
  show('<h1>Friends</h1><p>Send a request by exact username. They have to accept before you are added.</p>' +
    FRIENDS_HTML(false) + '<button class="ghost" id="bk">Back</button>', true);
  bindFriends(false);
  $('bk').onclick = home;
}

async function profileScreen() {
  show('<h1>Profile</h1><div class="waiting">loading\u2026</div>', true);
  await loadMyProfile();
  const all = earnedBanners(myStats), chosen = pickShown(all, myShown).map(b => b.id);
  const skins = earnedSkins(myStats), wearing = pickSkin(myStats, myBanner).id;
  const skinList = skins.map(x => '<button class="bnpick skinpick' + (x.cls !== 'none' ? ' rb-' + x.cls : '') + (x.id === wearing ? ' on' : '') + '" data-s="' + x.id + '">' + x.label + '</button>').join('');
  const statLine = [10, 20, 30].map(m => {
    const s2 = myStats[m];
    return '<div class="f"><div class="n">' + MODE_ICON[m] + ' ' + m + 's</div><b>' + (s2 ? s2.best : '\u2014') + '</b></div>';
  }).join('');
  const next = [10, 20, 30].map(m => {
    const s2 = myStats[m], bb = s2 ? s2.best : 0;
    const nx = TIERS[m].find(t => bb < t[1]);
    return nx ? '<div class="empty">' + MODE_ICON[m] + ' next: <b>' + nx[1] + '</b> for ' + nx[0] + '</div>' : '<div class="empty">' + MODE_ICON[m] + ' every tier cleared</div>';
  }).join('');
  const bannerList = all.length
    ? all.map(b => '<button class="bnpick small r-' + b.rar + (chosen.includes(b.id) ? ' on' : '') + '" data-b="' + b.id + '">' + b.label + '</button>').join('')
    : '<div class="empty">no banners yet \u2014 they unlock from your scores</div>';
  show('<h1>Profile</h1><h2>' + esc(me.username) + '</h2>' +
    '<div class="cols" style="max-width:660px"><div class="colmain" style="min-width:280px">' +
      '<div class="friends"><h4>PERSONAL BESTS</h4>' + statLine + next + '</div>' +
    '</div><div class="colmain" style="min-width:280px">' +
      '<div class="friends"><h4>BADGES <span style="color:var(--dim);font-weight:500">pick up to 3</span></h4>' +
      '<div class="bnpicks">' + bannerList + '</div>' +
      '<div id="bsave" class="empty">these show under your username in the lobby</div></div>' +
      '<div class="friends"><h4>BANNER <span style="color:var(--dim);font-weight:500">pick one</span></h4>' +
      '<div class="bnpicks">' + skinList + '</div>' +
      '<div id="ssave" class="empty">this dresses your whole box in the lobby</div></div>' +
    '</div></div>' +
    '<button class="ghost" id="bk">Back</button>', true);
  $('bk').onclick = home;
  document.querySelectorAll('.skinpick').forEach(b => b.onclick = async () => {
    document.querySelectorAll('.skinpick').forEach(x => x.classList.toggle('on', x === b));
    $('ssave').innerHTML = '<span class="waiting">saving\u2026</span>';
    try { await saveBanner(b.dataset.s); $('ssave').innerHTML = '<span class="ok">saved \u2713</span>'; }
    catch (e) { $('ssave').innerHTML = '<span class="err">could not save</span>'; }
  });
  document.querySelectorAll('.bnpick:not(.skinpick)').forEach(b => b.onclick = async () => {
    const id = b.dataset.b;
    let list = [...document.querySelectorAll('.bnpick.on:not(.skinpick)')].map(x => x.dataset.b);
    if (list.includes(id)) list = list.filter(x => x !== id);
    else { if (list.length >= 3) { $('bsave').innerHTML = '<span class="err">three at a time \u2014 unpick one first</span>'; return; } list.push(id); }
    document.querySelectorAll('.bnpick:not(.skinpick)').forEach(x => x.classList.toggle('on', list.includes(x.dataset.b)));
    $('bsave').innerHTML = '<span class="waiting">saving\u2026</span>';
    try { await saveShown(list); $('bsave').innerHTML = '<span class="ok">saved \u2713</span>'; }
    catch (e) { $('bsave').innerHTML = '<span class="err">could not save</span>'; }
  });
}

function soloResult(pb, logging) {
  const worth = score >= (LOG_MIN[DURATION] || 0);
  show('<h1>' + (pb ? 'New PB!' : 'Time!') + '</h1><div class="big">' + score + '</div>' +
    '<p>tiles in ' + DURATION + ' s \u00b7 ' + (score / DURATION).toFixed(1) + ' per second \u00b7 best ' + best +
    (frozenTotal > 0 ? '<br>projected without the ' + frozenTotal.toFixed(1) + ' s frozen: <b>' + (projected() || score) + '</b>' : '') + '</p>' +
    '<div id="logst" class="waiting">' + (worth ? 'logging\u2026' : 'no tiles hit — nothing to log') + '</div>' +
    LB_HTML() + MODES_HTML +
    '<div class="row"><button class="primary" id="go">Again</button><button class="ghost" id="mp">\u2694 Play a friend</button></div>' +
    '<p><kbd>Space</kbd> again \u00b7 <kbd>Esc</kbd> home</p>');
  $('go').onclick = () => startRun();
  $('mp').onclick = () => MP.menu();
  bindModes(); setMode(DURATION);
  if (logging) logging.then(r => {
    const el = $('logst'); if (!el) return;
    el.innerHTML = r === 'ok' ? '<span class="ok">added to the leaderboard \u2713</span>' : '<span class="err">couldn\'t log that run</span>';
    if (r === 'ok') renderLb();
  });
}

/* ================= MULTIPLAYER ================= */
// one player's box: banner behind it, badges inside it
function playerCardHTML(name, sk, badges, isMe, ready) {
  const rib = sk && sk.cls !== 'none' ? '<span class="ribbon rb-' + sk.cls + '">' + sk.label + '</span>' : '';
  const bns = (badges || []).map(b => '<span class="bn r-' + b.rar + '">' + b.label + '</span>').join('');
  return '<div class="slot filled' + (sk && sk.cls !== 'none' ? ' bnr-' + sk.cls : '') + '">' + rib +
    '<div class="nm"><span>' + esc(name) + (isMe ? ' <span class="you">(you)</span>' : '') + '</span>' +
    (ready === null ? '' : '<span class="rdy ' + (ready ? 'y' : 'n') + '">' + (ready ? 'READY' : 'not ready') + '</span>') +
    '</div><div class="bns">' + bns + '</div></div>';
}
const MP = {
  ch: null, code: '', host: false, roster: [], cfg: { format: 'shootout', mode: 20, teamSize: 1 },
  phase: 'none', round: 0, wins: { A: 0, B: 0 }, history: [], roundScores: {}, myTeam: 'A', joinedAt: 0,
  ready: false, chat: [], lastResult: null,

  get active() { return this.phase === 'countdown' || this.phase === 'playing'; },
  leave() {
    this.qmStop();
    if (this.ch) { try { this.ch.unsubscribe(); } catch (e) {} this.ch = null; }
    this.phase = 'none'; this.code = ''; this.host = false; this.roster = []; this.chat = []; this.ready = false; this.advancing = false; this.bannerKey = '';
    clearTimeout(this._trackT); this._trackAt = 0;
  },

  menu() {
    this.leave(); running = false; $('mpbar').style.display = 'none';
    if (!client()) { show('<h1>Offline</h1><p>Multiplayer needs the network and it did not load. Try reloading.</p><button class="ghost" id="bk">Back</button>'); $('bk').onclick = home; return; }
    show('<h1>Play a friend</h1><p>Create a lobby and share the code, or invite a friend who is online.</p>' +
      '<div class="row"><button class="primary" id="create">Create lobby</button></div>' +
      '<div class="row"><input id="code" maxlength="5" placeholder="CODE" style="text-transform:uppercase;width:110px;text-align:center;letter-spacing:4px;font-weight:800"><button class="ghost" id="join">Join</button></div>' +
      '<div id="mperr"></div>' + FRIENDS_HTML(false) +
      '<button class="ghost" id="bk">Back</button>', true);
    $('bk').onclick = home;
    $('create').onclick = () => this.create();
    $('join').onclick = () => { const c = ($('code').value || '').trim().toUpperCase(); if (c.length < 4) { $('mperr').innerHTML = '<span class="err">enter the 5-letter code</span>'; return; } this.join(c, false); };
    $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
    bindFriends(false);
    setTimeout(() => { const c = $('code'); if (c) c.focus(); }, 50);
  },

  create() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = ''; for (let i = 0; i < 5; i++) c += letters[Math.floor(Math.random() * letters.length)];
    this.join(c, true);
  },

  // ---- quick match: queue for a mode, get paired with whoever else is waiting ----
  duel() {
    this.leave(); running = false; $('mpbar').style.display = 'none';
    if (!client()) { show('<h1>Offline</h1><p>1v1 needs the network.</p><button class="ghost" id="bk">Back</button>'); $('bk').onclick = home; return; }
    this.duelMode = this.duelMode || DURATION || 20;
    this.qmOff = true;
    this.renderDuel('idle');
  },
  // you on the left, VS, them on the right
  duelSides(state) {
    const inLobby = this.phase === 'lobby' && this.roster.length;
    const self = inLobby ? this.roster.find(x => x.pid === me.id) : null;
    const left = self
      ? playerCardHTML(self.name, (this.skins || {})[self.pid], (this.banners || {})[self.pid], true, !!self.ready)
      : playerCardHTML(me.username, pickSkin(myStats, myBanner), pickShown(earnedBanners(myStats), myShown), true, null);
    const foe = inLobby ? this.roster.find(x => x.pid !== me.id) : null;
    const right = foe
      ? playerCardHTML(foe.name, (this.skins || {})[foe.pid], (this.banners || {})[foe.pid], false, !!foe.ready)
      : state === 'searching'
        ? '<div class="slot empty searching">searching for an opponent\u2026</div>'
        : '<div class="slot empty">no opponent yet</div>';
    return '<div class="duel"><div class="dside">' + left + '</div><div class="vs">VS</div><div class="dside">' + right + '</div></div>';
  },
  renderDuel(state, err) {
    const modes = [10, 20, 30].map(m => '<button class="ghost fmtbtn' + (this.duelMode === m ? ' on' : '') + '" data-dm="' + m + '"' + (state === 'idle' ? '' : ' disabled') + '>' + MODE_ICON[m] + ' ' + m + 's</button>').join('');
    let action;
    if (state === 'idle') action = '<div class="row"><button class="primary" id="dfind">Find opponent</button></div>';
    else if (state === 'searching') action = '<div class="waiting">waiting for someone to join\u2026</div><div class="row"><button class="ghost" id="dcan">Cancel</button></div>';
    else action = '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Ready' : 'Ready up') + '</button></div>' +
      '<div class="waiting">the duel starts once you are both ready</div>';
    const main = '<div class="row">' + modes + '</div>' +
      this.duelSides(state) +
      (err ? '<div class="err">' + esc(err) + '</div>' : '') + action +
      '<button class="ghost" id="bk">' + (state === 'idle' ? 'Back' : 'Leave') + '</button>';
    show('<h1>1v1</h1><p class="tag">best of 3 \u00b7 random opponent</p>' +
      (state === 'found'
        ? '<div class="cols"><div class="colmain">' + main + '</div><div class="colside">' + this.CHAT_HTML() + '</div></div>'
        : main), true);
    $('bk').onclick = () => { this.qmStop(); this.leave(); home(); };
    document.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { this.duelMode = +b.dataset.dm; this.renderDuel('idle'); });
    const f = $('dfind'); if (f) f.onclick = () => this.search();
    const c = $('dcan'); if (c) c.onclick = () => { this.qmStop(); this.renderDuel('idle'); };
    const r = $('rdy'); if (r) r.onclick = () => this.setReady(!this.ready);
    if (state === 'found') this.bindChat();
  },
  async search() {
    const mode = this.duelMode;
    this.qmOff = false;
    this.renderDuel('searching');
    try {
      const res = await rpc('quick_match', { p_mode: mode });
      if (this.qmOff) return;
      const rows = res.ok ? await res.json() : [];
      const row = rows[0] || {};
      if (row.code) return this.startQuick(row.code, mode, false);
      this._queued = true;
      this.qmTick(mode);
    } catch (e) { this.renderDuel('idle', 'could not reach matchmaking'); }
  },
  qmTick(mode) {
    this._qmT = setTimeout(async () => {
      if (this.qmOff) return;
      try {
        const r = await rpc('quick_poll', {});
        const rows = r.ok ? await r.json() : [];
        const code = rows[0] && rows[0].code;
        if (code) { this._queued = false; return this.startQuick(code, mode, true); }
      } catch (e) {}
      this.qmTick(mode);
    }, 1500);
  },
  qmStop() {
    this.qmOff = true; clearTimeout(this._qmT);
    if (this._queued) { this._queued = false; try { rpc('quick_cancel', {}); } catch (e) {} }
  },
  // whoever was already waiting hosts, so both sides agree without negotiating
  startQuick(code, mode, isHost) {
    this.qmStop();
    this.join(code, isHost);
    this.cfg = { format: 'shootout', mode: mode, teamSize: 1, rounds: 3, quick: true };
  },

  invite(friendId) {
    const c = client(); if (!c || !this.code) return;
    const ch = c.channel('inv-' + friendId);
    ch.subscribe(s => {
      if (s === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'invite', payload: { code: this.code, from: me.username } });
        setTimeout(() => { try { ch.unsubscribe(); } catch (e) {} }, 1500);
      }
    });
  },

  join(code, isHost) {
    const c = client(); if (!c) return;
    this.leave();
    this.code = code; this.host = isHost; this.joinedAt = Date.now(); this.phase = 'lobby'; this.ready = false; this.chat = []; this.advancing = false; this.bannerKey = '';
    this.wins = { A: 0, B: 0 }; this.history = []; this.round = 0;
    this.ch = c.channel('lobby-' + code, { config: { presence: { key: me.id }, broadcast: { self: true } } });
    this.ch
      .on('presence', { event: 'sync' }, () => this.syncRoster())
      .on('broadcast', { event: 'cfg' }, ({ payload }) => { if (!this.host) { this.cfg = payload; this.lobby(); } })
      .on('broadcast', { event: 'chat' }, ({ payload }) => this.onChat(payload))
      .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart(payload))
      .on('broadcast', { event: 'score' }, ({ payload }) => this.onScore(payload))
      .on('broadcast', { event: 'result' }, ({ payload }) => this.onResult(payload))
      .on('broadcast', { event: 'home' }, () => { this.phase = 'lobby'; this.ready = false; this.track(); this.lobby(); })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') { await this.track(); this.lobby(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          show('<h1>Connection lost</h1><p>Could not reach the lobby server.</p><button class="ghost" id="bk">Back</button>');
          $('bk').onclick = () => this.menu();
        }
      });
  },
  _payload() { return { pid: me.id, name: me.username, at: this.joinedAt, host: this.host, ready: this.ready }; },
  track() {
    if (!this.ch) return;
    const now = Date.now(), gap = now - (this._trackAt || 0);
    clearTimeout(this._trackT);
    if (gap >= 250) { this._trackAt = now; return this.ch.track(this._payload()); }
    this._trackT = setTimeout(() => { if (!this.ch) return; this._trackAt = Date.now(); this.ch.track(this._payload()); }, 250 - gap);
  },
  setReady(v) { this.ready = v; this.track(); this.repaint(); },

  syncRoster() {
    if (!this.ch) return;
    const st = this.ch.presenceState(), list = [];
    Object.keys(st).forEach(k => { const m = st[k][0]; if (m && m.pid) list.push(m); });
    list.sort((a, b) => a.at - b.at || (a.pid < b.pid ? -1 : 1));
    this.roster = list;
    const i = list.findIndex(p => p.pid === me.id);
    this.myTeam = i < 0 ? 'A' : (i % 2 === 0 ? 'A' : 'B');
    this.repaint();
    this.loadRosterBanners();
    if (this.host && this.phase === 'between' && !this.advancing && this.allReady()) {
      this.advancing = true; this.round++; this.nextRound();
    }
    // a quick match has no lobby to sit in: start as soon as the pair is complete
    if (this.cfg.quick && this.host && this.phase === 'lobby' && !this.advancing && this.allReady()) {
      this.advancing = true; this.startMatch();
    }
  },
  teamOf(i) { return i % 2 === 0 ? 'A' : 'B'; },
  teamMembers(t) { return this.roster.filter((p, i) => this.teamOf(i) === t); },
  need() { return this.cfg.teamSize * 2; },
  allReady() { return this.roster.length >= this.need() && this.roster.every(p => p.ready); },
  repaint() { if (this.phase === 'lobby') this.lobby(); else if (this.phase === 'between' || this.phase === 'done') this.resultScreen(); },

  onChat(p) {
    if (!p) return;
    this.chat.push(p); if (this.chat.length > 60) this.chat.shift();
    const log = $('chatlog');
    if (log) { log.innerHTML = this.chatLines(); log.scrollTop = log.scrollHeight; }
    else this.repaint();
  },
  chatLines() {
    if (!this.chat.length) return '<div class="empty">no messages yet</div>';
    return this.chat.map(m => m.sys
      ? '<div class="m sys">' + esc(m.text) + '</div>'
      : '<div class="m"><b>' + esc(m.name) + '</b> ' + esc(m.text) + '</div>').join('');
  },
  CHAT_HTML() {
    return '<div class="chat"><h4>LOBBY CHAT</h4><div class="log" id="chatlog">' + this.chatLines() + '</div>' +
      '<form id="chatform"><input id="chatin" maxlength="160" placeholder="say something\u2026" autocomplete="off"><button type="submit">send</button></form></div>';
  },
  bindChat() {
    const f = $('chatform'); if (!f) return;
    f.onsubmit = e => {
      e.preventDefault();
      const i = $('chatin'), t = (i.value || '').trim();
      if (!t) return;
      i.value = '';
      this.ch.send({ type: 'broadcast', event: 'chat', payload: { name: me.username, text: t.slice(0, 160) } });
    };
    const log = $('chatlog'); if (log) log.scrollTop = log.scrollHeight;
  },

  banners: {},
  async loadRosterBanners() {
    const ids = this.roster.map(p => p.pid);
    if (!ids.length) return;
    const key = ids.slice().sort().join(',');
    if (this.bannerKey === key) return;
    this.bannerKey = key;
    try {
      const [stats, profs] = await Promise.all([
        fetchStats(ids),
        fetch(SUPABASE.url + '/rest/v1/profiles?select=id,shown,banner&id=in.(' + ids.join(',') + ')', { headers: headers() }).then(r => r.ok ? r.json() : [])
      ]);
      const shownBy = {}, wearing = {};
      profs.forEach(p => { shownBy[p.id] = p.shown; wearing[p.id] = p.banner || 'none'; });
      const out = {}, skins = {};
      ids.forEach(id => { out[id] = pickShown(earnedBanners(stats[id]), shownBy[id]); skins[id] = pickSkin(stats[id], wearing[id]); });
      this.banners = out; this.skins = skins;
      if (this.phase === 'lobby') this.lobby();
    } catch (e) {}
  },
  slotHTML(t, n) {
    const mem = this.teamMembers(t); let h = '';
    for (let i = 0; i < n; i++) {
      const p = mem[i];
      h += p
        ? playerCardHTML(p.name, (this.skins || {})[p.pid], (this.banners || {})[p.pid], p.pid === me.id, !!p.ready)
        : '<div class="slot empty">waiting for a player\u2026</div>';
    }
    return h;
  },

  lobby() {
    this.phase = 'lobby'; $('mpbar').style.display = 'none'; running = false;
    if (this.cfg.quick) return this.renderDuel('found');
    const need = this.need(), have = this.roster.length;
    const fmt = (id, label) => '<button class="ghost fmtbtn' + (this.cfg.format === id ? ' on' : '') + '" data-fmt="' + id + '"' + (this.host ? '' : ' disabled') + '>' + label + '</button>';
    const sz = (n, label) => '<button class="ghost fmtbtn' + (this.cfg.teamSize === n ? ' on' : '') + '" data-sz="' + n + '"' + (this.host ? '' : ' disabled') + '>' + label + '</button>';
    show('<h2>Lobby</h2><div class="code">' + esc(this.code) + '</div>' +
      '<div class="cols"><div class="colmain">' +
        '<div class="roster"><div class="team a"><h3>TEAM A</h3>' + this.slotHTML('A', this.cfg.teamSize) + '</div>' +
        '<div class="team b"><h3>TEAM B</h3>' + this.slotHTML('B', this.cfg.teamSize) + '</div></div>' +
        '<div class="row">' + sz(1, '1v1') + sz(2, '2v2') + '</div>' +
        '<div class="row">' + fmt('shootout', 'Shootout \u00b7 best of 5') + fmt('triathlon', '10/20/30 \u00b7 best of 3') + '</div>' +
        (this.cfg.format === 'shootout' ? '<div class="row">' + [10, 20, 30].map(m => '<button class="ghost fmtbtn' + (this.cfg.mode === m ? ' on' : '') + '" data-mode="' + m + '"' + (this.host ? '' : ' disabled') + '>' + m + 's</button>').join('') + '</div>' : '<p class="tag">one round each at 10s, 20s and 30s</p>') +
        '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Ready' : 'Ready up') + '</button>' +
        (this.host ? '<button class="primary" id="startm"' + (this.allReady() ? '' : ' disabled') + '>' + (have < need ? 'Waiting (' + have + '/' + need + ')' : this.allReady() ? 'Start match' : 'Waiting for ready') + '</button>' : '') + '</div>' +
        (this.host ? '' : '<div class="waiting">' + have + '/' + need + ' in \u00b7 host starts when everyone is ready</div>') +
        '<button class="ghost" id="bk">Leave</button>' +
      '</div><div class="colside">' + this.CHAT_HTML() + FRIENDS_HTML(true) + '</div></div>', true);
    $('bk').onclick = () => this.menu();
    $('rdy').onclick = () => this.setReady(!this.ready);
    if (this.host) {
      document.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { this.cfg.format = b.dataset.fmt; this.pushCfg(); });
      document.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { this.cfg.teamSize = +b.dataset.sz; this.pushCfg(); });
      document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.cfg.mode = +b.dataset.mode; this.pushCfg(); });
      const s = $('startm'); if (s) s.onclick = () => this.startMatch();
    }
    this.bindChat(); bindFriends(true);
  },
  pushCfg() { this.ch.send({ type: 'broadcast', event: 'cfg', payload: this.cfg }); this.lobby(); },

  roundMode(r) { return this.cfg.format === 'triathlon' ? [10, 20, 30][r] : this.cfg.mode; },
  totalRounds() { return this.cfg.format === 'triathlon' ? 3 : (this.cfg.rounds || 5); },

  startMatch() { this.round = 0; this.wins = { A: 0, B: 0 }; this.history = []; this.nextRound(); },
  nextRound() {
    this.roundScores = {};
    this.ch.send({ type: 'broadcast', event: 'start', payload: { round: this.round, mode: this.roundMode(this.round), seed: (Math.random() * 1e9) | 0, wins: this.wins, history: this.history } });
  },
  onStart(p) {
    this.advancing = false;
    this.phase = 'countdown'; this.round = p.round; this.wins = p.wins || { A: 0, B: 0 }; this.history = p.history || [];
    this.roundScores = {}; this.ready = false; this.track();
    setMode(p.mode); this.bar(); audioOn();
    let n = 3;
    const tick = () => {
      if (this.phase !== 'countdown') return;
      if (n > 0) {
        show('<div id="count">' + n + '</div><p>Round ' + (this.round + 1) + ' of ' + this.totalRounds() + ' \u00b7 ' + p.mode + 's</p>');
        beep(440 + (3 - n) * 60, .12, 'triangle', .09); n--; setTimeout(tick, 1000);
      } else {
        beep(880, .25, 'triangle', .12); this.phase = 'playing';
        startRun({ seed: p.seed, autoStart: true, onEnd: sc => this.submit(p.round, sc) });
      }
    };
    tick();
  },
  submit(round, sc) {
    show('<h2>' + sc + ' tiles</h2><div class="waiting">waiting for the others\u2026</div>');
    this.ch.send({ type: 'broadcast', event: 'score', payload: { round, pid: me.id, score: sc } });
  },
  onScore(p) {
    if (p.round !== this.round) return;
    this.roundScores[p.pid] = p.score;
    if (this.host && Object.keys(this.roundScores).length >= this.need()) this.tally();
  },
  tally() {
    const avg = t => { const m = this.teamMembers(t), v = m.map(x => this.roundScores[x.pid] || 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    const A = avg('A'), B = avg('B');
    const winner = A > B ? 'A' : B > A ? 'B' : 'tie';
    if (winner !== 'tie') this.wins[winner]++;
    this.history.push(winner);
    const need = Math.floor(this.totalRounds() / 2) + 1;
    const done = this.wins.A >= need || this.wins.B >= need || this.round + 1 >= this.totalRounds();
    this.ch.send({ type: 'broadcast', event: 'result', payload: { round: this.round, A, B, winner, wins: this.wins, history: this.history, done, scores: this.roundScores, roster: this.roster.map((p, i) => ({ pid: p.pid, name: p.name, team: this.teamOf(i) })) } });
  },
  onResult(p) {
    this.wins = p.wins; this.history = p.history; this.lastResult = p;
    this.phase = p.done ? 'done' : 'between';
    this.ready = false; this.track(); this.bar(); this.resultScreen();
  },
  resultScreen() {
    const p = this.lastResult; if (!p) return;
    const mine = this.myTeam, won = p.winner === mine, tie = p.winner === 'tie';
    const names = p.roster || [];
    const line = t => names.filter(n => n.team === t).map(n => esc(n.name) + ' <b>' + (p.scores[n.pid] | 0) + '</b>').join('<br>');
    const dec = this.cfg.teamSize > 1 ? 1 : 0;
    const pips = this.history.map(h => '<div class="pip ' + (h === 'tie' ? 'tie' : h.toLowerCase()) + '"></div>').join('') +
      Array(Math.max(0, this.totalRounds() - this.history.length)).fill('<div class="pip"></div>').join('');
    const readyList = this.roster.map(r => '<span class="rdy ' + (r.ready ? 'y' : 'n') + '">' + esc(r.name) + (r.ready ? ' \u2713' : '') + '</span>').join(' ');
    if (!p.done) {
      show('<h2>' + (tie ? 'Round tied' : won ? 'Round won' : 'Round lost') + '</h2>' +
        '<div class="cols"><div class="colmain">' +
        '<div class="vs"><div><div class="sc a">' + p.A.toFixed(dec) + '</div><div>' + line('A') + '</div></div><div>vs</div><div><div class="sc b">' + p.B.toFixed(dec) + '</div><div>' + line('B') + '</div></div></div>' +
        '<div class="pips">' + pips + '</div>' +
        '<p>Series: <b style="color:var(--acc)">' + this.wins.A + '</b> \u2013 <b style="color:#ffa657">' + this.wins.B + '</b></p>' +
        '<div class="row">' + readyList + '</div>' +
        '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Ready' : 'Ready for next round') + '</button></div>' +
        '<div class="waiting">next round starts when everyone is ready</div>' +
        '</div><div class="colside">' + this.CHAT_HTML() + '</div></div>', true);
      $('rdy').onclick = () => this.setReady(!this.ready);
      this.bindChat();
    } else {
      const champ = this.wins.A > this.wins.B ? 'A' : this.wins.B > this.wins.A ? 'B' : 'tie';
      show('<h1>' + (champ === 'tie' ? 'Match drawn' : champ === mine ? 'You win!' : 'You lose') + '</h1>' +
        '<div class="vs"><div class="sc a">' + this.wins.A + '</div><div>\u2013</div><div class="sc b">' + this.wins.B + '</div></div>' +
        '<div class="pips">' + pips + '</div>' +
        '<p>' + (this.cfg.format === 'triathlon' ? 'best of 3 \u00b7 10s, 20s, 30s' : 'best of 5 \u00b7 ' + this.cfg.mode + 's') + (this.cfg.teamSize > 1 ? ' \u00b7 2v2, team average' : '') + '</p>' +
        '<div class="row">' + (this.host ? '<button class="primary" id="again">Back to lobby</button>' : '<div class="waiting">waiting for the host\u2026</div>') +
        '<button class="ghost" id="bk">Leave</button></div>');
      if (this.host) $('again').onclick = () => { this.ch.send({ type: 'broadcast', event: 'home', payload: {} }); };
      $('bk').onclick = () => this.menu();
    }
  },
  bar() {
    const b = $('mpbar'); b.style.display = 'block';
    b.innerHTML = 'Round <b>' + (this.round + 1) + '/' + this.totalRounds() + '</b> \u00b7 series <b style="color:var(--acc)">' + this.wins.A + '</b>\u2013<b style="color:#ffa657">' + this.wins.B + '</b> \u00b7 you are <b>Team ' + this.myTeam + '</b> \u00b7 lobby <b>' + esc(this.code) + '</b>';
  }
};

/* ---------- input ---------- */
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!me) return;
  if (listening >= 0) {
    e.preventDefault(); const k = e.key.toLowerCase();
    if (k === 'escape') { listening = -1; saveBinds(); return; }
    if (['enter', 'r', ' '].includes(k)) return;
    const other = BINDS.indexOf(k); if (other >= 0 && other !== listening) BINDS[other] = BINDS[listening];
    BINDS[listening] = k; saveBinds(); return;
  }
  if (e.key === 'Escape') { e.preventDefault(); home(); return; }
  if (MP.phase === 'none' && e.key.toLowerCase() === 'r') { e.preventDefault(); startRun(); return; }
  const l = KEY[e.key.toLowerCase()];
  if (l !== undefined) { e.preventDefault(); press(l); return; }
  if (!running && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const g = $('go'); if (g) g.click(); }
});
field.addEventListener('pointerdown', e => {
  field.focus(); if (!running) return;
  const r = cv.getBoundingClientRect();
  press(Math.min(LANES - 1, Math.floor((e.clientX - r.left) / r.width * LANES)));
});
document.querySelectorAll('#pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); press(+b.dataset.l); field.focus(); }));

/* ---------- boot ---------- */
rebuildKeys();
show('<h1 class="hero">Code Tiles</h1><div class="waiting">loading\u2026</div>', true);
(async () => {
  for (let i = 0; i < 40 && !window.supabase; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.supabase) { show('<h1>Offline</h1><p>Could not reach the server. Reload to try again.</p>'); return; }
  const ok = await loadSession();
  if (ok) { startPresence(); await loadFriends(); await loadMyProfile(); home(); } else loginScreen('', 'in');
})();
})();
