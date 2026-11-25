/* Code Tiles — accounts, solo, multiplayer */
(() => {
const SUPABASE = { url: 'https://taugktxsoxjvospvugsz.supabase.co', key: 'sb_publishable__j-BvKxt03-gRKuMF0pcHg_hgRg4GxF' };
const EMAIL_DOMAIN = 'codetiles.local';

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d'), field = $('field'), msg = $('msg');
const LANES = 3, COL = ['#5cc8ff', '#c084fc', '#ffa657'], GLYPH = ['(', '[', '{'];
const FREEZE_BY_MODE = { 10: .5, 20: 1, 30: 1.5 }, TILE_H = 100, SLIDE_SPEED = 1000;
const LOG_MIN = { 10: 20, 20: 40, 30: 60 };   // runs below this are not worth a row
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

/* ---------- supabase ---------- */
let sb = null, me = null;           // me = { id, username }
function client() {
  if (!sb && window.supabase) sb = window.supabase.createClient(SUPABASE.url, SUPABASE.key, { realtime: { params: { eventsPerSecond: 20 } } });
  return sb;
}
const headers = () => ({ apikey: SUPABASE.key, Authorization: 'Bearer ' + (token || SUPABASE.key) });
let token = null;

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

/* ---------- game state ---------- */
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
  let q = SUPABASE.url + '/rest/v1/scores?select=name,score,user_id&mode=eq.' + mode + '&order=score.desc,created_at.asc&limit=10';
  const s = sinceIso(tab); if (s) q += '&created_at=gte.' + encodeURIComponent(s);
  const r = await fetch(q, { headers: headers() });
  if (!r.ok) throw new Error('board ' + r.status);
  const rows = await r.json(); cache[k] = { t: Date.now(), rows }; return rows;
}
// every run worth recording goes up automatically; returns a promise or null
function logRun(mode, sc, ms) {
  if (!me || !token || sc < (LOG_MIN[mode] || 0)) return null;
  for (const k in cache) delete cache[k];
  return fetch(SUPABASE.url + '/rest/v1/scores', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: me.id, name: me.username, mode, score: sc, misses: ms })
  }).then(r => r.ok ? 'ok' : 'fail').catch(() => 'fail');
}
function LB_HTML(body) {
  const tabs = '<div class="tabs">' + [['day', 'today'], ['week', 'this week'], ['all', 'all time']].map(t => '<button data-tab="' + t[0] + '"' + (lbTab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>').join('') + '</div>';
  return '<div id="lb"><div class="lbt">leaderboard <span>' + DURATION + 's mode</span></div>' + tabs + '<div id="lbbody">' + (body || '') + '</div></div>';
}
function renderLb() {
  const el = $('lb'); if (!el) return;
  el.outerHTML = LB_HTML('<div class="empty">loading\u2026</div>');
  const req = ++lbReq, mode = DURATION, tab = lbTab;
  fetchBoard(mode, tab).then(rows => {
    if (req !== lbReq) return; const b = $('lbbody'); if (!b) return;
    if (!rows.length) { b.innerHTML = '<div class="empty">no scores ' + (tab === 'day' ? 'today' : tab === 'week' ? 'this week' : 'yet') + '. be the first!</div>'; return; }
    b.innerHTML = '<ol>' + rows.map(r => '<li' + (me && r.user_id === me.id ? ' class="me"' : '') + '><span>' + esc((r.name || 'anon').slice(0, 16)) + '</span><b>' + (r.score | 0) + '</b></li>').join('') + '</ol>';
  }).catch(() => { const b = $('lbbody'); if (b) b.innerHTML = '<div class="empty">couldn\'t load the board</div>'; });
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#lb button[data-tab]');
  if (!b) return; lbTab = b.dataset.tab; ls.set('codeTilesLbTab', lbTab); renderLb(); field.focus();
});

/* ---------- mode picker ---------- */
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

/* ---------- screens ---------- */
function show(html) { msg.innerHTML = html; msg.style.display = 'flex'; }

/* ---------- accounts ---------- */
const emailFor = n => n.toLowerCase().replace(/[^a-z0-9_]/g, '') + '@' + EMAIL_DOMAIN;
async function loadSession() {
  const c = client(); if (!c) return false;
  const { data } = await c.auth.getSession();
  if (!data.session) return false;
  token = data.session.access_token;
  const uid = data.session.user.id;
  const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=eq.' + uid, { headers: headers() });
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) { await c.auth.signOut(); token = null; return false; }
  me = { id: rows[0].id, username: rows[0].username };
  return true;
}
function loginScreen(err, mode) {
  mode = mode || 'in';
  show('<h1>Code Tiles</h1>' +
    '<p>' + (mode === 'up' ? 'Pick a name and a password. No email, no recovery \u2014 lose the password and the account is gone.' : 'Sign in to keep your scores, banners and friends.') + '</p>' +
    '<div class="row"><input id="u" maxlength="16" placeholder="name" autocomplete="username"></div>' +
    '<div class="row"><input id="p" type="password" maxlength="64" placeholder="password" autocomplete="current-password"></div>' +
    (err ? '<div class="err">' + esc(err) + '</div>' : '') +
    '<div class="row"><button class="primary" id="doit">' + (mode === 'up' ? 'Create account' : 'Sign in') + '</button></div>' +
    '<div class="row"><button class="ghost" id="swap">' + (mode === 'up' ? 'I already have an account' : 'Create an account') + '</button></div>' +
    '<p>Passwords need 6 characters or more.</p>');
  $('swap').onclick = () => loginScreen('', mode === 'up' ? 'in' : 'up');
  const go = async () => {
    const u = ($('u').value || '').trim(), p = $('p').value || '';
    if (u.length < 2) return loginScreen('Name needs at least 2 characters.', mode);
    if (p.length < 6) return loginScreen('Password needs at least 6 characters.', mode);
    $('doit').disabled = true; $('doit').textContent = 'working\u2026';
    const c = client();
    try {
      if (mode === 'up') {
        const { data, error } = await c.auth.signUp({ email: emailFor(u), password: p });
        if (error) throw error;
        if (!data.session) throw new Error('That name is taken.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles', {
          method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ id: data.session.user.id, username: u })
        });
        if (!r.ok) { await c.auth.signOut(); token = null; throw new Error('That name is taken.'); }
        me = { id: data.session.user.id, username: u };
      } else {
        const { data, error } = await c.auth.signInWithPassword({ email: emailFor(u), password: p });
        if (error) throw new Error('Wrong name or password.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=eq.' + data.session.user.id, { headers: headers() });
        const rows = r.ok ? await r.json() : [];
        me = rows.length ? { id: rows[0].id, username: rows[0].username } : { id: data.session.user.id, username: u };
      }
      home();
    } catch (e) {
      loginScreen(e && e.message ? e.message : 'That did not work.', mode);
    }
  };
  $('doit').onclick = go;
  $('p').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('u').addEventListener('keydown', e => { if (e.key === 'Enter') $('p').focus(); });
  setTimeout(() => { const u = $('u'); if (u) u.focus(); }, 50);
}
async function signOut() { const c = client(); if (c) await c.auth.signOut(); me = null; token = null; MP.leave(); loginScreen('', 'in'); }

function home() {
  MP.leave(); running = false; started = false; freeze = 0; frozenTotal = 0; offset = 0; tiles = []; score = 0; timeLeft = DURATION;
  $('mpbar').style.display = 'none';
  show('<div id="mascot"></div><h1>Code Tiles</h1>' + MODES_HTML +
    '<p>Hit as many tiles as you can before the clock runs out.<br>Press the key for the <b>lowest</b> tile\'s lane.</p>' +
    '<div class="row"><button class="primary" id="go">Start</button><button class="ghost" id="mp">\u2694 Play a friend</button></div>' +
    KEYS_HTML() + LB_HTML() +
    '<p>Signed in as <b>' + esc(me ? me.username : '') + '</b> \u00b7 <a href="#" id="out" style="color:var(--dim)">sign out</a><br>' +
    'A wrong key <b style="color:#bfe8ff">freezes you</b> while the clock runs: 0.5s / 1s / 1.5s.<br><kbd>Space</kbd> start \u00b7 <kbd>R</kbd> restart \u00b7 <kbd>Esc</kbd> home</p>');
  $('go').onclick = () => startRun();
  $('mp').onclick = () => MP.menu();
  $('out').onclick = e => { e.preventDefault(); signOut(); };
  bindModes(); bindKeys(); setMode(DURATION); hud(); draw();
}

function soloResult(pb, logging) {
  const worth = score >= (LOG_MIN[DURATION] || 0);
  show('<div id="mascot"></div><h1>' + (pb ? 'New PB!' : 'Time!') + '</h1><div class="big">' + score + '</div>' +
    '<p>tiles in ' + DURATION + ' s \u00b7 ' + (score / DURATION).toFixed(1) + ' per second \u00b7 best ' + best +
    (frozenTotal > 0 ? '<br>projected without the ' + frozenTotal.toFixed(1) + ' s frozen: <b>' + (projected() || score) + '</b>' : '') + '</p>' +
    '<div id="logst" class="waiting">' + (worth ? 'logging\u2026' : 'too low to log (' + (LOG_MIN[DURATION]) + '+ gets a place)') + '</div>' +
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
const MP = {
  ch: null, code: '', host: false, roster: [], cfg: { format: 'shootout', mode: 20, teamSize: 1 },
  active: false, round: 0, wins: { A: 0, B: 0 }, history: [], roundScores: {}, myTeam: 'A', joinedAt: 0,

  leave() { if (this.ch) { try { this.ch.unsubscribe(); } catch (e) {} this.ch = null; } this.active = false; this.code = ''; this.host = false; this.roster = []; },

  menu() {
    this.leave(); running = false; $('mpbar').style.display = 'none';
    if (!client()) { show('<h1>Offline</h1><p>Multiplayer needs the network and it did not load. Try reloading.</p><button class="ghost" id="bk">Back</button>'); $('bk').onclick = home; return; }
    show('<h1>Play a friend</h1><p>One of you creates a lobby and reads out the code. The other types it in.</p>' +
      '<div class="row"><button class="primary" id="create">Create lobby</button></div>' +
      '<div class="row"><input id="code" maxlength="5" placeholder="CODE" style="text-transform:uppercase;width:110px;text-align:center;letter-spacing:4px;font-weight:800"><button class="ghost" id="join">Join</button></div>' +
      '<div id="mperr"></div><button class="ghost" id="bk">Back</button>');
    $('bk').onclick = home;
    $('create').onclick = () => this.create();
    $('join').onclick = () => { const c = ($('code').value || '').trim().toUpperCase(); if (c.length < 4) { $('mperr').innerHTML = '<span class="err">enter the 5-letter code</span>'; return; } this.join(c, false); };
    $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
    setTimeout(() => { const c = $('code'); if (c) c.focus(); }, 50);
  },

  create() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = ''; for (let i = 0; i < 5; i++) c += letters[Math.floor(Math.random() * letters.length)];
    this.join(c, true);
  },

  join(code, isHost) {
    const c = client(); if (!c) return;
    this.leave();
    this.code = code; this.host = isHost; this.joinedAt = Date.now();
    this.ch = c.channel('lobby-' + code, { config: { presence: { key: me.id }, broadcast: { self: true } } });
    this.ch
      .on('presence', { event: 'sync' }, () => this.syncRoster())
      .on('broadcast', { event: 'cfg' }, ({ payload }) => { if (!this.host) { this.cfg = payload; this.lobby(); } })
      .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart(payload))
      .on('broadcast', { event: 'score' }, ({ payload }) => this.onScore(payload))
      .on('broadcast', { event: 'result' }, ({ payload }) => this.onResult(payload))
      .on('broadcast', { event: 'home' }, () => { if (!this.host) { this.active = false; this.lobby(); } })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await this.ch.track({ pid: me.id, name: me.username, at: this.joinedAt, host: isHost });
          this.lobby();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          show('<h1>Connection lost</h1><p>Could not reach the lobby server.</p><button class="ghost" id="bk">Back</button>');
          $('bk').onclick = () => this.menu();
        }
      });
  },

  syncRoster() {
    if (!this.ch) return;
    const st = this.ch.presenceState(), list = [];
    Object.keys(st).forEach(k => { const m = st[k][0]; if (m && m.pid) list.push(m); });
    list.sort((a, b) => a.at - b.at || (a.pid < b.pid ? -1 : 1));
    this.roster = list;
    const i = list.findIndex(p => p.pid === me.id);
    this.myTeam = i < 0 ? 'A' : (i % 2 === 0 ? 'A' : 'B');
    if (!this.active) this.lobby();
  },
  teamOf(i) { return i % 2 === 0 ? 'A' : 'B'; },
  teamMembers(t) { return this.roster.filter((p, i) => this.teamOf(i) === t); },
  need() { return this.cfg.teamSize * 2; },

  lobby() {
    if (this.active) return;
    $('mpbar').style.display = 'none'; running = false;
    const need = this.need(), have = this.roster.length;
    const slot = (t, n) => {
      const mem = this.teamMembers(t); let h = '';
      for (let i = 0; i < n; i++) h += mem[i]
        ? '<div class="slot">' + esc(mem[i].name) + (mem[i].pid === me.id ? ' <span class="you">(you)</span>' : '') + '</div>'
        : '<div class="slot empty">waiting\u2026</div>';
      return h;
    };
    const fmt = (id, label) => '<button class="ghost fmtbtn' + (this.cfg.format === id ? ' on' : '') + '" data-fmt="' + id + '"' + (this.host ? '' : ' disabled') + '>' + label + '</button>';
    const sz = (n, label) => '<button class="ghost fmtbtn' + (this.cfg.teamSize === n ? ' on' : '') + '" data-sz="' + n + '"' + (this.host ? '' : ' disabled') + '>' + label + '</button>';
    show('<h2>Lobby</h2><div class="code">' + esc(this.code) + '</div>' +
      '<p>' + (this.host ? 'Give this code to your friends.' : 'Waiting for the host to start.') + '</p>' +
      '<div class="roster"><div class="team a"><h3>TEAM A</h3>' + slot('A', this.cfg.teamSize) + '</div>' +
      '<div class="team b"><h3>TEAM B</h3>' + slot('B', this.cfg.teamSize) + '</div></div>' +
      '<div class="row">' + sz(1, '1v1') + sz(2, '2v2') + '</div>' +
      '<div class="row">' + fmt('shootout', 'Shootout \u00b7 best of 5') + fmt('triathlon', '10/20/30 \u00b7 best of 3') + '</div>' +
      (this.cfg.format === 'shootout' ? '<div class="row">' + [10, 20, 30].map(m => '<button class="ghost fmtbtn' + (this.cfg.mode === m ? ' on' : '') + '" data-mode="' + m + '"' + (this.host ? '' : ' disabled') + '>' + m + 's</button>').join('') + '</div>' : '<p class="tag">one round each at 10s, 20s and 30s</p>') +
      (this.host ? '<button class="primary" id="startm"' + (have < need ? ' disabled' : '') + '>' + (have < need ? 'Waiting for players (' + have + '/' + need + ')' : 'Start match') + '</button>'
        : '<div class="waiting">' + have + '/' + need + ' players in</div>') +
      '<button class="ghost" id="bk">Leave</button>');
    $('bk').onclick = () => this.menu();
    if (this.host) {
      document.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { this.cfg.format = b.dataset.fmt; this.pushCfg(); });
      document.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { this.cfg.teamSize = +b.dataset.sz; this.pushCfg(); });
      document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.cfg.mode = +b.dataset.mode; this.pushCfg(); });
      const s = $('startm'); if (s) s.onclick = () => this.startMatch();
    }
  },
  pushCfg() { this.ch.send({ type: 'broadcast', event: 'cfg', payload: this.cfg }); this.lobby(); },

  roundMode(r) { return this.cfg.format === 'triathlon' ? [10, 20, 30][r] : this.cfg.mode; },
  totalRounds() { return this.cfg.format === 'triathlon' ? 3 : 5; },

  startMatch() { this.round = 0; this.wins = { A: 0, B: 0 }; this.history = []; this.nextRound(); },
  nextRound() {
    this.roundScores = {};
    this.ch.send({ type: 'broadcast', event: 'start', payload: { round: this.round, mode: this.roundMode(this.round), seed: (Math.random() * 1e9) | 0, wins: this.wins, history: this.history } });
  },
  onStart(p) {
    this.active = true; this.round = p.round; this.wins = p.wins || { A: 0, B: 0 }; this.history = p.history || [];
    this.roundScores = {};
    setMode(p.mode); this.bar(); audioOn();
    let n = 3;
    const tick = () => {
      if (n > 0) {
        show('<div id="count">' + n + '</div><p>Round ' + (this.round + 1) + ' of ' + this.totalRounds() + ' \u00b7 ' + p.mode + 's</p>');
        beep(440 + (3 - n) * 60, .12, 'triangle', .09); n--; setTimeout(tick, 1000);
      } else {
        beep(880, .25, 'triangle', .12);
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
    this.wins = p.wins; this.history = p.history; this.bar();
    const mine = this.myTeam, won = p.winner === mine, tie = p.winner === 'tie';
    const names = p.roster || [];
    const line = t => names.filter(n => n.team === t).map(n => esc(n.name) + ' <b>' + (p.scores[n.pid] | 0) + '</b>').join('<br>');
    const dec = this.cfg.teamSize > 1 ? 1 : 0;
    const pips = this.history.map(h => '<div class="pip ' + (h === 'tie' ? 'tie' : h.toLowerCase()) + '"></div>').join('') +
      Array(Math.max(0, this.totalRounds() - this.history.length)).fill('<div class="pip"></div>').join('');
    if (!p.done) {
      show('<h2>' + (tie ? 'Round tied' : won ? 'Round won' : 'Round lost') + '</h2>' +
        '<div class="vs"><div><div class="sc a">' + p.A.toFixed(dec) + '</div><div>' + line('A') + '</div></div><div>vs</div><div><div class="sc b">' + p.B.toFixed(dec) + '</div><div>' + line('B') + '</div></div></div>' +
        '<div class="pips">' + pips + '</div>' +
        '<p>Series: <b style="color:var(--acc)">' + this.wins.A + '</b> \u2013 <b style="color:#ffa657">' + this.wins.B + '</b></p>' +
        (this.host ? '<button class="primary" id="nx">Next round</button>' : '<div class="waiting">waiting for the host\u2026</div>'));
      if (this.host) $('nx').onclick = () => { this.round++; this.nextRound(); };
    } else {
      const champ = this.wins.A > this.wins.B ? 'A' : this.wins.B > this.wins.A ? 'B' : 'tie';
      show('<h1>' + (champ === 'tie' ? 'Match drawn' : champ === mine ? 'You win!' : 'You lose') + '</h1>' +
        '<div class="vs"><div class="sc a">' + this.wins.A + '</div><div>\u2013</div><div class="sc b">' + this.wins.B + '</div></div>' +
        '<div class="pips">' + pips + '</div>' +
        '<p>' + (this.cfg.format === 'triathlon' ? 'best of 3 \u00b7 10s, 20s, 30s' : 'best of 5 \u00b7 ' + this.cfg.mode + 's') + (this.cfg.teamSize > 1 ? ' \u00b7 2v2, team average' : '') + '</p>' +
        (this.host ? '<button class="primary" id="again">Back to lobby</button>' : '<div class="waiting">waiting for the host\u2026</div>') +
        '<button class="ghost" id="bk">Leave</button>');
      this.active = false;
      if (this.host) $('again').onclick = () => { this.ch.send({ type: 'broadcast', event: 'home', payload: {} }); this.lobby(); };
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
  if (e.target && e.target.tagName === 'INPUT') return;
  if (!me) return;
  if (listening >= 0) {
    e.preventDefault(); const k = e.key.toLowerCase();
    if (k === 'escape') { listening = -1; saveBinds(); return; }
    if (['enter', 'r', ' '].includes(k)) return;
    const other = BINDS.indexOf(k); if (other >= 0 && other !== listening) BINDS[other] = BINDS[listening];
    BINDS[listening] = k; saveBinds(); return;
  }
  if (e.key === 'Escape') { e.preventDefault(); home(); return; }
  if (!MP.active && e.key.toLowerCase() === 'r') { e.preventDefault(); startRun(); return; }
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
show('<h1>Code Tiles</h1><div class="waiting">loading\u2026</div>');
(async () => {
  for (let i = 0; i < 40 && !window.supabase; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.supabase) { show('<h1>Offline</h1><p>Could not reach the server. Reload to try again.</p>'); return; }
  const ok = await loadSession();
  if (ok) home(); else loginScreen('', 'in');
})();
})();
