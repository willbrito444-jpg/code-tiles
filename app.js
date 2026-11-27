/* Code Tiles — accounts, friends, solo, multiplayer */
(() => {
const SUPABASE = { url: 'https://taugktxsoxjvospvugsz.supabase.co', key: 'sb_publishable__j-BvKxt03-gRKuMF0pcHg_hgRg4GxF' };
const EMAIL_DOMAIN = 'codetiles.local';

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d'), field = $('field'), msg = $('msg');
const LANES = 3, COL = ['#5cc8ff', '#c084fc', '#ffa657'];
// a miss costs miss-rate x penalty, and the miss rate per second barely moves between
// modes, so the penalty alone sets the share of a round lost. 1.5s put 30s at 21.7%
// frozen against 13.5% for 20s; capping it at 1s brings the three into line.
const FREEZE_BY_MODE = { 10: .5, 20: 1, 30: 1 }, TILE_H = 100, SLIDE_SPEED = 1000;
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

/* ---------- tile icons ---------- */
// themes swap the glyphs only: lane colours and the dark glyph fill stay as they are
// m:1 marks a picture glyph, which ignores fillStyle — MONO draws it dark instead
const MONO = 'grayscale(1) brightness(.5) contrast(1.6)';
const THEMES = [
  { id: 'brackets', name: 'Brackets', g: ['(', '[', '{'] },
  { id: 'tags', name: 'Tags', g: ['<', '/', '>'] },
  { id: 'arrows', name: 'Arrows', g: ['←', '↓', '→'] },
  { id: 'shell', name: 'Shell', g: ['$', '~', '>'] },
  { id: 'logic', name: 'Logic', g: ['&', '|', '!'] },
  { id: 'math', name: 'Math', g: ['+', '-', '*'] },
  { id: 'dots', name: 'Punctuation', g: [';', ':', '.'] },
  { id: 'greek', name: 'Greek', g: ['π', 'λ', 'Ω'] },
  { id: 'calc', name: 'Calculus', g: ['∫', '∑', '√'] },
  { id: 'sets', name: 'Sets', g: ['∈', '∪', '∅'] },
  { id: 'cards', name: 'Cards', g: ['♠', '♥', '♦'] },
  { id: 'chess', name: 'Chess', g: ['♞', '♜', '♝'] },
  { id: 'pets', name: 'Pets', m: 1, g: ['🐱', '🐶', '🐰'] },
  { id: 'farm', name: 'Farm', m: 1, g: ['🐮', '🐷', '🐔'] },
  { id: 'wild', name: 'Wild', m: 1, g: ['🦊', '🐼', '🐸'] },
  { id: 'space', name: 'Space', m: 1, g: ['🌙', '⭐', '🪐'] },
  { id: 'food', name: 'Food', m: 1, g: ['🍕', '🍔', '🍩'] }
];
let GLYPH = ['(', '[', '{'], THEME = 'brackets', GMONO = false;
function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  THEME = t.id; GLYPH = t.g.slice(); GMONO = !!t.m;
  ls.set('codeTilesTheme', THEME);
  const pad = $('pad'); if (pad) pad.classList.toggle('mono', GMONO);
  document.querySelectorAll('#pad button').forEach((b, i) => { if (b.firstChild) b.firstChild.nodeValue = GLYPH[i]; });
}
const THEME_HTML = () => '<div id="thm" class="bnpicks">' + THEMES.map(t =>
  '<button class="thmpick' + (t.m ? ' mono' : '') + (THEME === t.id ? ' on' : '') + '" data-t="' + t.id + '">' +
  '<span class="thmg">' + t.g.map(g => '<i>' + esc(g) + '</i>').join('') + '</span>' +
  '<span class="thmn">' + t.name + '</span></button>').join('') + '</div>';
function bindTheme() {
  document.querySelectorAll('.thmpick').forEach(b => b.onclick = () => {
    applyTheme(b.dataset.t);
    document.querySelectorAll('.thmpick').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
}

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
// somebody turned up: two notes, so you hear it even if you looked away
function sfxFound() { beep(660, .1, 'triangle', .07); setTimeout(() => beep(990, .14, 'triangle', .07), 120); }
// one reusable slice of white noise: the grit behind drums, punches and clicks
let NOISE = null;
function noise(d, g, hp, lp) {
  if (!AC) return;
  try {
    if (!NOISE) {
      NOISE = AC.createBuffer(1, (AC.sampleRate * .4) | 0, AC.sampleRate);
      const a = NOISE.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    }
    const t = AC.currentTime, src = AC.createBufferSource(), v = AC.createGain();
    src.buffer = NOISE;
    let n = src;
    if (hp) { const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; n = n.connect(f); }
    if (lp) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n = n.connect(f); }
    v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(.0001, t + d);
    n.connect(v).connect(AC.destination); src.start(t); src.stop(t + d);
  } catch (e) {}
}
// a tone that slides from one pitch to another: thuds, pops, lasers
function swoop(f0, f1, d, type, g) {
  if (!AC) return;
  try {
    const t = AC.currentTime, o = AC.createOscillator(), v = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + d);
    v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(v).connect(AC.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}
const NOTES = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659];
// sound packs: a set of three, one sound per lane, chosen whole like the key sets.
// classic is the original climbing scale, so it is the one set that ignores the lane.
const SOUNDS = [
  { id: 'classic', name: 'Classic', i: '\uD83C\uDFB5', hit: () => beep(NOTES[note++ % NOTES.length], .1, 'triangle', .08) },
  { id: 'piano', name: 'Piano', i: '\uD83C\uDFB9', hit: l => { const f = [523.25, 659.25, 783.99][l];
      beep(f, .45, 'triangle', .09); beep(f * 2, .22, 'sine', .03); } },
  { id: 'drums', name: 'Drums', i: '\uD83E\uDD41', hit: l => { if (l === 0) swoop(155, 45, .18, 'sine', .15);
      else if (l === 1) { noise(.13, .10, 1400, 0); swoop(250, 170, .08, 'triangle', .06); }
      else noise(.05, .10, 7000, 0); } },
  { id: 'fight', name: 'Fight', i: '\uD83E\uDD4A', hit: l => { if (l === 0) { swoop(190, 60, .1, 'square', .11); noise(.06, .08, 300, 2200); }
      else if (l === 1) { swoop(120, 40, .16, 'sine', .13); noise(.09, .06, 200, 1500); }
      else { noise(.07, .10, 2500, 0); swoop(900, 300, .07, 'sawtooth', .04); } } },
  { id: 'pop', name: 'Pop', i: '\uD83E\uDEE7', hit: l => { const f = [420, 540, 680][l]; swoop(f * .55, f * 1.9, .07, 'sine', .14); } },
  { id: 'click', name: 'Click', i: '\u2328\uFE0F', hit: l => { noise(.022, .12, [2600, 3400, 4400][l], 0); beep([1500, 1800, 2200][l], .02, 'square', .045); } },
  { id: 'arcade', name: 'Arcade', i: '\uD83D\uDC7E', hit: l => { const f = [440, 587, 740][l]; swoop(f, f * 1.6, .07, 'square', .13); } },
  { id: 'laser', name: 'Laser', i: '\uD83D\uDEF8', hit: l => { const f = [1400, 1750, 2100][l]; swoop(f, f * .25, .14, 'sawtooth', .13); } }
];
let SOUND = 'classic';
function applySound(id) { SOUND = (SOUNDS.find(x => x.id === id) || SOUNDS[0]).id; ls.set('codeTilesSound', SOUND); }
function sfxHit(l) { (SOUNDS.find(x => x.id === SOUND) || SOUNDS[0]).hit(l); }
const SOUND_HTML = () => '<div id="snd" class="bnpicks">' + SOUNDS.map(t =>
  '<button class="thmpick sndpick' + (SOUND === t.id ? ' on' : '') + '" data-s="' + t.id + '">' +
  '<span class="sndi">' + t.i + '</span><span class="thmn">' + t.name + '</span></button>').join('') + '</div>';
function bindSound() {
  document.querySelectorAll('.sndpick').forEach(b => b.onclick = () => {
    audioOn(); applySound(b.dataset.s);
    document.querySelectorAll('.sndpick').forEach(x => x.classList.toggle('on', x === b));
    // play the set straight through, so you hear all three before committing to it
    [0, 1, 2].forEach(l => setTimeout(() => sfxHit(l), l * 150));
  });
}

let W = 0, H = 0, dpr = 1;
function resize() { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
addEventListener('resize', resize); resize();
const laneX = l => l * W / LANES;
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ---------- game ---------- */
let DURATION = +ls.get('codeTilesMode', 30) || 30;
// the tutorial drives the real field, so it has to be told not to record
let TUTOR = false;
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
  if (TUT.wait >= 0) return TUT.onKey(l);
  if (!running || freeze > 0) return;
  started = true;
  if (tiles[0] === l) {
    tiles.shift(); addTile(); score++; offset += TILE_H;
    sfxHit(l);
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
  // practice and the tutorial are inert: no row written, and your best does not move
  const inert = PRACTICE || TUTOR;
  const pb = !inert && score > best;
  if (pb) { best = score; ls.set('codeTilesSprint' + DURATION, best); $('best').textContent = best; }
  const logging = inert ? null : logRun(DURATION, score, misses);
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
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = "800 40px 'JetBrains Mono',ui-monospace,monospace";
    if (GMONO) ctx.filter = MONO;
    ctx.fillText(GLYPH[lane], x + w / 2, y + TILE_H / 2 - 3);
    if (GMONO) ctx.filter = 'none';
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
  // one call: the top 100 by player, plus your own row when you are below it
  const r = await rpc('board_top', { p_mode: mode, p_since: sinceIso(tab) });
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
  return '<div id="lb"><button class="lbt" id="lbopen">leaderboard <span>' + DURATION + 's mode ›</span></button>' + tabs + '<div id="lbbody">' + (body || '') + '</div></div>';
}
const NOSCORES = tab => 'no scores ' + (tab === 'day' ? 'today' : tab === 'week' ? 'this week' : 'yet') + '. be the first!';
function renderLb() {
  const el = $('lb'); if (!el) return;
  el.outerHTML = LB_HTML('<div class="empty">loading…</div>');
  const req = ++lbReq, mode = DURATION, tab = lbTab;
  fetchBoard(mode, tab).then(rows => {
    if (req !== lbReq) return; const b = $('lbbody'); if (!b) return;
    const top = rows.filter(r => r.rnk <= 10), mine = rows.find(r => r.mine);
    b.innerHTML = (top.length
      ? '<ol>' + top.map(r => '<li' + (r.mine ? ' class="me"' : '') + '><span>' + esc((r.username || 'anon').slice(0, 16)) + '</span><b>' + (r.best | 0) + '</b></li>').join('') + '</ol>'
      : '<div class="empty">' + NOSCORES(tab) + '</div>')
      + (mine && mine.rnk > 10
        ? '<div class="lbgap">⋯</div><div class="myrank"><span class="rk">#' + mine.rnk + '</span><span class="nm">' + esc(mine.username || '') + '</span><b>' + (mine.best | 0) + '</b></div>'
        : '');
  }).catch(() => { const b = $('lbbody'); if (b) b.innerHTML = '<div class="empty">couldn\'t load the board</div>'; });
}
// the full board: top 100 for one mode and one window, with you pinned under it
let bsMode = 0, bsTab = '';
function bbRow(r) {
  const n = r.rnk, cls = (n === 1 ? 'g' : n === 2 ? 's' : n === 3 ? 'b' : '') + (r.mine ? ' me' : '');
  return '<li class="' + cls.trim() + '"><span class="rk">#' + n + '</span><span class="nm">' +
    esc((r.username || 'anon').slice(0, 18)) + '</span><b>' + (r.best | 0) + '</b></li>';
}
function boardScreen(mode, tab) {
  bsMode = mode || bsMode || DURATION; bsTab = tab || bsTab || lbTab;
  running = false; $('mpbar').style.display = 'none';
  const modes = [10, 20, 30].map(m => '<button class="ghost fmtbtn' + (bsMode === m ? ' on' : '') + '" data-bm="' + m + '">' + MODE_ICON[m] + ' ' + m + 's</button>').join('');
  const tabs = [['day', 'today'], ['week', 'this week'], ['all', 'all time']].map(t => '<button class="ghost fmtbtn' + (bsTab === t[0] ? ' on' : '') + '" data-bt="' + t[0] + '">' + t[1] + '</button>').join('');
  show('<h1>Leaderboard</h1><p class="tag">top 100 runs · every game you log can place</p>' +
    '<div class="row">' + modes + '</div><div class="row">' + tabs + '</div>' +
    '<div id="bigboard"><div class="waiting">loading…</div></div>' +
    '<button class="ghost" id="bk">Back</button>', true);
  $('bk').onclick = home;
  document.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => boardScreen(+b.dataset.bm, bsTab));
  document.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => boardScreen(bsMode, b.dataset.bt));
  const req = ++lbReq, m = bsMode, t = bsTab;
  fetchBoard(m, t).then(rows => {
    if (req !== lbReq) return; const el = $('bigboard'); if (!el) return;
    const top = rows.filter(r => r.rnk <= 100), mine = rows.find(r => r.mine);
    el.innerHTML = (top.length
      ? '<ol class="bb">' + top.map(bbRow).join('') + '</ol>'
      : '<div class="empty">' + NOSCORES(t) + '</div>')
      + (mine && mine.rnk > 100 ? '<div class="lbgap">⋯</div><ol class="bb pinned">' + bbRow(mine) + '</ol>' : '');
  }).catch(() => { const el = $('bigboard'); if (el) el.innerHTML = '<div class="empty">couldn\'t load the board</div>'; });
}
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#lbopen')) return boardScreen(DURATION, lbTab);
  const b = e.target.closest('#lb button[data-tab]');
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
  const [r, pr] = await Promise.all([
    rpc('player_banners', { ids }),
    rpc('period_ranks', { ids, p_day: sinceIso('day'), p_week: sinceIso('week') })
  ]);
  const rows = r.ok ? await r.json() : [];
  const by = {};
  rows.forEach(x => {
    const b = (by[x.uid] = by[x.uid] || {});
    if (x.mode) b[x.mode] = x;
    if (x.og) b.og = x.og;
    if (x.duels) b.duels = x.duels;
  });
  (pr.ok ? await pr.json() : []).forEach(x => {
    const b = (by[x.uid] = by[x.uid] || {});
    const m = (b[x.mode] = b[x.mode] || {});
    m.rnk_d = x.rnk_d; m.rnk_w = x.rnk_w;
  });
  bannerCache[key] = { t: Date.now(), v: by };
  return by;
}
// rarity, rarest last — the sort below puts the rarest banner first
const RARITY = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'world', 'og'];
// the score tiers are still guesses pinned to one strong player's results, so a colour
// would be claiming a rarity nobody has earned yet. the tiers still sort the badges and
// still unlock them; they just render plain until there are enough players to calibrate.
// og and the world ranks keep their colour: those are measured against real players.
const RARITY_COLOURS = false;
const rarCls = b => (RARITY_COLOURS || b.rar === 'og' || b.rar === 'world') ? ' r-' + b.rar : '';
const TIER_RARITY = ['common', 'uncommon', 'rare', 'epic'];
const GAMES_TIERS = [[10, 'common'], [100, 'uncommon'], [1000, 'rare']];
const DUEL_TIERS = [[10, 'common'], [50, 'uncommon'], [250, 'rare']];
const WORLD_MIN_PLAYERS = 1;
let myPrevRank = {};
// a live standing, not a trophy: one per mode you place in, best first
function rankBadges(st, isMe) {
  const out = [];
  [10, 20, 30].forEach(m => {
    const s = st[m];
    if (!s) return;
    if (s.rnk && s.rnk <= 100 && s.players >= WORLD_MIN_PLAYERS) {
      const n = s.rnk;
      const band = n === 1 ? 'w1' : n === 2 ? 'w2' : n === 3 ? 'w3' : n <= 10 ? 'w10' : 'w100';
      const text = n === 1 ? '\ud83d\udc51 WORLD #1' : n <= 3 ? 'WORLD #' + n : n <= 10 ? 'TOP 10' : 'TOP 100';
      let delta = '';
      if (isMe) {
        const prev = myPrevRank[m] || 0;
        if (prev && prev !== n) delta = n < prev ? ' \u25b2' + (prev - n) : ' \u25bc' + (n - prev);
      }
      out.push({ id: 'w' + m, rar: 'world', per: '', band: band, rnk: n, mode: m, label: text + ' ' + MODE_ICON[m] + delta });
    }
    if (s.rnk_w && s.rnk_w <= 100) out.push({ id: 'k' + m, rar: 'world', per: 'w', band: 'wk', rnk: s.rnk_w, mode: m, label: 'WEEKLY #' + s.rnk_w + ' ' + MODE_ICON[m] });
    if (s.rnk_d && s.rnk_d <= 100) out.push({ id: 'd' + m, rar: 'world', per: 'd', band: 'wd', rnk: s.rnk_d, mode: m, label: 'DAILY #' + s.rnk_d + ' ' + MODE_ICON[m] });
  });
  // lifetime outranks a week, a week outranks a day
  const ord = { '': 0, w: 1, d: 2 };
  return out.sort((a, b) => ord[a.per] - ord[b.per] || a.rnk - b.rnk || a.mode - b.mode);
}
// 'none' hides it; an unset or stale choice falls back to your best placing
function pickWorld(all, choice) {
  const ws = all.filter(b => b.rar === 'world');
  if (choice === 'none') return null;
  return ws.find(w => w.id === choice) || ws[0] || null;
}
const wbHTML = b => '<span class="wb ' + b.band + '"><i class="lv"></i>' + b.label + '</span>';
// the world badge is status, so it sits outside the three-badge cap
function pickable(all) { return all.filter(b => b.rar !== 'world'); }
function visibleBadges(all, shown, worldChoice) {
  const w = pickWorld(all, worldChoice);
  return (w ? [w] : []).concat(pickShown(pickable(all), shown));
}
// every banner a player has actually earned, best tier per mode plus specials
function earnedBanners(st, isMe) {
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
  rankBadges(st, isMe).forEach(w => out.push(w));
  return out.sort((a, b) => RARITY.indexOf(b.rar) - RARITY.indexOf(a.rar));
}
// banners dress the whole lobby box; badges are the pills inside it
function earnedSkins(st, worldChoice) {
  const out = [{ id: 'none', cls: 'none', label: 'Plain' }];
  if (!st) return out;
  if (st.og) out.push({ id: 'og', cls: 'og', label: 'OG #' + st.og });
  // the banner follows the placing you chose to wear, so the mascot matches it
  const ws = rankBadges(st, false).filter(b => !b.per);
  if (ws.length) {
    const w = ws.find(x => x.id === worldChoice) || ws[0];
    out.push({ id: 'world', cls: 'world', modes: ws.map(x => x.mode).sort((a, b) => a - b), label: 'WORLD #' + w.rnk });
  }
  return out;
}
// only ever wear a banner you have actually earned
function pickSkin(st, id, worldChoice) {
  const all = earnedSkins(st, worldChoice);
  return all.find(x => x.id === id) || all[0];
}
function pickShown(all, shown) {
  if (!Array.isArray(shown)) return all.slice(0, 3);
  return shown.map(id => all.find(b => b.id === id)).filter(Boolean).slice(0, 3);
}
let myStats = {}, myShown = [], myBanner = 'none', myWorld = null;
async function loadMyProfile() {
  if (!me) return;
  const by = await fetchStats([me.id]); myStats = by[me.id] || {};
  [10, 20, 30].forEach(m => {
    const k = 'codeTilesRank' + m, cur = myStats[m] && myStats[m].rnk;
    myPrevRank[m] = +ls.get(k, 0) || 0;
    if (cur) ls.set(k, cur);
  });
  try {
    const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=shown,banner,world&id=eq.' + me.id, { headers: headers() });
    const rows = r.ok ? await r.json() : [];
    myShown = rows.length ? (rows[0].shown || null) : null;
    myBanner = rows.length && rows[0].banner ? rows[0].banner : 'none';
    myWorld = rows.length ? rows[0].world : null;
  } catch (e) { myShown = null; myBanner = 'none'; myWorld = null; }
}
async function saveWorld(id) {
  myWorld = id;
  await fetch(SUPABASE.url + '/rest/v1/profiles?id=eq.' + me.id, { method: 'PATCH', headers: { ...jhead(), Prefer: 'return=minimal' }, body: JSON.stringify({ world: id }) });
  invalidateBanners();
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
let ogLeft = null;
// how many of the first hundred accounts are still unclaimed
async function loadOgLeft() {
  try {
    const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id', { headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' } });
    const cr = r.headers.get('content-range') || '';
    const total = +(cr.split('/')[1] || 0);
    ogLeft = Math.max(0, 100 - total);
  } catch (e) { ogLeft = null; }
}
function topbarInner() {
  const n = online.size || 1;
  return '<span class="onl"><i></i>' + n + ' player' + (n === 1 ? '' : 's') + ' online</span>' +
    (ogLeft === null ? '' : '<span class="ogleft">' + (ogLeft > 0
      ? ogLeft + ' OG banner' + (ogLeft === 1 ? '' : 's') + ' left'
      : 'OG banners all claimed') + '</span>') +
    '<button class="inv" id="invlink">invite a friend</button>';
}
function bindTopbar() {
  const b = $('invlink'); if (!b) return;
  b.onclick = async () => {
    const url = location.origin + location.pathname;
    let ok = true;
    try { await navigator.clipboard.writeText(url); }
    catch (e) {
      const t = document.createElement('textarea');
      t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    b.textContent = ok ? 'copied!' : url;
    b.classList.toggle('ok', ok);
    setTimeout(() => { if (b.isConnected) { b.textContent = 'invite a friend'; b.classList.remove('ok'); } }, 1800);
  };
}
function refreshTopbar() {
  const t = $('topbar'); if (!t) return;
  const btn = $('invlink');
  if (btn && btn.classList.contains('ok')) return; // someone joining must not wipe "copied!"
  t.innerHTML = topbarInner(); bindTopbar();
}
let onlineCh = null, invCh = null;
function startPresence() {
  const c = client(); if (!c || !me) return;
  if (onlineCh) { try { onlineCh.unsubscribe(); } catch (e) {} }
  onlineCh = c.channel('online', { config: { presence: { key: me.id } } });
  onlineCh.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(onlineCh.presenceState()));
    refreshFriends(!!MP.code); refreshTopbar();
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
// supabase auth refuses anything under 6 characters, so a short password is padded past
// that floor. only passwords under 6 are touched, which is why every account made before
// this still signs in: those go through unchanged and still match their stored hash.
// NEVER change this string: every account with a short password is hashed against it.
const PW_PAD = '.ct-pad.2026';
const padPw = p => p.length >= 6 ? p : p + PW_PAD;
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
    '<p>Passwords need 4 characters or more.</p>', true);
  $('swap').onclick = () => loginScreen('', mode === 'up' ? 'in' : 'up');
  const go = async () => {
    const u = ($('u').value || '').trim().toUpperCase(), p = $('p').value || '';
    if (!u.length) return loginScreen('Enter a username.', mode);
    if (!/^[A-Z0-9_]+$/.test(u)) return loginScreen('Usernames can use letters, numbers and _ only.', mode);
    if (p.length < 4) return loginScreen('Password needs at least 4 characters.', mode);
    $('doit').disabled = true; $('doit').textContent = 'working\u2026';
    const c = client();
    try {
      if (mode === 'up') {
        const { data, error } = await c.auth.signUp({ email: emailFor(u), password: padPw(p) });
        if (error) throw error;
        if (!data.session) throw new Error('That username is taken.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles', { method: 'POST', headers: { ...jhead(), Prefer: 'return=representation' }, body: JSON.stringify({ id: data.session.user.id, username: u }) });
        if (!r.ok) { await c.auth.signOut(); token = null; throw new Error('That username is taken.'); }
        me = { id: data.session.user.id, username: u };
      } else {
        const { data, error } = await c.auth.signInWithPassword({ email: emailFor(u), password: padPw(p) });
        if (error) throw new Error('Wrong username or password.');
        token = data.session.access_token;
        const r = await fetch(SUPABASE.url + '/rest/v1/profiles?select=id,username&id=eq.' + data.session.user.id, { headers: headers() });
        const rows = r.ok ? await r.json() : [];
        me = rows.length ? { id: rows[0].id, username: rows[0].username } : { id: data.session.user.id, username: u };
      }
      startPresence(); await loadFriends(); home();
      // a new account has never seen the keys, let alone a duel
      if (mode === 'up') TUT.start();
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
  show('<div id="topbar">' + topbarInner() + '</div>' +
    '<div id="mecard" title="customise your banner and badges">' + meCardHTML() + '</div>' +
    '<h1 class="hero">Code Tiles</h1><div id="mascot"></div>' + MODES_HTML +
    '<p>Hit as many tiles as you can before the clock runs out. Press the key for the <b>lowest</b> tile\'s lane.</p>' +
    '<div class="row"><button class="primary" id="go">Start</button><button class="ghost" id="mp">\ud83c\udfdf\ufe0f Join / create a lobby</button></div>' +
    '<div class="row"><button class="ghost" id="duel">\ud83e\udd4a 1v1</button><button class="ghost" id="duel2">\u2694\uFE0F 2v2</button></div>' +
    '<div class="row"><button class="ghost" id="sett">\u2699\uFE0F Settings</button><button class="ghost" id="frs">\uD83D\uDC65 Friends' +
      (reqs.filter(r => r.direction === 'in').length ? ' <span class="rdy y">' + reqs.filter(r => r.direction === 'in').length + '</span>' : '') + '</button></div>' +
    KEYS_HTML() + LB_HTML() +
    '<p>Signed in as <b>' + esc(me ? me.username : '') + '</b> \u00b7 <a href="#" id="out" style="color:var(--dim)">sign out</a><br>' +
    'A wrong key <b style="color:#bfe8ff">freezes you</b>: 0.5s / 1s / 1s \u00b7 <kbd>Space</kbd> start \u00b7 <kbd>R</kbd> restart \u00b7 <kbd>Esc</kbd> home<br>' +
    'New here? <a href="#" id="tut" style="color:var(--acc)">run the tutorial</a></p>', true);
  $('go').onclick = () => startRun();
  $('tut').onclick = e => { e.preventDefault(); TUT.start(); };
  $('mp').onclick = () => MP.menu();
  $('duel').onclick = () => MP.duel(1);
  $('duel2').onclick = () => MP.duel(2);
  $('sett').onclick = () => settingsScreen();
  $('frs').onclick = () => friendsScreen();
  $('mecard').onclick = () => profileScreen();
  $('out').onclick = e => { e.preventDefault(); signOut(); };
  bindModes(); bindKeys(); bindTopbar(); setMode(DURATION); hud(); draw();
  loadOgLeft().then(refreshTopbar);
  // your own box, live: a rank can move while you are on another screen
  loadMyProfile().then(() => { const el = $('mecard'); if (el) el.innerHTML = meCardHTML(); });
}

// the home card is your lobby box exactly as others see it, minus the "(you)"
function meCardHTML() {
  return playerCardHTML(me ? me.username : '', pickSkin(myStats, myBanner, myWorld),
    visibleBadges(earnedBanners(myStats, true), myShown, myWorld), false, null) +
    '<div class="hint">tap to customise</div>';
}

function settingsScreen() {
  show('<h1>Settings</h1>' +
    '<div class="cols" style="max-width:620px"><div class="colmain" style="min-width:300px">' +
      '<div class="friends"><h4>TILE ICONS</h4>' + THEME_HTML() +
      '<div class="empty">changes the glyph on the tiles only — lanes keep their colours</div></div>' +
      '<div class="friends"><h4>HIT SOUND</h4>' + SOUND_HTML() +
      '<div class="empty">each set has its own sound per lane \u2014 pick one to hear it</div></div>' +
      '<div class="friends"><h4>KEYS</h4>' + KEYS_HTML() +
      '<div class="empty">click a key, then press the one you want</div></div>' +
    '</div></div>' +
    '<button class="ghost" id="bk">Back</button>', true);
  bindTheme(); bindSound(); bindKeys();
  $('bk').onclick = home;
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
  const all = earnedBanners(myStats, true), picks = pickable(all);
  const worlds = all.filter(b => b.rar === 'world');
  const curW = (pickWorld(all, myWorld) || {}).id || 'none';
  const worldList = worlds.map(w => '<button class="wpick' + (curW === w.id ? ' on' : '') + '" data-w="' + w.id + '">' + wbHTML(w) + '</button>').join('') +
    '<button class="bnpick small wpick' + (curW === 'none' ? ' on' : '') + '" data-w="none">hide</button>';
  const chosen = pickShown(picks, myShown).map(b => b.id);
  const skins = earnedSkins(myStats, myWorld), wearing = pickSkin(myStats, myBanner, myWorld).id;
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
    ? picks.map(b => '<button class="bnpick small' + rarCls(b) + (chosen.includes(b.id) ? ' on' : '') + '" data-b="' + b.id + '">' + b.label + '</button>').join('')
    : '<div class="empty">no banners yet \u2014 they unlock from your scores</div>';
  show('<h1>Profile</h1><h2>' + esc(me.username) + '</h2>' +
    '<div class="cols" style="max-width:660px"><div class="colmain" style="min-width:280px">' +
      '<div class="friends"><h4>PERSONAL BESTS</h4>' + statLine + next + '</div>' +
    '</div><div class="colmain" style="min-width:280px">' +
      '<div class="friends"><h4>BADGES <span style="color:var(--dim);font-weight:500">pick up to 3</span></h4>' +
      (worlds.length ? '<div class="bnpicks">' + worldList + '</div><div id="wsave" class="empty">pick which placing to show \u2014 it costs you no slot</div>' : '') +
      '<div class="bnpicks">' + bannerList + '</div>' +
      '<div id="bsave" class="empty">these show under your username in the lobby</div></div>' +
      '<div class="friends"><h4>BANNER <span style="color:var(--dim);font-weight:500">pick one</span></h4>' +
      '<div class="bnpicks">' + skinList + '</div>' +
      '<div id="ssave" class="empty">this dresses your whole box in the lobby</div></div>' +
    '</div></div>' +
    '<button class="ghost" id="bk">Back</button>', true);
  $('bk').onclick = home;
  document.querySelectorAll('.wpick').forEach(b => b.onclick = async () => {
    document.querySelectorAll('.wpick').forEach(x => x.classList.toggle('on', x === b));
    $('wsave').innerHTML = '<span class="waiting">saving\u2026</span>';
    try { await saveWorld(b.dataset.w); $('wsave').innerHTML = '<span class="ok">saved \u2713</span>'; }
    catch (e) { $('wsave').innerHTML = '<span class="err">could not save</span>'; }
  });
  document.querySelectorAll('.skinpick').forEach(b => b.onclick = async () => {
    document.querySelectorAll('.skinpick').forEach(x => x.classList.toggle('on', x === b));
    $('ssave').innerHTML = '<span class="waiting">saving\u2026</span>';
    try { await saveBanner(b.dataset.s); $('ssave').innerHTML = '<span class="ok">saved \u2713</span>'; }
    catch (e) { $('ssave').innerHTML = '<span class="err">could not save</span>'; }
  });
  document.querySelectorAll('.bnpick[data-b]').forEach(b => b.onclick = async () => {
    const id = b.dataset.b;
    let list = [...document.querySelectorAll('.bnpick[data-b].on')].map(x => x.dataset.b);
    if (list.includes(id)) list = list.filter(x => x !== id);
    else { if (list.length >= 3) { $('bsave').innerHTML = '<span class="err">three at a time \u2014 unpick one first</span>'; return; } list.push(id); }
    document.querySelectorAll('.bnpick[data-b]').forEach(x => x.classList.toggle('on', list.includes(x.dataset.b)));
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
    '<div class="row"><button class="primary" id="go">Again</button><button class="ghost" id="mp">\ud83c\udfdf\ufe0f Join / create a lobby</button></div>' +
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
// long enough to read an opponent's card before the countdown takes over
const REVEAL_MS = 1900;
const MASCOT = { 10: '\uD83C\uDFCE\uFE0F', 20: '\uD83D\uDC07', 30: '\uD83D\uDC22' };
// share of the cycle each one spends crossing: the car is quick, the turtle is not
const TRAVEL = { 10: .10, 20: .19, 30: .33 };
// they cross one at a time with a breather between, then the whole cycle repeats
function mascotHTML(modes) {
  if (!modes || !modes.length) return '';
  const cycle = 7 * modes.length + 4;
  let at = 0;
  const els = modes.map(m => {
    const h = '<i class="ms ms' + m + '" style="animation-duration:' + cycle + 's;animation-delay:' + at.toFixed(2) + 's"><b>' + MASCOT[m] + '</b></i>';
    at += cycle * TRAVEL[m] + 2.4;
    return h;
  }).join('');
  return '<span class="mascots">' + els + '</span>';
}
// the ribbon stacks: the word on top, larger, the number under it.
// a long word (WORLD) is set smaller, or it outgrows the strip it sits in
function ribLines(label) {
  const i = label.indexOf(' ');
  if (i < 0) return '<b>' + esc(label) + '</b>';
  const w = label.slice(0, i);
  return '<b' + (w.length > 3 ? ' class="lng"' : '') + '>' + esc(w) + '</b><i>' + esc(label.slice(i + 1)) + '</i>';
}
function playerCardHTML(name, sk, badges, isMe, ready, pid) {
  const rib = sk && sk.cls !== 'none' ? '<span class="ribbon rb-' + sk.cls + '">' + ribLines(sk.label) + '</span>' : '';
  const bns = (badges || []).map(b => b.band ? wbHTML(b) : '<span class="bn' + rarCls(b) + '">' + b.label + '</span>').join('');
  const skin = sk && sk.cls !== 'none' ? ' bnr-' + sk.cls : '';
  return '<div class="slot filled' + skin + '"' + (pid ? ' data-seat="' + pid + '"' : '') + '>' + rib + mascotHTML(sk && sk.modes) +
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
    this.qmStop(); this.clearAuto(); this.draft = ''; this._foundCue = ''; this._seatKey = '';
    if (this.ch) { try { this.ch.unsubscribe(); } catch (e) {} this.ch = null; }
    this.phase = 'none'; this.code = ''; this.host = false; this.roster = []; this.chat = []; this.ready = false; this.advancing = false; this.bannerKey = '';
    clearTimeout(this._trackT); this._trackAt = 0;
  },

  menu() {
    if (PRACTICE) return practiceMenu();
    this.leave(); running = false; $('mpbar').style.display = 'none';
    if (!client()) { show('<h1>Offline</h1><p>Multiplayer needs the network and it did not load. Try reloading.</p><button class="ghost" id="bk">Back</button>'); $('bk').onclick = home; return; }
    show('<h1>Lobby</h1><p>Create a lobby and share the code, or invite a friend who is online.</p>' +
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
  duel(teamSize) {
    this.leave(); running = false; $('mpbar').style.display = 'none';
    this.duelTeam = teamSize || 1;
    if (!client()) { show('<h1>Offline</h1><p>Matchmaking needs the network.</p><button class="ghost" id="bk">Back</button>'); $('bk').onclick = home; return; }
    this.duelMode = this.duelMode || DURATION || 20;
    this.qmOff = true;
    this.renderDuel('idle');
    // badges can be stale if a rank moved this session; dfind only exists while still idle
    loadMyProfile().then(() => { if ($('dfind')) this.renderDuel('idle'); });
  },
  // you on the left, VS, them on the right
  duelSides(state) {
    const n = this.duelTeam || 1;
    const inLobby = this.phase === 'lobby' && this.roster.length;
    const card = p => playerCardHTML(p.name, (this.skins || {})[p.pid], (this.banners || {})[p.pid], p.pid === me.id, p.pid === me.id ? this.ready : !!p.ready, p.pid);
    let us = [], them = [];
    if (inLobby) {
      const i = this.roster.findIndex(x => x.pid === me.id);
      const mt = this.teamOf(i < 0 ? 0 : i);
      this.roster.forEach((p, k) => (this.teamOf(k) === mt ? us : them).push(p));
    }
    // my own card comes from my live profile until presence has me, so the banner never blanks
    const left = (inLobby && us.length ? us.map(card).join('')
      : playerCardHTML(me.username, pickSkin(myStats, myBanner, myWorld), visibleBadges(earnedBanners(myStats, true), myShown, myWorld), true, null, me.id)) +
      this.emptySlots(n - Math.max(1, us.length), state, 'teammate');
    // only the other side is hidden: a teammate you cannot see is no comfort, and the
    // point is to stop someone conceding to a banner rather than to a player
    const veil = this.cfg.quick && !this.revealed;
    const right = (veil
      ? them.map(() => '<div class="slot filled veiled"><div class="nm"><span>?</span></div>' +
          '<div class="bns"><span class="bn">revealed when you are both ready</span></div></div>').join('')
      : them.map(p => '<div class="revealin">' + card(p) + '</div>').join('')) +
      this.emptySlots(n - them.length, state, 'opponent');
    return '<div class="duel"><div class="dside">' + left + '</div><div class="vs">VS</div><div class="dside">' + right + '</div></div>';
  },
  emptySlots(k, state, who) {
    return k <= 0 ? '' : Array(k).fill(state === 'searching'
      ? '<div class="slot empty searching">searching\u2026</div>'
      : '<div class="slot empty">no ' + who + ' yet</div>').join('');
  },
  renderDuel(state, err) {
    const modes = [10, 20, 30].map(m => '<button class="ghost fmtbtn' + (this.duelMode === m ? ' on' : '') + '" data-dm="' + m + '"' + (state === 'idle' ? '' : ' disabled') + '>' + MODE_ICON[m] + ' ' + m + 's</button>').join('');
    let action;
    const need = (this.duelTeam || 1) * 2;
    if (state === 'idle') action = '<div class="row"><button class="primary" id="dfind">' + (need > 2 ? 'Find a match' : 'Find opponent') + '</button></div>';
    else if (state === 'searching') action = '<div class="waiting">waiting for ' + (need > 2 ? (need - 1) + ' more players' : 'someone') + ' to join\u2026</div><div class="row"><button class="ghost" id="dcan">Cancel</button></div>';
    else action = '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Ready' : 'Ready up') + '</button></div>' +
      '<div class="keyhint"><kbd>R</kbd> ready up</div>';
    // the two boxes stay full width even with the chat alongside, so both banners read properly
    const head = '<div class="row">' + modes + '</div>';
    const tail = (err ? '<div class="err">' + esc(err) + '</div>' : '') + action +
      '<button class="ghost" id="bk">' + (state === 'idle' ? 'Back' : 'Leave') + '</button>';
    const sides = this.duelSides(state);
    const n = this.duelTeam || 1;
    // finding somebody opened on the same grey heading as the idle screen, so people sat
    // in it without noticing anyone had turned up. it announces itself now, and says
    // what to do next, because the one thing still needed is a press of that button.
    const header = state === 'found'
      ? '<div class="foundbar"><b>' + (need > 2 ? 'MATCH FOUND' : 'OPPONENT FOUND') + '</b>' +
        '<span id="fstat">' + this.fstat() + '</span></div><p class="tag">' + n + 'v' + n + ' \u00b7 best of 3</p>'
      : '<h1>' + n + 'v' + n + '</h1><p class="tag">best of 3 \u00b7 ' +
        (n > 1 ? 'random teammate and opponents' : 'random opponent') + '</p>';
    show(header +
      (state === 'found'
        ? sides + '<div class="cols"><div class="colmain">' + head + tail + '</div><div class="colside">' + this.CHAT_HTML() + '</div></div>'
        : head + sides + tail), true);
    $('bk').onclick = () => { this.qmStop(); this.leave(); home(); };
    document.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { this.duelMode = +b.dataset.dm; this.renderDuel('idle'); });
    const f = $('dfind'); if (f) f.onclick = () => this.search();
    const c = $('dcan'); if (c) c.onclick = () => { this.qmStop(); this.renderDuel('idle'); };
    const r = $('rdy'); if (r) r.onclick = () => this.setReady(!this.ready);
    if (state === 'found') {
      this.bindChat();
      this._seatKey = this.seatKey();
      if (this._foundCue !== this.code) { this._foundCue = this.code; sfxFound(); }
    }
  },
  fstat() {
    return this.revealed ? 'starting\u2026'
      : this.ready ? ((this.duelTeam || 1) > 1 ? 'waiting for the others\u2026' : 'waiting for your opponent\u2026')
      : 'ready up to play';
  },
  // the 2v2 queue is a table of its own, so a 1v1 search never sees a 2v2 waiter
  qmFns() {
    return (this.duelTeam || 1) > 1
      ? { match: 'quick_match2', poll: 'quick_poll2', cancel: 'quick_cancel2' }
      : { match: 'quick_match', poll: 'quick_poll', cancel: 'quick_cancel' };
  },
  async search() {
    const mode = this.duelMode, fn = this.qmFns();
    audioOn();  // a click, so the cue can actually sound when somebody turns up
    this.qmOff = false;
    this.renderDuel('searching');
    try {
      const res = await rpc(fn.match, { p_mode: mode });
      if (this.qmOff) return;
      const rows = res.ok ? await res.json() : [];
      const row = rows[0] || {};
      // the last to arrive gets the code straight back and joins; the rest are told by the poll
      if (row.code) return this.startQuick(row.code, mode, !!row.host);
      this._queued = true;
      this.qmTick(mode);
    } catch (e) { this.renderDuel('idle', 'could not reach matchmaking'); }
  },
  qmTick(mode) {
    this._qmT = setTimeout(async () => {
      if (this.qmOff) return;
      try {
        const r = await rpc(this.qmFns().poll, {});
        const rows = r.ok ? await r.json() : [];
        const row = rows[0] || {};
        // 1v1's poll returns a bare code and the waiter always hosts; 2v2 names its host
        if (row.code) { this._queued = false; return this.startQuick(row.code, mode, row.host === undefined ? true : !!row.host); }
      } catch (e) {}
      this.qmTick(mode);
    }, 1500);
  },
  qmStop() {
    this.qmOff = true; clearTimeout(this._qmT);
    if (this._queued) { this._queued = false; try { rpc(this.qmFns().cancel, {}); } catch (e) {} }
  },
  // one agreed host, so the four of them do not negotiate it
  startQuick(code, mode, isHost) {
    const n = this.duelTeam || 1;
    this.qmStop();
    this.join(code, isHost);
    this.cfg = { format: 'shootout', mode: mode, teamSize: n, rounds: 3, quick: true };
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
    this.wins = { A: 0, B: 0 }; this.history = []; this.round = 0; this.revealed = false;
    this.draft = '';
    // cfg was the one thing left carrying over. after a quick match its quick flag
    // stayed true, and lobby() opens with `if (this.cfg.quick) return renderDuel`,
    // so creating a lobby drew the duel screen instead: no code, wrong layout.
    // a joiner is sent the host's cfg by broadcast, and startQuick sets its own
    // immediately after this, so resetting here costs nothing either way.
    this.cfg = { format: 'shootout', mode: 20, teamSize: 1 };
    this.ch = c.channel('lobby-' + code, { config: { presence: { key: me.id }, broadcast: { self: true } } });
    this.ch
      .on('presence', { event: 'sync' }, () => this.syncRoster())
      .on('broadcast', { event: 'cfg' }, ({ payload }) => { if (!this.host) { this.cfg = payload; this.lobby(); } })
      .on('broadcast', { event: 'chat' }, ({ payload }) => this.onChat(payload))
      .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart(payload))
      .on('broadcast', { event: 'score' }, ({ payload }) => this.onScore(payload))
      .on('broadcast', { event: 'result' }, ({ payload }) => this.onResult(payload))
      .on('broadcast', { event: 'reveal' }, () => { this.revealed = true; this.renderDuel('found'); })
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
  // a player who is losing could simply never ready and wait the other one out.
  // every client runs this clock itself, so it needs no host and no agreement.
  AUTO_READY: 20,
  startAutoReady() {
    this.clearAuto();
    this._autoLeft = this.AUTO_READY;
    const tick = () => {
      if (this.phase !== 'between') return this.clearAuto();
      const el = $('autordy');
      if (this.ready) { if (el) el.textContent = ''; return this.clearAuto(); }
      if (this._autoLeft <= 0) { this.clearAuto(); return this.setReady(true); }
      if (el) {
        el.textContent = 'auto ready in ' + this._autoLeft + 's';
        el.classList.toggle('soon', this._autoLeft <= 5);
      }
      this._autoLeft--;
    };
    tick();
    this._autoT = setInterval(tick, 1000);
  },
  clearAuto() { clearInterval(this._autoT); this._autoT = null; },

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
    // this.ready is checked as well as the roster: onResult clears it locally but the
    // presence write is debounced, so for a moment the state still reads everyone-ready
    // from the round just gone, and without this a round (or a rematch) fires itself.
    if (this.host && this.phase === 'between' && !this.advancing && this.ready && this.allReady()) {
      this.advancing = true; this.round++; this.nextRound();
    }
    // everybody wanted another one: startMatch resets the series and deals round one
    if (this.host && this.phase === 'done' && !this.advancing && this.ready && this.allReady()) {
      this.advancing = true; this.startMatch();
    }
    // a quick match has no lobby to sit in. both sides ready up blind, then the
    // opponent is uncovered and the match starts a beat later, so nobody can size
    // up a world #1 and quit before a ball is bowled.
    if (this.cfg.quick && this.host && this.phase === 'lobby' && !this.advancing && this.allReady()) {
      this.advancing = true;
      this.ch.send({ type: 'broadcast', event: 'reveal', payload: {} });
      setTimeout(() => { if (this.phase === 'lobby') this.startMatch(); }, REVEAL_MS);
    }
  },
  teamOf(i) { return i % 2 === 0 ? 'A' : 'B'; },
  teamMembers(t) { return this.roster.filter((p, i) => this.teamOf(i) === t); },
  need() { return this.cfg.teamSize * 2; },
  // my own seat answers from the click that just happened, not from my presence write,
  // which is debounced: otherwise spamming ready could start a match I had just backed out of
  allReady() { return this.roster.length >= this.need() && this.roster.every(p => p.pid === me.id ? this.ready : p.ready); },
  // everything that changes the shape of the lobby, so repaint knows a patch will do
  seatKey() {
    return [this.cfg.quick ? 'q' : 'l', this.revealed ? 'r' : '-', this.host ? 'h' : '-',
      this.cfg.teamSize, this.cfg.format, this.cfg.mode, this.roster.map(p => p.pid).join('|')].join(':');
  },
  // only who is ready has moved: patch that in place. re-running show() for it rebuilt the
  // chat and restarted every banner animation on screen, which is what made spamming the
  // ready button look broken, and the chip on my own card read back from stale presence.
  paintSeats() {
    this.roster.forEach(p => {
      const el = document.querySelector('.slot[data-seat="' + p.pid + '"] .rdy');
      if (!el) return;
      const r = p.pid === me.id ? this.ready : !!p.ready;
      el.className = 'rdy ' + (r ? 'y' : 'n');
      el.textContent = r ? 'READY' : 'not ready';
    });
    const b = $('rdy');
    if (b) { b.classList.toggle('on', this.ready); b.textContent = this.ready ? '\u2713 Ready' : 'Ready up'; }
    const f = $('fstat'); if (f) f.textContent = this.fstat();
    const s = $('startm');
    if (s) {
      const have = this.roster.length, need = this.need(), all = this.allReady();
      s.disabled = !all;
      s.textContent = have < need ? 'Waiting (' + have + '/' + need + ')' : all ? 'Start match' : 'Waiting for ready';
    }
  },
  repaint() {
    if (this.phase === 'lobby') {
      if ($('rdy') && this._seatKey === this.seatKey()) return this.paintSeats();
      return this.lobby();
    }
    if (this.phase !== 'between' && this.phase !== 'done') return;
    // the reveal for THIS round is already up: refresh the ready row in place, or it restarts.
    // keyed on the round, so a new round always rebuilds and never inherits the last one.
    if ((this.phase === 'between' || this.phase === 'done') && $('rdyrow') && this._shownRound === this.round) return this.paintReady();
    this.resultScreen();
  },
  paintReady() {
    const row = $('rdyrow');
    if (row) row.innerHTML = this.roster.map(r => '<span class="rdy ' + (r.ready ? 'y' : 'n') + '">' + esc(r.name) + (r.ready ? ' \u2713' : '') + '</span>').join(' ');
    const b = $('rdy');
    if (b) {
      b.classList.toggle('on', this.ready);
      const done = this.phase === 'done';
      b.textContent = this.ready ? (done ? '\u2713 Rematch' : '\u2713 Ready') : (done ? 'Rematch' : 'Ready for next round');
    }
  },

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
  draft: '',
  bindChat() {
    const f = $('chatform'); if (!f) return;
    const i = $('chatin');
    // the draft is kept on MP rather than in the input. any presence change
    // re-renders the lobby, which used to take whatever was half-typed with it.
    if (i) {
      i.value = this.draft || '';
      i.oninput = () => { this.draft = i.value; };
      if (this.draft) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }
    f.onsubmit = e => {
      e.preventDefault();
      const t = (i.value || '').trim();
      if (!t) return;
      i.value = ''; this.draft = '';
      this.ch.send({ type: 'broadcast', event: 'chat', payload: { name: me.username, text: t.slice(0, 160) } });
    };
    const log = $('chatlog'); if (log) log.scrollTop = log.scrollHeight;
  },

  banners: {},
  async loadRosterBanners() {
    if (PRACTICE) return;  // bot ids are not profiles; practice dresses its own roster
    const ids = this.roster.map(p => p.pid);
    if (!ids.length) return;
    const key = ids.slice().sort().join(',');
    if (this.bannerKey === key) return;
    this.bannerKey = key;
    try {
      const [stats, profs] = await Promise.all([
        fetchStats(ids),
        fetch(SUPABASE.url + '/rest/v1/profiles?select=id,shown,banner,world&id=in.(' + ids.join(',') + ')', { headers: headers() }).then(r => r.ok ? r.json() : [])
      ]);
      const shownBy = {}, wearing = {};
      const worldBy = {};
      profs.forEach(p => { shownBy[p.id] = p.shown; wearing[p.id] = p.banner || 'none'; worldBy[p.id] = p.world; });
      const out = {}, skins = {};
      ids.forEach(id => { out[id] = visibleBadges(earnedBanners(stats[id], id === me.id), shownBy[id], worldBy[id]); skins[id] = pickSkin(stats[id], wearing[id], worldBy[id]); });
      this.banners = out; this.skins = skins;
      if (this.phase === 'lobby') this.lobby();
    } catch (e) {}
  },
  slotHTML(t, n) {
    const mem = this.teamMembers(t); let h = '';
    for (let i = 0; i < n; i++) {
      const p = mem[i];
      h += p
        ? playerCardHTML(p.name, (this.skins || {})[p.pid], (this.banners || {})[p.pid], p.pid === me.id, p.pid === me.id ? this.ready : !!p.ready, p.pid)
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
        '<div class="keyhint"><kbd>R</kbd> ready up</div>' +
        '<button class="ghost" id="bk">Leave</button>' +
      '</div><div class="colside">' + this.CHAT_HTML() + FRIENDS_HTML(true) + '</div></div>', true);
    this._seatKey = this.seatKey();
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
    this.clearAuto();
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
    this._shownRound = this.round;
    const mine = this.myTeam, won = p.winner === mine, tie = p.winner === 'tie';
    const names = p.roster || [];
    const line = t => names.filter(n => n.team === t).map(n => esc(n.name) + ' <b>' + (p.scores[n.pid] | 0) + '</b>').join('<br>');
    const dec = this.cfg.teamSize > 1 ? 1 : 0;
    const pips = this.history.map(h => '<div class="pip ' + (h === 'tie' ? 'tie' : h.toLowerCase()) + '"></div>').join('') +
      Array(Math.max(0, this.totalRounds() - this.history.length)).fill('<div class="pip"></div>').join('');
    const readyList = this.roster.map(r => '<span class="rdy ' + (r.ready ? 'y' : 'n') + '">' + esc(r.name) + (r.ready ? ' \u2713' : '') + '</span>').join(' ');
    {
      // your side counts up first, player by player, then theirs, then the verdict.
      // every step is a delay handed to the css, so there is no timer to cancel.
      const team = this.cfg.teamSize > 1;
      const members = t => names.filter(n => n.team === t);
      const head = t => team ? 'TEAM ' + t : ((members(t)[0] || {}).name || ('TEAM ' + t));
      // one line per player, then the pause while they fold into the average
      const STEP = team ? .40 : 0, AFTER = team ? .85 : .70;
      const at = {};
      let t = .15;
      [mine, mine === 'A' ? 'B' : 'A'].forEach(side => {
        const m = { rows: [] };
        if (team) { members(side).forEach(() => { m.rows.push(t); t += STEP; }); }
        m.sum = t; t += AFTER;
        at[side] = m;
      });
      const vd = t.toFixed(2);
      const panel = side => {
        const m = at[side];
        const rows = team ? members(side).map((n, i) => '<div class="rrow" style="--d:' + m.rows[i].toFixed(2) + 's">' +
          '<span>' + esc(n.name) + '</span><b>' + (p.scores[n.pid] | 0) + '</b></div>').join('') : '';
        return '<div class="rteam r' + side.toLowerCase() + (p.winner === 'tie' ? '' : side === p.winner ? ' wins' : ' lose') +
          '" style="--vd:' + vd + 's;--md:' + m.sum.toFixed(2) + 's">' +
          '<h3 style="--d:.05s">' + esc(head(side)) + '</h3>' + rows +
          '<div class="rmerge' + (team ? ' sum' : '') + '" style="--d:' + m.sum.toFixed(2) + 's">' +
          '<div class="ravg">' + p[side].toFixed(dec) + '</div>' +
          '<div class="rlab">' + (team ? 'average' : 'tiles') + '</div></div></div>';
      };
      // the last round is still a round: it gets the same reveal, and the match result
      // lands after it rather than replacing it
      const champ = this.wins.A > this.wins.B ? 'A' : this.wins.B > this.wins.A ? 'B' : 'tie';
      const series = '<div class="pips">' + pips + '</div>' +
        '<p>Series: <b style="color:var(--acc)">' + this.wins.A + '</b> \u2013 <b style="color:#ffa657">' + this.wins.B + '</b></p>';
      const ctl = p.done
        ? series +
          '<p class="tag">' + (this.cfg.format === 'triathlon' ? 'best of 3 \u00b7 10s, 20s, 30s' : 'best of ' + this.totalRounds() + ' \u00b7 ' + this.cfg.mode + 's') +
            (this.cfg.teamSize > 1 ? ' \u00b7 2v2, team average' : '') + '</p>' +
          '<div class="row" id="rdyrow">' + readyList + '</div>' +
          '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Rematch' : 'Rematch') + '</button>' +
            (this.host && !this.cfg.quick ? '<button class="ghost" id="again">Back to lobby</button>' : '') +
            '<button class="ghost" id="bk">Leave</button></div>' +
          '<div class="waiting">' + (this.need() > 2 ? 'all four' : 'both players') + ' have to want one</div>' +
          '<div class="keyhint"><kbd>R</kbd> rematch</div>'
        : series +
          '<div class="row" id="rdyrow">' + readyList + '</div>' +
          '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="rdy">' + (this.ready ? '\u2713 Ready' : 'Ready for next round') + '</button></div>' +
          '<div class="waiting">next round starts when everyone is ready</div>' +
          '<div class="autordy" id="autordy"></div>' +
          '<div class="keyhint"><kbd>R</kbd> ready up</div>';
      // your team on the left, so the reveal reads left to right in the order it plays
      show('<h2 class="rhead">Round ' + (this.round + 1) + (p.done ? ' \u00b7 final' : '') + '</h2>' +
        '<div class="cols"><div class="colmain">' +
        '<div class="reveal">' + panel(mine) + '<div class="rvs">VS</div>' + panel(mine === 'A' ? 'B' : 'A') + '</div>' +
        '<div class="verdict' + (tie ? ' tie' : won ? ' good' : ' bad') + '" style="--vd:' + vd + 's">' +
          (tie ? 'Round tied' : esc(head(p.winner)) + ' takes it') + '</div>' +
        (p.done ? '<div class="matchend ' + (champ === 'tie' ? 'tie' : champ === mine ? 'good' : 'bad') + '" style="--vd:' + vd + 's">' +
          (champ === 'tie' ? 'Match drawn' : champ === mine ? 'You win!' : 'You lose') + '</div>' : '') +
        '<div class="revealctl' + (p.done ? ' late' : '') + '" style="--vd:' + vd + 's">' + ctl +
        '</div></div><div class="colside">' + this.CHAT_HTML() + '</div></div>', true);
      $('rdy').onclick = () => this.setReady(!this.ready);
      if (!p.done) this.startAutoReady();
      if (p.done) {
        const ag = $('again');
        if (ag) ag.onclick = () => { this.ch.send({ type: 'broadcast', event: 'home', payload: {} }); };
        $('bk').onclick = () => this.menu();
      }
      this.bindChat();
    }
  },
  bar() {
    const b = $('mpbar'); b.style.display = 'block';
    b.innerHTML = 'Round <b>' + (this.round + 1) + '/' + this.totalRounds() + '</b> \u00b7 series <b style="color:var(--acc)">' + this.wins.A + '</b>\u2013<b style="color:#ffa657">' + this.wins.B + '</b> \u00b7 you are <b>Team ' + this.myTeam + '</b> \u00b7 lobby <b>' + esc(this.code) + '</b>';
  }
};

/* ---------- input ---------- */
/* ---------- tutorial ---------- */
// a minute's walk through the game for somebody who has never seen it. it drives the
// real field, the real keys and the real reveal, so what you learn is the game itself;
// only the board and the opponent are invented. it records nothing.
const TUT = {
  wait: -1, lit: 0, solo: 0, was: 30, ready: false, back: '', BOT: 'TILEBOT',
  start(back) { TUTOR = true; this.back = back || ''; this.lit = 0; this.solo = 0; this.ready = false; this.was = DURATION; this.intro(); },
  stop() {
    TUTOR = false; this.wait = -1; running = false; onRoundEnd = null; this.clearBar();
    ls.set('codeTilesTut', '1');
    if (DURATION !== this.was) setMode(this.was);
    // back where it was launched from: the practice menu is not the home screen
    if (this.back === 'practice' || PRACTICE) return practiceMenu();
    home();
  },
  step(n) { return '<p class="tag">tutorial · ' + n + ' of 5</p>'; },
  clearBar() { const b = $('mpbar'); b.className = ''; b.style.display = 'none'; b.innerHTML = ''; },
  card(top, body, btn, fn) {
    this.clearBar();
    show(top + body + '<div class="row"><button class="primary" id="tnext">' + btn + '</button></div>' +
      '<div class="keyhint"><kbd>Enter</kbd> continue · <kbd>Esc</kbd> skip the tutorial</div>', true);
    $('tnext').onclick = fn;
  },
  intro() {
    this.card('<p class="tag">about a minute</p><h1>Quick tutorial</h1>',
      '<p>Three keys, one run, then a 1v1 against a bot. None of it counts towards your scores.</p>',
      'Start', () => this.keys());
  },

  // ---- 1 of 5: the keys, learned on the real board. one tile per lane, and the
  // lowest is outlined by the game's own renderer, so the thing you learn here is
  // exactly the thing you will be looking at in a run.
  keys() {
    this.lit = 0; this.wait = 0;
    running = false; started = false; freeze = 0; offset = 0; wrongLane = -1;
    waitForFirstKey = false; tiles = [0, 1, 2]; score = 0;
    msg.style.display = 'none';
    resize(); hud(); draw(); field.focus();
    this.paintKeys();
  },
  paintKeys() {
    const b = $('mpbar');
    b.className = 'tutbar'; b.style.display = 'flex';
    const dots = '<span class="tdots">' + [0, 1, 2].map(i => '<i' + (i < this.lit ? ' class="on"' : '') + '></i>').join('') + '</span>';
    b.innerHTML = dots + (this.lit < 3
      ? 'press <kbd>' + esc(keyLabel(BINDS[this.lit]).toUpperCase()) + '</kbd> for the outlined tile'
      : 'that is all three') + '<em>esc to skip</em>';
  },
  // the run loop is not turning, so the tile's slide needs a few frames of its own
  slide() {
    this._t = performance.now();
    if (this._anim) return;
    this._anim = true;
    const step = () => {
      if (!TUTOR) { this._anim = false; return; }
      const now = performance.now(), dt = Math.min((now - this._t) / 1000, .05);
      this._t = now;
      offset = Math.max(0, offset - SLIDE_SPEED * dt);
      draw();
      if (offset > 0) requestAnimationFrame(step); else this._anim = false;
    };
    requestAnimationFrame(step);
  },
  onKey(i) {
    if (this.lit >= 3) return;
    if (i !== this.lit) return beep(110, .14, 'sawtooth', .05);
    sfxHit(i); this.lit++;
    tiles.shift(); offset += TILE_H; this.slide();
    this.paintKeys();
    if (this.lit < 3) return;
    this.wait = -1;
    setTimeout(() => { if (TUTOR) this.card(this.step(2) + '<h2>Now a run</h2>',
      '<p>Tiles stack up the screen. Press the key for the <b>lowest</b> one, every time. A wrong key <b style="color:#bfe8ff">freezes you</b> for half a second, so accuracy beats hammering.</p>' +
      '<p>Ten seconds, starting on your first key. Hit as many as you can.</p>',
      'Go', () => this.go()); }, 850);
  },

  // ---- 2 of 5: the real thing, ten seconds ----
  go() { setMode(10); startRun({ onEnd: s => { this.solo = s; this.board(); } }); },

  // ---- 3 of 5: where a score lands ----
  board() {
    const rows = [['BRACKETBOB', 38], ['NOVAK', 31], ['MILO', 24], ['SPARK', 17], ['PENNY', 11], ['DAN', 5]]
      .concat([[me ? me.username : 'YOU', this.solo, 1]])
      .sort((a, b) => b[1] - a[1] || (a[2] ? 1 : -1))
      .map(r => '<li' + (r[2] ? ' class="me"' : '') + '><span>' + esc(r[0]) + '</span><b>' + r[1] + '</b></li>').join('');
    this.card(this.step(3) + '<h2>' + this.solo + ' tile' + (this.solo === 1 ? '' : 's') + '</h2>',
      '<p>Every run goes on the board for its mode. This board is invented — the real one has today, this week and all time, for 10s, 20s and 30s separately.</p>' +
      '<div id="lb"><button class="lbt">example board <span>10s mode</span></button><div id="lbbody"><ol>' + rows + '</ol></div></div>',
      'Next', () => this.badges());
  },

  // ---- 4 of 5: what you are playing for ----
  badges() {
    const chips = ['45 ' + MODE_ICON[10], '110 ' + MODE_ICON[20], '100 games 🎮', '1v1 winner 10x', '👑 Triple crown']
      .map(l => '<span class="bn">' + l + '</span>').join('');
    this.card(this.step(4) + '<h2>Badges</h2>',
      '<p>Scores and wins earn badges, and they sit on the box with your name on it — the one your opponent sees in a lobby. Some examples:</p>' +
      '<div class="slot filled" style="max-width:320px;margin:0 auto 10px"><div class="nm"><span>' + esc(me ? me.username : 'YOU') + '</span></div>' +
      '<div class="bns">' + chips + '</div></div>' +
      '<p>Top the board for a mode and you wear the world #1 banner until somebody takes it off you.</p>',
      'Try a 1v1', () => this.find());
  },

  // ---- 5 of 5: a scripted single round ----
  myCard(ready) {
    return playerCardHTML(me ? me.username : 'YOU', pickSkin(myStats, myBanner, myWorld),
      visibleBadges(earnedBanners(myStats, true), myShown, myWorld), true, ready);
  },
  sides(veil, meReady, botReady) {
    const them = veil
      ? '<div class="slot filled veiled"><div class="nm"><span>?</span></div>' +
        '<div class="bns"><span class="bn">revealed when you are both ready</span></div></div>'
      : '<div class="revealin">' + playerCardHTML(this.BOT, null, [{ label: 'tutorial bot 🤖' }], false, botReady) + '</div>';
    return '<div class="duel"><div class="dside">' + this.myCard(meReady) + '</div>' +
      '<div class="vs">VS</div><div class="dside">' + them + '</div></div>';
  },
  find() {
    show(this.step(5) + '<h1>1v1</h1><p class="tag">tutorial · one round · 20s</p>' +
      '<div class="duel"><div class="dside">' + this.myCard(null) + '</div><div class="vs">VS</div>' +
      '<div class="dside"><div class="slot empty searching">searching…</div></div></div>' +
      '<div class="waiting">out there this is whoever else is queuing for 1v1</div>', true);
    setTimeout(() => { if (TUTOR) this.found(); }, 1700);
  },
  found() { this.ready = false; sfxFound(); this.paintDuel(); },
  paintDuel() {
    show(this.step(5) + '<div class="foundbar"><b>OPPONENT FOUND</b><span>' +
      (this.ready ? 'waiting for your opponent…' : 'ready up to play') + '</span></div>' +
      '<p class="tag">tutorial · one round · 20s</p>' + this.sides(true, this.ready, false) +
      '<div class="row"><button class="ghost readybtn' + (this.ready ? ' on' : '') + '" id="tnext">' +
      (this.ready ? '✓ Ready' : 'Ready up') + '</button></div>' +
      '<p>Neither of you can see the other until you have both readied up.</p>' +
      '<div class="keyhint"><kbd>R</kbd> ready up</div>', true);
    $('tnext').onclick = () => this.setReady();
  },
  setReady() {
    if (this.ready) return;
    this.ready = true; this.paintDuel();
    setTimeout(() => { if (TUTOR) this.reveal(); }, 950);
  },
  reveal() {
    show(this.step(5) + '<div class="foundbar"><b>OPPONENT FOUND</b><span>starting…</span></div>' +
      '<p class="tag">tutorial · one round · 20s</p>' + this.sides(false, true, true), true);
    setTimeout(() => { if (TUTOR) this.count(); }, 1500);
  },
  count() {
    setMode(20);
    let n = 3;
    const tick = () => {
      if (!TUTOR) return;
      if (n > 0) {
        show('<div id="count">' + n + '</div><p>Tutorial round · 20s</p>');
        beep(440 + (3 - n) * 60, .12, 'triangle', .09); n--; return setTimeout(tick, 1000);
      }
      beep(880, .25, 'triangle', .12);
      startRun({ autoStart: true, onEnd: s => this.result(s) });
    };
    tick();
  },
  // the bot lands a few behind: losing your first duel to a tutorial teaches nothing.
  // at nought there is nowhere lower to put it, so that one is honestly a draw.
  result(s) {
    const bot = Math.max(0, s - (2 + Math.floor(Math.random() * 3)));
    const drew = s === bot;
    const panel = (cls, name, n, d, win) =>
      '<div class="rteam ' + cls + (drew ? '' : win ? ' wins' : ' lose') + '" style="--vd:1.55s;--md:' + d + 's">' +
      '<h3 style="--d:.05s">' + esc(name) + '</h3><div class="rmerge" style="--d:' + d + 's">' +
      '<div class="ravg">' + n + '</div><div class="rlab">tiles</div></div></div>';
    show('<h2 class="rhead">Tutorial round</h2>' +
      '<div class="reveal">' + panel('ra', me ? me.username : 'YOU', s, .15, true) +
      '<div class="rvs">VS</div>' + panel('rb', this.BOT, bot, .85, false) + '</div>' +
      '<div class="verdict ' + (drew ? 'tie' : 'good') + '" style="--vd:1.55s">' +
      (drew ? 'Round tied' : 'You take it') + '</div>' +
      '<div class="matchend ' + (drew ? 'tie' : 'good') + '" style="--vd:1.55s">' +
      (drew ? 'Nothing in it' : 'You win!') + '</div>' +
      '<div class="revealctl late" style="--vd:1.55s">' +
      '<p>A real 1v1 is best of three. Each side readies up between rounds, and a 20 second clock readies you anyway if you sit on it.</p>' +
      '<div class="row"><button class="primary" id="tnext">Finish</button></div></div>', true);
    $('tnext').onclick = () => this.done();
  },
  done() {
    this.card('<h1>That is the game</h1>',
      '<p><b>1v1</b> and <b>2v2</b> match you with whoever is queuing. <b>Join / create a lobby</b> is for playing someone you know.</p>' +
      '<p>None of the tutorial was recorded, so your board is still empty. Go and fill it.</p>',
      'Play', () => this.stop());
  }
};

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
  if (e.key === 'Escape') {
    e.preventDefault();
    // not mid-round: walking out there leaves the others waiting on a score
    // that never arrives. between rounds and on the result screens it is fine.
    if (MP.phase === 'countdown' || MP.phase === 'playing') return;
    if (TUTOR) return TUT.stop();
    home(); return;
  }
  // r restarts a solo run, and stands in for the ready button inside a match, where
  // restarting is not on offer. skipped entirely if r has been bound to a lane.
  if (e.key.toLowerCase() === 'r' && KEY['r'] === undefined) {
    // inside the tutorial r is the card's own button, which is how it teaches ready-up
    if (TUTOR) { e.preventDefault(); const t = $('tnext'); if (t) t.click(); return; }
    if (MP.phase === 'none') { e.preventDefault(); startRun(); return; }
    if (MP.phase === 'lobby' || MP.phase === 'between' || MP.phase === 'done') {
      e.preventDefault(); MP.setReady(!MP.ready); return;
    }
  }
  const l = KEY[e.key.toLowerCase()];
  if (l !== undefined) { e.preventDefault(); press(l); return; }
  if (!running && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const g = $('tnext') || $('go'); if (g) g.click(); }
});
field.addEventListener('pointerdown', e => {
  field.focus(); if (!running) return;
  const r = cv.getBoundingClientRect();
  press(Math.min(LANES - 1, Math.floor((e.clientX - r.left) / r.width * LANES)));
});
document.querySelectorAll('#pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); press(+b.dataset.l); field.focus(); }));

/* ---------- boot ---------- */
rebuildKeys();
applyTheme(ls.get('codeTilesTheme', 'brackets'));
applySound(ls.get('codeTilesSound', 'classic'));
/* ---------- practice: the real duel, played against bots ----------
   add ?preview to the url. this is not a mock of the duel screens: it is the duel,
   with the supabase channel swapped for one that talks to itself. every screen, the
   countdown, the reveal, the scoring and the series are the real code paths, so what
   is practised here is what happens in a live match. nothing is written: no score
   row, no change to your best, no presence, no network. */
let PRACTICE = false;
const BOT_NAMES = ['RIVAL', 'NEMESIS', 'ECHO', 'VOLT', 'NOVA'];
// tiles per second. the live boards sit near 3.4 (10s) up to 5 (30s), so normal is
// about an even match and hard is above anything logged so far.
const BOT_RATE = { easy: 3.1, normal: 4.3, hard: 5.4 };
function botScore(mode, diff) {
  const rate = BOT_RATE[diff] || BOT_RATE.normal;
  // three uniforms make a rough bell, so a bot is not metronomic round to round
  const spread = (Math.random() + Math.random() + Math.random() - 1.5) * mode * .17;
  return Math.max(1, Math.round(rate * mode + spread));
}
// a channel that talks only to itself. send comes straight back, the way supabase
// behaves with self:true, and presence is a plain object the bots are seated in.
function localChannel() {
  const subs = []; const pres = {}; let onSync = null;
  const ch = {
    on(type, filter, cb) { if (type === 'presence') onSync = cb; else subs.push({ e: filter.event, cb: cb }); return ch; },
    subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return ch; },
    send(m) { setTimeout(() => subs.forEach(x => { if (x.e === m.event) x.cb({ payload: m.payload }); }), 0); return Promise.resolve('ok'); },
    track(p) { pres[p.pid] = [p]; if (onSync) setTimeout(onSync, 0); return Promise.resolve('ok'); },
    presenceState() { return pres; },
    unsubscribe() { subs.length = 0; onSync = null; return Promise.resolve('ok'); },
    seat(p) { pres[p.pid] = [p]; }
  };
  return ch;
}
function practiceStop() {
  if (MP.practice) (MP.practice.timers || []).forEach(clearTimeout);
  MP.practice = null;
}
// the bots "play" the round: they report a score once the clock would have run out
function practiceBots(p) {
  if (!PRACTICE || !MP.practice) return;
  const after = 3200 + p.mode * 1000;
  MP.practice.bots.forEach((b, i) => {
    MP.practice.timers.push(setTimeout(() => {
      if (!PRACTICE || !MP.ch) return;
      MP.ch.send({ type: 'broadcast', event: 'score', payload: { round: p.round, pid: b.pid, score: botScore(p.mode, MP.practice.diff) } });
    }, after + 300 + i * 140 + Math.random() * 800));
  });
}
function practiceStart(teamSize, mode, diff) {
  MP.leave(); practiceStop();
  PRACTICE = true;
  // joinedAt 0 seats me first, so roster order (and therefore teams) is predictable:
  // index 1 and 3 are opponents, index 2 is my partner
  MP.code = 'PRACTICE'; MP.host = true; MP.joinedAt = 0; MP.phase = 'lobby';
  MP.ready = false; MP.chat = []; MP.advancing = false; MP.bannerKey = 'practice';
  MP.wins = { A: 0, B: 0 }; MP.history = []; MP.round = 0; MP.revealed = false;
  MP.duelTeam = teamSize;
  MP.cfg = { format: 'shootout', mode: mode, teamSize: teamSize, rounds: 3, quick: true };
  const bots = [];
  for (let i = 1; i < teamSize * 2; i++) bots.push({ pid: 'bot-' + i, name: BOT_NAMES[i - 1], at: i, host: false, ready: true });
  MP.practice = { diff: diff, bots: bots, timers: [] };
  const ch = localChannel();
  MP.ch = ch;
  ch.on('presence', { event: 'sync' }, () => MP.syncRoster())
    .on('broadcast', { event: 'chat' }, ({ payload }) => MP.onChat(payload))
    .on('broadcast', { event: 'start' }, ({ payload }) => MP.onStart(payload))
    .on('broadcast', { event: 'score' }, ({ payload }) => MP.onScore(payload))
    .on('broadcast', { event: 'result' }, ({ payload }) => MP.onResult(payload))
    .on('broadcast', { event: 'reveal' }, () => { MP.revealed = true; MP.renderDuel('found'); })
    .on('broadcast', { event: 'start' }, ({ payload }) => practiceBots(payload));
  bots.forEach(b => ch.seat(b));
  // dressed here because loadRosterBanners is skipped: bots are not profiles
  MP.skins = {}; MP.banners = {};
  MP.skins[me.id] = pickSkin(myStats, myBanner, myWorld);
  MP.banners[me.id] = visibleBadges(earnedBanners(myStats, true), myShown, myWorld);
  bots.forEach(b => { MP.skins[b.pid] = null; MP.banners[b.pid] = [{ id: 'bot', rar: 'common', label: '\uD83E\uDD16 bot' }]; });
  ch.subscribe(s => { if (s === 'SUBSCRIBED') { MP.track(); MP.renderDuel('found'); } });
}
function practiceMenu() {
  MP.leave(); practiceStop(); PRACTICE = false;
  running = false; $('mpbar').style.display = 'none';
  const st = ls.get('ctPractice', '1|20|normal').split('|');
  let sz = +st[0] || 1, md = +st[1] || 20, df = st[2] || 'normal';
  const draw = () => {
    ls.set('ctPractice', sz + '|' + md + '|' + df);
    show('<h1>Practice</h1><p class="tag">the real duel against bots \u00b7 nothing is saved</p>' +
      '<div class="friends"><h4>MATCH</h4><div class="row">' +
      [1, 2].map(n => '<button class="ghost fmtbtn' + (sz === n ? ' on' : '') + '" data-p="sz" data-v="' + n + '">' + n + 'v' + n + '</button>').join('') +
      '</div><div class="row">' +
      [10, 20, 30].map(n => '<button class="ghost fmtbtn' + (md === n ? ' on' : '') + '" data-p="md" data-v="' + n + '">' + MODE_ICON[n] + ' ' + n + 's</button>').join('') +
      '</div></div>' +
      '<div class="friends"><h4>BOTS</h4><div class="row">' +
      [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']].map(d =>
        '<button class="ghost fmtbtn' + (df === d[0] ? ' on' : '') + '" data-p="df" data-v="' + d[0] + '">' + d[1] + '</button>').join('') +
      '</div><div class="empty">about ' + Math.round(BOT_RATE[df] * md) + ' tiles over ' + md + 's</div></div>' +
      '<div class="row"><button class="primary" id="pgo">Start practice</button></div>' +
      '<div class="row"><button class="ghost" id="ptut">\uD83C\uDF93 Run the tutorial</button></div>' +
      '<div class="row"><button class="ghost" id="pexit">Back to the game</button></div>', true);
    $('ptut').onclick = () => TUT.start('practice');
    document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      if (b.dataset.p === 'sz') sz = +v; else if (b.dataset.p === 'md') md = +v; else df = v;
      draw();
    });
    $('pgo').onclick = () => practiceStart(sz, md, df);
    $('pexit').onclick = () => { PRACTICE = false; history.replaceState(null, '', location.pathname); home(); };
  };
  draw();
}
show('<h1 class="hero">Code Tiles</h1><div class="waiting">loading\u2026</div>', true);
(async () => {
  for (let i = 0; i < 40 && !window.supabase; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.supabase) { show('<h1>Offline</h1><p>Could not reach the server. Reload to try again.</p>'); return; }
  const ok = await loadSession();
  if (!ok) return loginScreen('', 'in');
  startPresence(); await loadFriends(); await loadMyProfile();
  if (/[?&]preview\b/.test(location.search)) return practiceMenu();
  home();
})();
})();
