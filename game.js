/* =====================================================================
   COMMANDER COSMO — Galactic Pogo Patrol
   A finished, fully self-contained platformer in the classic
   side-scrolling style (helmet + raygun + pogo stick).
   Original art & audio generated in code. No external assets.
   ===================================================================== */
'use strict';

/* ----------------------------- CONFIG ------------------------------ */
const TILE = 16;
const VIEW_W = 20;            // tiles
const VIEW_H = 13;            // tiles
const W = VIEW_W * TILE;      // 320
const H = VIEW_H * TILE;      // 208
const ROWS = VIEW_H;

const GRAV       = 760;       // px/s^2 — lower gravity = floaty, Keen-era hang time
const MAX_FALL   = 440;
const RUN_SPEED  = 92;
const RUN_ACCEL  = 820;
const RUN_FRICT  = 1000;
const JUMP_VEL   = 322;       // tall, floaty arc (~4.3 tiles)
const JUMP_CUT   = 150;       // min upward speed when jump released
const POGO_BOUNCE= 372;       // springy pogo, higher than a jump
const POGO_SUPER = 452;       // hold jump on a bounce for a big pogo hop
const COYOTE     = 0.11;      // s
const JUMP_BUF   = 0.11;      // s
const SHOT_SPEED = 240;
const SHOT_COOL  = 0.26;
const INVULN     = 1.4;       // s after taking a hit
const START_LIVES= 4;
const MAX_HEARTS = 3;
const START_AMMO = 8;

/* ---------------------------- CANVAS ------------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const buf = document.createElement('canvas');
buf.width = W; buf.height = H;
const bx = buf.getContext('2d');
bx.imageSmoothingEnabled = false;

let view = { x: 0, y: 0, w: W, h: H, scale: 1 };

function resize() {
  // Work entirely in DEVICE pixels with an INTEGER scale so every source pixel maps
  // to exactly `scale` device pixels — perfectly crisp, no fractional-upscale blur.
  const dpr = window.devicePixelRatio || 1;
  const ww = window.innerWidth, wh = window.innerHeight;
  canvas.style.width = ww + 'px';
  canvas.style.height = wh + 'px';
  const dw = Math.round(ww * dpr), dh = Math.round(wh * dpr);
  canvas.width = dw; canvas.height = dh;
  ctx.setTransform(1, 0, 0, 1, 0, 0);   // identity: draw in device pixels
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.floor(Math.min(dw / W, dh / H)));
  view.scale = scale;
  view.w = W * scale; view.h = H * scale;
  view.x = Math.floor((dw - view.w) / 2);
  view.y = Math.floor((dh - view.h) / 2);
}
window.addEventListener('resize', resize);

/* ---------------------------- INPUT -------------------------------- */
const KEYMAP = {
  ArrowLeft:'left', KeyA:'left',
  ArrowRight:'right', KeyD:'right',
  ArrowUp:'jump', KeyW:'jump', Space:'jump',
  KeyZ:'shoot', ControlLeft:'shoot', ControlRight:'shoot', KeyJ:'shoot',
  KeyX:'pogo', ShiftLeft:'pogo', ShiftRight:'pogo', KeyK:'pogo',
  ArrowDown:'down', KeyS:'down',
  KeyP:'pause', Escape:'pause',
  Enter:'start', NumpadEnter:'start',
  KeyM:'music', KeyN:'mute',
};
const held = {};
const pressed = {};
function onKey(e, down) {
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  if (down) {
    if (!held[a]) pressed[a] = true;
    held[a] = true;
  } else {
    held[a] = false;
  }
  ensureAudio();
}
window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));
window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
function clearPressed() { for (const k in pressed) pressed[k] = false; }

/* On-screen touch buttons (mobile) */
function bindTouch() {
  const map = [['btn-left','left'],['btn-right','right'],['btn-jump','jump'],
               ['btn-shoot','shoot'],['btn-pogo','pogo']];
  map.forEach(([id, act]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const set = (v, e) => { e.preventDefault(); if (v && !held[act]) pressed[act]=true; held[act]=v; ensureAudio(); };
    el.addEventListener('touchstart', e => set(true, e), {passive:false});
    el.addEventListener('touchend',   e => set(false, e), {passive:false});
    el.addEventListener('mousedown',  e => set(true, e));
    window.addEventListener('mouseup', () => { held[act]=false; });
  });
  if ('ontouchstart' in window) {
    const tc = document.getElementById('touch');
    if (tc) tc.style.display = 'flex';
  }
}

/* ---------------------------- AUDIO -------------------------------- */
let actx = null, master = null, musicGain = null, sfxGain = null;
let audioReady = false;
let soundOn = true, musicOn = false, muted = false;   // music opt-in; N = master mute
const MASTER_VOL = 0.6;

function applyMute() { if (master) master.gain.value = muted ? 0 : MASTER_VOL; }
// Suspend/resume the whole context (used on pause + tab-away) so nothing keeps
// playing when the game isn't in front.
function setAudioActive(active) {
  if (!audioReady || !actx) return;
  if (active) { actx.resume(); Music.resync(); }
  else if (actx.state === 'running') actx.suspend();
}

function ensureAudio() {
  if (audioReady) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = muted ? 0 : MASTER_VOL; master.connect(actx.destination);
    musicGain = actx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(master);
    sfxGain = actx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    audioReady = true;
    Music.start();
  } catch (e) { audioReady = false; }
}

function blip(freq, dur, type, vol, sweepTo, delay) {
  if (!audioReady || !soundOn) return;
  const t = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxGain);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, hp) {
  if (!audioReady || !soundOn) return;
  const t = actx.currentTime;
  const n = Math.floor(actx.sampleRate * dur);
  const buffer = actx.createBuffer(1, n, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buffer;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t); src.stop(t + dur);
}

const SFX = {
  jump:   () => blip(330, 0.16, 'square', 0.22, 620),
  pogo:   () => { blip(180, 0.12, 'square', 0.22, 520); },
  superpogo: () => { blip(200, 0.18, 'square', 0.25, 760); },
  shoot:  () => { blip(820, 0.10, 'square', 0.18, 260); },
  pickup: () => { blip(880, 0.07, 'square', 0.2); blip(1320, 0.09, 'square', 0.2, null, 0.07); },
  biggem: () => { [660,880,1320].forEach((f,i)=>blip(f,0.1,'triangle',0.22,null,i*0.06)); },
  hurt:   () => { blip(200, 0.25, 'sawtooth', 0.25, 70); noise(0.18, 0.18, 400); },
  enemy:  () => { blip(260, 0.16, 'sawtooth', 0.22, 90); noise(0.16, 0.2, 600); },
  die:    () => { [440,330,220,140].forEach((f,i)=>blip(f,0.18,'triangle',0.25,null,i*0.12)); noise(0.4,0.2,300); },
  life:   () => { [523,659,784,1047].forEach((f,i)=>blip(f,0.12,'square',0.2,null,i*0.07)); },
  win:    () => { [523,659,784,1047,1319].forEach((f,i)=>blip(f,0.16,'square',0.22,null,i*0.1)); },
  bump:   () => blip(140, 0.06, 'square', 0.14, 90),
  select: () => blip(660, 0.06, 'square', 0.18, 880),
  exit:   () => { [392,523,659,784].forEach((f,i)=>blip(f,0.14,'triangle',0.22,null,i*0.09)); },
};

/* ------- Chiptune music: two channels, looping, scheduled ahead ----- */
const Music = (function () {
  // semitone -> freq (A4 = 440 = midi 69)
  const f = m => 440 * Math.pow(2, (m - 69) / 12);
  // Two original loops (midi notes, -1 = rest); the scheduler picks by game state.
  const SONGS = {
    level: {  // bouncy, heroic — plays during levels
      lead: [69,71,72,74, 76,74,72,71, 69,72,76,79, 76,72,69,67,
             65,67,69,71, 72,71,69,67, 65,67,69,72, 71,-1,-1,-1],
      bass: [45,45,52,52, 48,48,55,55, 41,41,48,48, 43,43,50,50,
             45,45,52,52, 48,48,55,55, 41,41,48,48, 43,50,55,57],
    },
    map: {    // calmer, wandering — plays on the overworld
      lead: [64,-1,67,-1, 69,-1,67,64, 62,-1,64,-1, 67,-1,-1,-1,
             65,-1,69,-1, 72,-1,69,65, 64,-1,67,-1, 64,-1,-1,-1],
      bass: [40,40,47,47, 45,45,52,52, 38,38,45,45, 43,43,47,47,
             40,40,47,47, 45,45,52,52, 38,38,45,45, 43,47,52,52],
    },
  };
  const step = 0.16;            // seconds per 1/8 note
  let i = 0, nextT = 0, timer = null, running = false;

  function scheduleNote(arr, idx, t, type, vol, gainNode) {
    const m = arr[idx % arr.length];
    if (m < 0) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f(m), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.9);
    o.connect(g).connect(gainNode);
    o.start(t); o.stop(t + step);
  }
  function tick() {
    if (!running || !audioReady) return;
    const song = (typeof Game !== 'undefined' && Game.state === 'worldmap') ? SONGS.map : SONGS.level;
    const ahead = actx.currentTime + 0.2;
    while (nextT < ahead) {
      if (musicOn) {
        scheduleNote(song.lead, i, nextT, 'square', 0.15, musicGain);
        if (i % 2 === 0) scheduleNote(song.bass, i, nextT, 'triangle', 0.22, musicGain);
      }
      nextT += step; i++;
    }
  }
  return {
    start() {
      if (running || !audioReady) return;
      running = true; i = 0; nextT = actx.currentTime + 0.1;
      timer = setInterval(tick, 50);
    },
    setEnabled(v) { musicOn = v; },
    resync() { if (audioReady && actx) nextT = actx.currentTime + 0.1; }
  };
})();

/* --------------------------- UTILITIES ----------------------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* ------------------------ SPRITE BAKING ---------------------------- */
/* Each sprite is procedurally drawn into a 16x16 (or taller) offscreen
   canvas once, then blitted. facing handled by drawing flipped copies. */
function newSprite(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}
function flip(src) {
  const c = newSprite(src.width, src.height);
  const g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}
function P(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

// Authentic EGA 16-color palette
const EGA = {
  black:'#000000', blue:'#0000AA', green:'#00AA00', cyan:'#00AAAA',
  red:'#AA0000', magenta:'#AA00AA', brown:'#AA5500', lgray:'#AAAAAA',
  dgray:'#555555', bblue:'#5555FF', bgreen:'#55FF55', bcyan:'#55FFFF',
  bred:'#FF5555', bmagenta:'#FF55FF', yellow:'#FFFF55', white:'#FFFFFF',
};
const C = {
  helmet:EGA.bgreen, helmetD:EGA.green, helmetHi:EGA.white,
  skin:EGA.lgray, skinD:EGA.dgray,
  shirt:EGA.bred, shirtD:EGA.red,
  pants:EGA.bblue, pantsD:EGA.blue,
  shoe:EGA.white, shoeD:EGA.lgray,
  gun:EGA.lgray, gunD:EGA.dgray, gunGlow:EGA.yellow,
  eye:EGA.black, mouth:EGA.red,
};

/* Hero frames: 16x18, hitbox is 10x14 centered-ish.
   We draw helmet, face, body, legs (vary by frame), optional gun/pogo. */
function bakeHero(frame) {
  const c = newSprite(16, 18); const g = c.getContext('2d');
  // helmet
  P(g, 4,0,8,2, C.helmet); P(g,3,2,10,4, C.helmet);
  P(g,3,2,10,1, C.helmetHi);
  P(g,3,5,10,1, C.helmetD);
  P(g,11,3,2,2, C.helmetHi);
  // face
  P(g,5,6,6,3, C.skin); P(g,5,8,6,1, C.skinD);
  P(g,6,6,2,2, C.eye);             // eye
  P(g,9,7,1,1, C.skinD);
  // body / shirt
  P(g,4,9,8,4, C.shirt); P(g,4,12,8,1, C.shirtD);
  P(g,5,9,1,4, C.shirtD);

  // legs vary by frame
  const legcol = C.pants, legd = C.pantsD;
  if (frame === 'run1') {
    P(g,4,13,3,3, legcol); P(g,9,13,3,2, legcol);
    P(g,3,16,4,2, C.shoe); P(g,10,15,4,2, C.shoe);
  } else if (frame === 'run2') {
    P(g,5,13,3,2, legcol); P(g,8,13,3,3, legcol);
    P(g,4,15,4,2, C.shoe); P(g,9,16,4,2, C.shoe);
  } else if (frame === 'jump') {
    P(g,4,13,3,2, legcol); P(g,9,13,3,2, legcol);
    P(g,3,14,4,2, C.shoe); P(g,10,14,4,2, C.shoe);
  } else if (frame === 'pogo') {
    P(g,5,13,3,3, legcol); P(g,8,13,3,3, legcol);
    P(g,5,16,6,1, C.shoe);
    // pogo stick
    P(g,7,16,2,2, C.gunD); // handled separately for spring; keep short here
  } else { // stand
    P(g,5,13,3,3, legcol); P(g,8,13,3,3, legcol);
    P(g,4,16,4,2, C.shoe); P(g,9,16,4,2, C.shoe);
  }

  // arm + raygun (facing right by default)
  if (frame === 'shoot') {
    P(g,11,9,5,2, C.gun); P(g,15,9,1,2, C.gunGlow);
    P(g,10,10,2,2, C.shirt);
  } else {
    P(g,11,10,2,2, C.shirt); // arm
    P(g,12,11,3,2, C.gun);   // holstered gun hint
  }
  return c;
}

const SPR = {};
function bakeAll() {
  ['stand','run1','run2','jump','pogo','shoot'].forEach(f => {
    SPR['hero_' + f + '_R'] = bakeHero(f);
    SPR['hero_' + f + '_L'] = flip(SPR['hero_' + f + '_R']);
  });

  // One-eye walker (EGA green)
  for (const fr of [0, 1]) {
    const c = newSprite(16, 14); const g = c.getContext('2d');
    P(g,3,2,10,9,EGA.green); P(g,3,2,10,1,EGA.bgreen); P(g,3,10,10,1,EGA.green);
    P(g,5,1,6,2,EGA.green);
    P(g,6,4,5,5,EGA.white); P(g,8,5,2,3,EGA.black); // big eye
    // feet
    if (fr === 0){ P(g,3,11,4,3,EGA.green); P(g,9,11,4,3,EGA.green); }
    else { P(g,4,11,4,3,EGA.green); P(g,8,11,4,3,EGA.green); }
    SPR['yorp_'+fr+'_R'] = c; SPR['yorp_'+fr+'_L'] = flip(c);
  }

  // Fast two-eye walker (EGA magenta)
  for (const fr of [0, 1]) {
    const c = newSprite(16, 14); const g = c.getContext('2d');
    P(g,2,3,12,8,EGA.magenta); P(g,2,3,12,1,EGA.bmagenta); P(g,2,10,12,1,EGA.magenta);
    P(g,4,1,8,3,EGA.magenta);
    P(g,4,5,3,3,EGA.white); P(g,9,5,3,3,EGA.white);
    P(g,5,6,2,2,EGA.black); P(g,10,6,2,2,EGA.black);
    P(g,6,9,4,1,EGA.black); // mouth
    if (fr === 0){ P(g,3,11,4,3,EGA.magenta); P(g,9,11,4,3,EGA.magenta); }
    else { P(g,2,11,4,3,EGA.magenta); P(g,10,11,4,3,EGA.magenta); }
    SPR['bloog_'+fr+'_R'] = c; SPR['bloog_'+fr+'_L'] = flip(c);
  }

  // Flyer (EGA yellow/brown bat-bot)
  for (const fr of [0, 1]) {
    const c = newSprite(16, 12); const g = c.getContext('2d');
    P(g,5,3,6,6,EGA.yellow); P(g,5,3,6,1,EGA.white); P(g,5,8,6,1,EGA.brown);
    P(g,7,5,3,2,EGA.black); P(g,7,5,1,1,EGA.bred);
    // wings flap
    if (fr === 0){ P(g,1,2,4,2,EGA.white); P(g,11,2,4,2,EGA.white); }
    else { P(g,1,5,4,2,EGA.white); P(g,11,5,4,2,EGA.white); }
    SPR['flyer_'+fr+'_R'] = c; SPR['flyer_'+fr+'_L'] = flip(c);
  }

  // Hopper (EGA cyan spring-frog) — fr0 crouched, fr1 legs-out (mid-hop)
  for (const fr of [0, 1]) {
    const c = newSprite(16, 14); const g = c.getContext('2d');
    P(g,3,4,10,7,EGA.cyan); P(g,3,4,10,1,EGA.bcyan); P(g,3,10,10,1,EGA.blue);
    P(g,4,2,8,3,EGA.cyan);
    P(g,4,2,3,3,EGA.white); P(g,9,2,3,3,EGA.white);
    P(g,5,3,2,2,EGA.black); P(g,10,3,2,2,EGA.black);
    if (fr === 0){ P(g,2,11,4,3,EGA.cyan); P(g,10,11,4,3,EGA.cyan); }
    else { P(g,1,9,3,4,EGA.bcyan); P(g,12,9,3,4,EGA.bcyan); }
    SPR['hopper_'+fr+'_R'] = c; SPR['hopper_'+fr+'_L'] = flip(c);
  }

  // gem (EGA cyan crystal) — animated shimmer handled at draw
  const gem = newSprite(10,10); { const g = gem.getContext('2d');
    P(g,4,1,2,1,EGA.bcyan); P(g,3,2,4,1,EGA.bcyan); P(g,2,3,6,2,EGA.cyan);
    P(g,3,5,4,2,EGA.cyan); P(g,4,7,2,1,EGA.cyan); P(g,4,2,1,3,EGA.white); }
  SPR.gem = gem;

  const big = newSprite(14,14); { const g = big.getContext('2d');
    P(g,6,1,2,1,EGA.white); P(g,4,2,6,1,EGA.yellow); P(g,3,3,8,3,EGA.yellow);
    P(g,4,6,6,3,EGA.brown); P(g,5,9,4,2,EGA.brown); P(g,5,3,2,4,EGA.white); }
  SPR.biggem = big;

  const ammo = newSprite(12,12); { const g = ammo.getContext('2d');
    P(g,2,4,8,5,EGA.bred); P(g,2,3,8,1,EGA.white); P(g,2,9,8,1,EGA.red);
    P(g,4,1,4,3,EGA.yellow); P(g,5,5,2,3,EGA.white); }
  SPR.ammo = ammo;

  const life = newSprite(12,12); { const g = life.getContext('2d');
    // 1-up helmet token
    P(g,3,2,6,2,C.helmet); P(g,2,4,8,4,C.helmet); P(g,2,4,8,1,C.helmetHi);
    P(g,2,8,8,1,C.helmetD); P(g,4,5,1,1,EGA.white); }
  SPR.life = life;
}

/* heart icon for HUD */
function drawHeart(g, x, y, full) {
  g.fillStyle = full ? EGA.bred : EGA.dgray;
  g.fillRect(x+1,y,2,1); g.fillRect(x+5,y,2,1);
  g.fillRect(x,y+1,8,2); g.fillRect(x+1,y+3,6,1);
  g.fillRect(x+2,y+4,4,1); g.fillRect(x+3,y+5,2,1);
  if (full){ g.fillStyle = EGA.white; g.fillRect(x+1,y+1,2,1); }
}

/* --------------------------- THEMES -------------------------------- */
const THEMES = {
  surface: { sky:[EGA.blue, EGA.bblue, EGA.bcyan], grass:EGA.bgreen, grassD:EGA.green,
             dirt:EGA.brown, dirtD:EGA.black, block:EGA.lgray, blockD:EGA.dgray,
             accent:EGA.bgreen, spike:EGA.lgray, spikeD:EGA.dgray },
  cavern:  { sky:[EGA.black, EGA.black, EGA.blue], grass:EGA.lgray, grassD:EGA.dgray,
             dirt:EGA.dgray, dirtD:EGA.black, block:EGA.bblue, blockD:EGA.blue,
             accent:EGA.bcyan, spike:EGA.white, spikeD:EGA.dgray },
  fortress:{ sky:[EGA.black, EGA.black, EGA.red], grass:EGA.lgray, grassD:EGA.dgray,
             dirt:EGA.dgray, dirtD:EGA.black, block:EGA.lgray, blockD:EGA.dgray,
             accent:EGA.bred, spike:EGA.yellow, spikeD:EGA.red },
};

/* parallax backdrop cache per theme */
const bgCache = {};
function makeBackdrop(theme) {
  if (bgCache[theme]) return bgCache[theme];
  const far = newSprite(W, H), mid = newSprite(W, H);
  const t = THEMES[theme];
  // far layer: silhouettes
  const gf = far.getContext('2d');
  // seeded pseudo-random
  let s = theme.length * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  if (theme === 'surface') {
    for (let i = 0; i < 40; i++) { const x = rnd()*W, y = rnd()*60; gf.fillStyle=EGA.white; gf.globalAlpha=0.5+rnd()*0.5; gf.fillRect(x,y,1,1); }
    gf.globalAlpha = 1;
    gf.fillStyle = EGA.blue;
    for (let x = -20; x < W+20; x += 46) { const h = 50+rnd()*40; gf.beginPath(); gf.moveTo(x,H); gf.lineTo(x+23,H-h); gf.lineTo(x+46,H); gf.fill(); }
  } else if (theme === 'cavern') {
    for (let i = 0; i < 60; i++) { gf.fillStyle = t.accent; gf.globalAlpha = 0.15+rnd()*0.25; const x=rnd()*W,y=rnd()*H; gf.fillRect(x,y,1,1); }
    gf.globalAlpha = 1; gf.fillStyle = EGA.dgray;
    for (let x = 0; x < W; x += 30) { const h = 24+rnd()*40; gf.beginPath(); gf.moveTo(x,0); gf.lineTo(x+15,h); gf.lineTo(x+30,0); gf.fill(); }
  } else {
    gf.fillStyle = EGA.dgray;
    for (let i=0;i<26;i++){ const x=rnd()*W,y=rnd()*H,w=8+rnd()*22; gf.fillRect(x,y,w,3); }
    gf.fillStyle = t.accent; gf.globalAlpha=0.2;
    for (let i=0;i<30;i++){ gf.fillRect(rnd()*W,rnd()*H,2,2);} gf.globalAlpha=1;
  }
  // mid layer: hills/structures
  const gm = mid.getContext('2d');
  gm.fillStyle = theme === 'surface' ? EGA.green : theme === 'cavern' ? EGA.dgray : EGA.red;
  for (let x = -10; x < W+40; x += 64) { const h = 40+rnd()*50; gm.beginPath(); gm.moveTo(x,H); gm.lineTo(x+10,H-h); gm.lineTo(x+50,H-h*0.7); gm.lineTo(x+64,H); gm.fill(); }
  bgCache[theme] = { far, mid };
  return bgCache[theme];
}

/* --------------------------- LEVELS -------------------------------- */
/* Built with a small DSL to guarantee aligned, valid maps.
   Chars in grid: ' ' air, '#' ground, 'B' block, 'T' one-way platform,
   '^' spikes, 'D' door, 'o' gem, 'G' big gem, 'a' ammo, 'h' 1-up,
   'y' yorp, 'b' bloog, 'f' flyer, 'P' start. */
function makeLevel(cols, theme, name, hint) {
  const g = [];
  for (let r = 0; r < ROWS; r++) g.push(new Array(cols).fill(' '));
  const set = (c, r, ch) => { if (r>=0 && r<ROWS && c>=0 && c<cols) g[r][c] = ch; };
  return {
    cols, theme, name, hint, g, set,
    ground(c0, c1, top) { for (let c=c0;c<=c1;c++) for (let r=top;r<ROWS;r++) set(c,r,'#'); return this; },
    block(c, r, w=1, h=1) { for (let i=0;i<w;i++) for (let j=0;j<h;j++) set(c+i,r+j,'B'); return this; },
    plat(c, r, len) { for (let i=0;i<len;i++) set(c+i,r,'T'); return this; },
    spikes(c, r, len) { for (let i=0;i<len;i++) set(c+i,r,'^'); return this; },
    put(c, r, ch) { set(c,r,ch); return this; },
    row(arr) { return this; },
  };
}

function buildLevels() {
  const L = [];

  /* ---- Level 1: Verdant Outpost (surface, gentle) ---- */
  {
    const cols = 84;
    const m = makeLevel(cols, 'surface', 'Verdant Outpost', 'Find the exit. Hop the gaps!');
    m.ground(0, 17, 11);
    m.put(2, 10, 'P');
    for (let c=3;c<=10;c++) m.put(c,10,'o');
    m.plat(13, 8, 4); m.put(14,7,'o'); m.put(15,7,'o');
    m.put(20,10,'y');
    m.ground(18, 25, 11);          // 2-tile pit at cols 26-27 (comfortably jumpable)
    m.put(22,10,'a');
    m.ground(28, 41, 11);          // 2-tile pit at cols 42-43
    m.put(30,10,'y'); m.put(36,10,'b');
    m.plat(31,8,3); m.put(32,7,'o');
    m.block(34,8,1,1); m.block(35,7,1,1); m.put(35,6,'o');
    m.spikes(38,10,2);
    m.ground(44, 60, 11);
    m.put(46,10,'a'); m.put(48,10,'f');
    m.plat(50,8,4); m.put(51,7,'o'); m.put(52,7,'o'); m.put(53,7,'G');
    m.put(56,10,'y'); m.put(58,10,'b');
    m.ground(62, cols-1, 11);
    m.put(63,10,'f');
    m.plat(66,8,3); m.put(67,7,'o');
    m.block(70,9,1,2); m.put(70,8,'o');
    m.put(74,10,'h');               // extra life reward
    m.put(78,10,'o'); m.put(79,10,'o');
    m.put(cols-2, 10, 'D');
    L.push(m);
  }

  /* ---- Level 2: Crystal Caves (cavern, vertical + flyers) ---- */
  {
    const cols = 92;
    const m = makeLevel(cols, 'cavern', 'Crystal Caves', 'Mind the flyers and the spikes.');
    m.ground(0, 10, 11);
    m.put(2, 10, 'P');
    m.put(4,10,'o'); m.put(5,10,'o'); m.put(6,10,'a');
    m.block(9,9,1,2); m.put(9,8,'o');
    m.plat(11,9,3); m.plat(15,7,3); m.plat(19,5,3);
    m.put(16,6,'o'); m.put(20,4,'o'); m.put(21,4,'G');
    m.put(13,8,'f');
    m.ground(22, 34, 11);
    m.spikes(24,10,2); m.put(28,10,'b');
    m.plat(26,7,2); m.put(26,6,'o');
    m.put(31,10,'f'); m.put(33,10,'a');
    // descending pit area
    m.ground(35, 35, 11); m.block(35,9,1,2);
    m.ground(38, 50, 11);
    m.put(40,10,'y'); m.put(44,10,'f'); m.put(47,10,'b');
    m.plat(41,8,3); m.plat(45,6,3); m.put(46,5,'o'); m.put(42,7,'o');
    m.spikes(48,10,2);
    m.ground(52, 66, 11);
    m.put(54,10,'f'); m.put(57,10,'f');
    m.block(59,9,2,2); m.put(60,8,'G');          // 2-wide 32px block, big gem landable by normal jump
    m.put(63,10,'a'); m.put(64,10,'b');
    m.ground(68, cols-1, 11);
    m.plat(70,8,3); m.put(71,7,'o'); m.put(72,7,'o');
    m.put(75,10,'f'); m.put(78,10,'h');
    m.plat(80,7,4); m.put(81,6,'o'); m.put(82,6,'o'); m.put(83,6,'o');
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 3: Iron Fortress (fortress, tougher) ---- */
  {
    const cols = 100;
    const m = makeLevel(cols, 'fortress', 'Iron Fortress', 'The boss-bots run hot. Keep moving.');
    // -- opening: continuous safe floor; hop a 2-tall block, then a 2-wide spike strip --
    m.ground(0, 31, 11);
    m.put(2, 10, 'P'); m.put(4,10,'a'); m.put(5,10,'a');
    m.put(8,10,'b'); m.put(11,10,'y');
    m.block(14,9,1,2); m.put(14,8,'o');          // 32px hop-over, gem on top (normal-jump reachable)
    m.put(17,10,'o');
    m.spikes(20,10,2);                            // jump the spikes (flat ground both sides)
    m.put(24,10,'b'); m.put(27,10,'f');
    m.plat(22,8,2); m.put(22,7,'o'); m.plat(26,7,3); m.put(27,6,'G');
    // -- mid: fair 2-tile pits, stacked platforms, enemies --
    m.ground(34, 47, 11);                         // 2-tile pit at cols 32-33
    m.put(36,10,'y'); m.put(39,10,'b'); m.put(43,10,'f'); m.put(45,10,'b');
    m.plat(37,8,2); m.plat(41,6,3); m.put(42,5,'o'); m.put(37,7,'o');
    m.put(46,10,'a');
    m.ground(50, 66, 11);                         // 2-tile pit at cols 48-49 (no spikes)
    m.put(52,10,'b'); m.put(55,10,'f'); m.put(58,10,'b'); m.put(62,10,'y');
    m.block(54,9,1,2);
    m.block(59,9,1,2); m.put(59,8,'G');           // 32px block, big gem reachable by normal jump
    m.plat(60,6,3); m.put(61,5,'o');
    m.put(64,10,'a'); m.put(65,10,'h');
    // -- final stretch: continuous ground, one jump-over spike strip, then the exit --
    m.ground(67, cols-1, 11);
    m.spikes(69,10,2);                            // jump-over on flat ground
    m.put(73,10,'f'); m.put(76,10,'b'); m.put(79,10,'f'); m.put(82,10,'b');
    m.plat(74,8,3); m.put(75,7,'o'); m.plat(80,7,3); m.put(81,6,'o');
    m.block(86,9,1,2); m.put(86,8,'o');
    m.put(90,10,'a'); m.put(92,10,'o'); m.put(93,10,'o');
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 4: Tangled Thicket (surface, hoppers + a homing flyer) ---- */
  {
    const cols = 96;
    const m = makeLevel(cols, 'surface', 'Tangled Thicket', 'Hoppers leap — time your shots.');
    m.ground(0, 30, 11);
    m.put(2,10,'P'); m.put(4,10,'o'); m.put(5,10,'o');
    m.put(9,10,'j');
    m.plat(12,8,3); m.put(13,7,'o');
    m.put(15,10,'y');
    m.block(19,9,1,2); m.put(19,8,'o');
    m.put(22,10,'j'); m.put(26,10,'b');
    m.plat(24,7,3); m.put(25,6,'G');
    m.spikes(29,10,2);
    m.ground(34, 53, 11);                 // 3-tile pit 31-33
    m.put(36,10,'j'); m.put(41,10,'b'); m.put(45,10,'y');
    m.plat(38,8,3); m.put(39,7,'o');
    m.put(43,10,'a');
    m.plat(48,7,4); m.put(49,6,'o'); m.put(50,6,'o');
    m.put(52,10,'F');
    m.ground(57, 76, 11);                 // 3-tile pit 54-56
    m.put(59,10,'b'); m.put(63,10,'j'); m.put(68,10,'F');
    m.block(61,9,1,2); m.block(65,9,1,2); m.put(65,8,'G');
    m.put(71,10,'a'); m.put(72,10,'h');
    m.spikes(74,10,2);
    m.ground(79, cols-1, 11);             // 2-tile pit 77-78
    m.put(81,10,'j'); m.put(85,10,'b'); m.put(89,10,'F');
    m.plat(82,8,3); m.put(83,7,'o');
    m.put(91,10,'o'); m.put(92,10,'o');
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 5: Deep Hollows (cavern, vertical climb + flyer swarm) ---- */
  {
    const cols = 104;
    const m = makeLevel(cols, 'cavern', 'Deep Hollows', 'Climb past the swarm. Watch your footing.');
    m.ground(0, 12, 11);
    m.put(2,10,'P'); m.put(4,10,'o'); m.put(5,10,'a');
    m.put(9,10,'j');
    m.plat(13,9,3); m.plat(17,7,3); m.plat(21,5,3);   // climb over the chasm 13-23
    m.put(14,8,'o'); m.put(18,6,'o'); m.put(22,4,'G');
    m.ground(24, 40, 11);
    m.put(27,10,'F'); m.put(31,10,'j'); m.put(35,10,'b');
    m.plat(28,8,2); m.put(28,7,'o');
    m.spikes(33,10,2);
    m.block(38,9,1,2); m.put(38,8,'o');
    m.ground(44, 62, 11);                 // 3-tile pit 41-43
    m.put(46,10,'j'); m.put(50,10,'F'); m.put(55,10,'b'); m.put(59,10,'F');
    m.plat(47,7,3); m.put(48,6,'G');
    m.block(52,9,1,2); m.spikes(57,10,2);
    m.put(61,10,'a');
    m.ground(66, 84, 11);                 // 3-tile pit 63-65
    m.put(68,10,'b'); m.put(72,10,'j'); m.put(76,10,'F'); m.put(80,10,'b');
    m.plat(69,8,3); m.put(70,7,'o'); m.plat(74,6,3); m.put(75,5,'G');
    m.put(82,10,'h'); m.spikes(78,10,2);
    m.ground(87, cols-1, 11);             // 2-tile pit 85-86
    m.put(89,10,'F'); m.put(93,10,'j'); m.put(97,10,'b');
    m.plat(90,8,3); m.put(91,7,'o');
    m.put(99,10,'o'); m.put(100,10,'o');
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 6: The Core (fortress, the gauntlet) ---- */
  {
    const cols = 112;
    const m = makeLevel(cols, 'fortress', 'The Core', 'Everything at once. Good luck, Commander.');
    m.ground(0, 14, 11);
    m.put(2,10,'P'); m.put(4,10,'a'); m.put(5,10,'a');
    m.put(8,10,'b'); m.spikes(10,10,2); m.put(13,10,'j');
    m.ground(18, 36, 11);                 // 3-tile pit 15-17
    m.put(20,10,'b'); m.put(24,10,'F'); m.put(28,10,'j'); m.put(32,10,'b');
    m.plat(21,8,2); m.put(21,7,'o'); m.plat(25,7,3); m.put(26,6,'G');
    m.block(30,9,1,2); m.spikes(34,10,2);
    m.ground(40, 60, 11);                 // 3-tile pit 37-39
    m.put(42,10,'j'); m.put(45,10,'b'); m.put(49,10,'F'); m.put(53,10,'b'); m.put(57,10,'F');
    m.plat(43,8,3); m.put(44,7,'o');
    m.block(47,9,1,2); m.put(47,8,'o');
    m.plat(51,6,3); m.put(52,5,'G');
    m.put(59,10,'a');
    m.ground(64, 86, 11);                 // 3-tile pit 61-63
    m.put(66,10,'b'); m.put(70,10,'j'); m.put(74,10,'F'); m.put(78,10,'b'); m.put(82,10,'F');
    m.plat(67,8,3); m.put(68,7,'o'); m.plat(76,7,3); m.put(77,6,'G');
    m.block(72,9,1,2); m.put(84,10,'h'); m.spikes(80,10,2);
    m.ground(89, cols-1, 11);             // 2-tile pit 87-88
    m.put(91,10,'F'); m.put(95,10,'b'); m.put(99,10,'j'); m.put(103,10,'F');
    m.plat(92,8,3); m.put(93,7,'o');
    m.put(105,10,'o'); m.put(106,10,'o'); m.put(108,10,'a');
    m.put(cols-2,10,'D');
    L.push(m);
  }

  return L;
}

/* --------------------------- ENTITIES ------------------------------ */
function makeEnemy(type, c, r) {
  const base = { type, dead:false, dyTimer:0, anim:0, dir: -1, sc:c, sr:r };
  if (type === 'yorp') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:12, vx:0, vy:0, speed:26, hp:1, fly:false });
  if (type === 'bloog') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:12, vx:0, vy:0, speed:50, hp:1, fly:false, charge:true });
  if (type === 'flyer') return Object.assign(base, { x:c*16, y:r*16, w:14, h:10, vx:0, vy:0, speed:42, hp:1, fly:true, homing:false, homeY:r*16 - 16, wasBlocked:false, t:Math.random()*6 });
  if (type === 'hopper') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:13, vx:0, vy:0, speed:0, hp:1, fly:false, hop:true, onGround:false, hopTimer:0.4 + Math.random()*0.8 });
  return base;
}
// Map a level-grid char to an enemy ('y' yorp, 'b' bloog, 'f' flyer, 'F' homing flyer, 'j' hopper)
const isEnemyChar = ch => ch==='y'||ch==='b'||ch==='f'||ch==='F'||ch==='j';
function enemyFromChar(ch, c, r) {
  const type = ch==='y'?'yorp':ch==='b'?'bloog':ch==='j'?'hopper':'flyer';
  const en = makeEnemy(type, c, r);
  if (ch === 'F') en.homing = true;
  return en;
}

/* --------------------------- GAME STATE ---------------------------- */
const Game = {
  state: 'title',      // title, levelcard, play, pause, dead, levelclear, gameover, victory
  levels: [],
  levelIndex: 0,
  grid: null, cols: 0, theme: 'surface', levelName: '',
  player: null,
  enemies: [], pickups: [], shots: [], particles: [],
  cam: { x: 0, y: 0 },
  lives: START_LIVES, hearts: MAX_HEARTS, ammo: START_AMMO,
  score: 0, gems: 0, gemsTotal: 0, levelScore: 0,
  timer: 0, flash: 0, shake: 0,
  menuSel: 0,
  highScore: 0,
};

function loadHigh() {
  try { Game.highScore = parseInt(localStorage.getItem('cosmo_high') || '0', 10) || 0; } catch(e){}
}
function saveHigh() {
  if (Game.score > Game.highScore) {
    Game.highScore = Game.score;
    try { localStorage.setItem('cosmo_high', String(Game.highScore)); } catch(e){}
  }
}

function newPlayer(start) {
  return {
    x: start.x + 3, y: start.y, w: 10, h: 14,
    vx: 0, vy: 0, dir: 1,
    onGround: false, coyote: 0, jumpBuf: 0, jumping: false,
    pogo: false, anim: 0, shootCool: 0, shootHold: 0,
    invuln: 0, state: 'stand',
  };
}

function loadLevel(idx) {
  const lvl = Game.levels[idx];
  Game.cols = lvl.cols; Game.theme = lvl.theme; Game.levelName = lvl.name;
  Game.grid = lvl.g.map(row => row.slice());
  Game.enemies = []; Game.pickups = []; Game.shots = []; Game.particles = [];
  Game.gems = 0; Game.gemsTotal = 0; Game.levelScore = 0;
  Game.defeated = new Set();   // enemy spawns already cleared this level (persist across respawns)
  let start = { x: 32, y: 160 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < lvl.cols; c++) {
      const ch = Game.grid[r][c];
      if (ch === 'P') { start = { x: c*16, y: r*16 }; Game.grid[r][c] = ' '; }
      else if (isEnemyChar(ch)) {
        Game.enemies.push(enemyFromChar(ch, c, r));
        Game.grid[r][c] = ' ';
      } else if (ch === 'o' || ch === 'G' || ch === 'a' || ch === 'h') {
        const kind = ch==='o'?'gem':ch==='G'?'biggem':ch==='a'?'ammo':'life';
        Game.pickups.push({ kind, x:c*16, y:r*16, w:16, h:16, t:Math.random()*6, taken:false });
        if (kind === 'gem' || kind === 'biggem') Game.gemsTotal++;
        Game.grid[r][c] = ' ';
      }
    }
  }
  Game.player = newPlayer(start);
  Game.cam.x = clamp(Game.player.x - W/2, 0, Game.cols*16 - W);
  Game.cam.y = 0;
  Game.startPos = start;
}

function startGame() {
  Game.levelIndex = 0;
  Game.lives = START_LIVES; Game.hearts = MAX_HEARTS; Game.ammo = START_AMMO;
  Game.score = 0;
  buildWorldMap();
  Game.state = 'worldmap';
}
function enterLevelCard() { Game.state = 'levelcard'; Game.timer = 1.8; }

/* ---- Overworld map: walk between level nodes, enter to play ---- */
function buildWorldMap() {
  const n = Game.levels.length, x0 = 42, x1 = W - 42;
  const nodes = Game.levels.map((lvl, i) => ({
    x: Math.round(n > 1 ? x0 + (i/(n-1))*(x1-x0) : (x0+x1)/2),
    y: 150 - (i % 2) * 46,                  // zigzag path
    name: lvl.name, theme: lvl.theme
  }));
  Game.map = {
    nodes, cur: 0, maxUnlocked: 0, done: nodes.map(() => false), t: 0,
    hero: { x: nodes[0].x, y: nodes[0].y, tx: nodes[0].x, ty: nodes[0].y, moving: false, dir: 1 }
  };
}
function placeHeroOnNode(i) {
  const m = Game.map, nd = m.nodes[i];
  m.cur = i; m.hero.x = nd.x; m.hero.y = nd.y; m.hero.tx = nd.x; m.hero.ty = nd.y; m.hero.moving = false;
}
function enterMapLevel() {
  Game.levelIndex = Game.map.cur;
  loadLevel(Game.levelIndex);
  enterLevelCard();
  SFX.exit();
}
function updateWorldMap(dt) {
  const m = Game.map, h = m.hero; m.t += dt;
  if (h.moving) {
    h.x = lerp(h.x, h.tx, 1 - Math.pow(0.00005, dt));
    h.y = lerp(h.y, h.ty, 1 - Math.pow(0.00005, dt));
    if (Math.abs(h.x - h.tx) < 0.7 && Math.abs(h.y - h.ty) < 0.7) { h.x = h.tx; h.y = h.ty; h.moving = false; }
    return;
  }
  const maxReach = Math.min(m.nodes.length - 1, m.maxUnlocked);
  if (pressed.right && m.cur < maxReach) { const nd = m.nodes[++m.cur]; h.tx = nd.x; h.ty = nd.y; h.moving = true; h.dir = 1; SFX.bump(); }
  else if (pressed.left && m.cur > 0) { const nd = m.nodes[--m.cur]; h.tx = nd.x; h.ty = nd.y; h.moving = true; h.dir = -1; SFX.bump(); }
  else if (pressed.jump || pressed.start) { enterMapLevel(); }
}
function respawn() {
  Game.hearts = MAX_HEARTS;
  Game.player = newPlayer(Game.startPos);
  Game.player.invuln = 1.0;
  Game.cam.x = clamp(Game.player.x - W/2, 0, Game.cols*16 - W);
  Game.shots = [];
  // restore non-collected pickups? keep collected. reset enemies positions of this level:
  loadEnemiesOnly();
  Game.state = 'play';
}
function loadEnemiesOnly() {
  const lvl = Game.levels[Game.levelIndex];
  Game.enemies = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < lvl.cols; c++) {
    const ch = lvl.g[r][c];
    if (isEnemyChar(ch) && !Game.defeated.has(c + ',' + r))
      Game.enemies.push(enemyFromChar(ch, c, r));
  }
}

/* --------------------------- COLLISION ----------------------------- */
function tileAt(c, r) {
  if (c < 0 || c >= Game.cols) return '#';   // walls on sides
  if (r < 0 || r >= ROWS) return ' ';
  return Game.grid[r][c];
}
const isSolid = ch => ch === '#' || ch === 'B';
const isOneway = ch => ch === 'T';
const isHazard = ch => ch === '^';

function moveX(e) {
  e.x += e.vx * DT;
  e.hitWall = false;
  const top = Math.floor(e.y / 16), bot = Math.floor((e.y + e.h - 1) / 16);
  if (e.vx > 0) {
    const c = Math.floor((e.x + e.w - 1) / 16);
    for (let r = top; r <= bot; r++) if (isSolid(tileAt(c, r))) { e.x = c*16 - e.w; e.vx = 0; e.hitWall = true; break; }
  } else if (e.vx < 0) {
    const c = Math.floor(e.x / 16);
    for (let r = top; r <= bot; r++) if (isSolid(tileAt(c, r))) { e.x = (c+1)*16; e.vx = 0; e.hitWall = true; break; }
  }
}
function moveY(e) {
  const prevBottom = e.y + e.h;
  e.y += e.vy * DT;
  e.onGround = false; e.hitCeil = false;
  const left = Math.floor(e.x / 16), right = Math.floor((e.x + e.w - 1) / 16);
  if (e.vy > 0) {
    const r = Math.floor((e.y + e.h - 1) / 16);
    let landed = false;
    for (let c = left; c <= right; c++) if (isSolid(tileAt(c, r))) { e.y = r*16 - e.h; e.vy = 0; e.onGround = true; landed = true; break; }
    if (!landed && !e.dropThru) {
      for (let c = left; c <= right; c++) {
        if (isOneway(tileAt(c, r))) {
          const platTop = r*16;
          if (prevBottom <= platTop + 1) { e.y = platTop - e.h; e.vy = 0; e.onGround = true; landed = true; break; }
        }
      }
    }
  } else if (e.vy < 0) {
    const r = Math.floor(e.y / 16);
    for (let c = left; c <= right; c++) if (isSolid(tileAt(c, r))) { e.y = (r+1)*16; e.vy = 0; e.hitCeil = true; break; }
  }
}
function touchingHazard(e) {
  const c0 = Math.floor((e.x+1)/16), c1 = Math.floor((e.x+e.w-2)/16);
  const r0 = Math.floor((e.y+1)/16), r1 = Math.floor((e.y+e.h-1)/16);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isHazard(tileAt(c, r))) return true;
  return false;
}

/* --------------------------- PARTICLES ----------------------------- */
function spawnBurst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = (0.4 + Math.random()) * (spd || 90);
    Game.particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s - 30, life: 0.5+Math.random()*0.4,
      color, size: 1 + (Math.random()*2|0), grav: 240 });
  }
}
function spawnDust(x, y) {
  for (let i = 0; i < 5; i++)
    Game.particles.push({ x, y, vx:(Math.random()*2-1)*40, vy:-Math.random()*40, life:0.3, color:'#ffffff', size:1, grav:120 });
}

/* --------------------------- UPDATE -------------------------------- */
let DT = 1/60;

function updatePlay(dt) {
  DT = dt;
  const p = Game.player;
  Game.timer += dt;

  // ---- horizontal input ----
  const dirIn = (held.right?1:0) - (held.left?1:0);
  if (dirIn !== 0) {
    p.vx += dirIn * RUN_ACCEL * dt;
    p.vx = clamp(p.vx, -RUN_SPEED, RUN_SPEED);
    p.dir = dirIn;
  } else {
    if (p.vx > 0) p.vx = Math.max(0, p.vx - RUN_FRICT*dt);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + RUN_FRICT*dt);
  }

  // ---- pogo toggle ----
  if (pressed.pogo) { p.pogo = !p.pogo; SFX.select(); }

  // ---- gravity ----
  p.vy += GRAV * dt;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;

  // ---- timers ----
  if (p.onGround) p.coyote = COYOTE; else p.coyote = Math.max(0, p.coyote - dt);
  if (pressed.jump) p.jumpBuf = JUMP_BUF; else p.jumpBuf = Math.max(0, p.jumpBuf - dt);
  p.shootCool = Math.max(0, p.shootCool - dt);
  if (p.invuln > 0) p.invuln -= dt;

  const wasGround = p.onGround;

  // ---- jump / pogo ----
  if (p.pogo) {
    if (p.onGround) {
      const sup = held.jump;
      p.vy = -(sup ? POGO_SUPER : POGO_BOUNCE);
      if (sup) SFX.superpogo(); else SFX.pogo();
      spawnDust(p.x + p.w/2, p.y + p.h);
    }
  } else {
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -JUMP_VEL; p.jumping = true; p.coyote = 0; p.jumpBuf = 0;
      SFX.jump(); spawnDust(p.x + p.w/2, p.y + p.h);
    }
    if (!held.jump && p.jumping && p.vy < -JUMP_CUT) p.vy = -JUMP_CUT;
    if (p.vy >= 0) p.jumping = false;
  }

  // ---- move + collide ----
  moveX(p);
  moveY(p);
  if (p.hitCeil) p.vy = 0;

  // landing dust
  if (!wasGround && p.onGround && Math.abs(p.vy) < 1) spawnDust(p.x + p.w/2, p.y + p.h);

  // ---- shoot ----
  if (pressed.shoot && p.shootCool <= 0 && Game.ammo > 0) {
    Game.ammo--;
    p.shootCool = SHOT_COOL;
    const sx = p.dir > 0 ? p.x + p.w : p.x - 6;
    Game.shots.push({ x: sx, y: p.y + 4, w: 6, h: 4, vx: p.dir * SHOT_SPEED, life: 1.2, dir: p.dir });
    SFX.shoot();
    p.shootHold = 0.12;
  }
  if (p.shootHold > 0) p.shootHold -= dt;

  // ---- hazards / fall death ----
  if (touchingHazard(p) || p.y > ROWS*16 + 24) { killPlayer(); return; }

  // ---- player anim state ----
  if (!p.onGround) p.state = p.pogo ? 'pogo' : 'jump';
  else if (Math.abs(p.vx) > 6) p.state = 'run';
  else p.state = 'stand';
  p.anim += dt * (p.state === 'run' ? 10 : 6);

  // ---- camera ----
  const targetX = clamp(p.x + p.w/2 - W/2, 0, Math.max(0, Game.cols*16 - W));
  Game.cam.x = lerp(Game.cam.x, targetX, 1 - Math.pow(0.001, dt));
  if (Math.abs(Game.cam.x - targetX) < 0.3) Game.cam.x = targetX;

  // ---- shots ----
  for (const s of Game.shots) {
    s.x += s.vx * dt; s.life -= dt;
    const c = Math.floor((s.dir>0 ? s.x+s.w : s.x)/16), r = Math.floor((s.y+s.h/2)/16);
    if (isSolid(tileAt(c, r))) { s.life = 0; spawnBurst(s.x, s.y, THEMES[Game.theme].accent, 4, 60); SFX.bump(); }
  }
  Game.shots = Game.shots.filter(s => s.life > 0);

  // ---- enemies ----
  for (const e of Game.enemies) {
    if (e.dead) { e.dyTimer -= dt; continue; }
    e.anim += dt * 6;
    if (e.fly) {
      e.t += dt;
      if (e.homing) {
        // gentle aerial pursuit — drift toward the player in x and y with a soft bob
        e.dir = (p.x + p.w/2 >= e.x + e.w/2) ? 1 : -1;
        const nx = e.x + e.dir * e.speed * dt;
        const ncx = Math.floor((nx + e.w/2)/16), rr = Math.floor((e.homeY + e.h/2)/16);
        if (!isSolid(tileAt(ncx, rr)) && nx > 0 && nx < Game.cols*16 - e.w) e.x = nx;
        const ty = clamp(p.y - 4, 8, (ROWS-3)*16);
        e.homeY += Math.sign(ty - e.homeY) * (e.speed * 0.6) * dt;
        e.y = e.homeY + Math.sin(e.t * 3) * 5;
      } else {
        // bob + patrol; edge-triggered wall bounce at a FIXED reference height
        e.x += e.dir * e.speed * dt;
        e.y = e.homeY + Math.sin(e.t * 2.4) * 16;
        const rr = Math.floor((e.homeY + e.h/2) / 16);
        const cc = Math.floor((e.dir > 0 ? e.x + e.w : e.x) / 16);
        const blocked = isSolid(tileAt(cc, rr)) || e.x < 0 || e.x > Game.cols*16 - e.w;
        if (blocked && !e.wasBlocked) e.dir *= -1;
        e.wasBlocked = blocked;
      }
    } else if (e.hop) {
      // grounded creature that leaps in arcs; turns at walls and ledges
      e.vy += GRAV * dt; if (e.vy > MAX_FALL) e.vy = MAX_FALL;
      if (e.onGround) {
        e.vx = 0; e.hopTimer -= dt;
        if (e.hopTimer <= 0) { e.vy = -300; e.vx = e.dir * 72; e.hopTimer = 0.7 + Math.random()*0.9; }
      }
      moveX(e);
      if (e.hitWall) { e.dir *= -1; e.vx = e.dir * Math.abs(e.vx); }
      moveY(e);
      if (e.onGround) {
        const aheadC = e.dir > 0 ? Math.floor((e.x+e.w+1)/16) : Math.floor((e.x-1)/16);
        const footR = Math.floor((e.y+e.h+1)/16);
        if (!isSolid(tileAt(aheadC, footR)) && !isOneway(tileAt(aheadC, footR))) e.dir *= -1;
      }
    } else {
      // ground walker; "charge" types speed up + steer toward a nearby same-height player
      e.vy += GRAV * dt; if (e.vy > MAX_FALL) e.vy = MAX_FALL;
      let spd = e.speed;
      if (e.charge) {
        const dx = Math.abs((p.x+p.w/2) - (e.x+e.w/2));
        const sameRow = Math.abs((p.y + p.h) - (e.y + e.h)) < 22;
        if (dx < 88 && sameRow) { spd = e.speed * 1.7; e.dir = ((p.x+p.w/2) >= (e.x+e.w/2)) ? 1 : -1; }
      }
      e.vx = e.dir * spd;
      moveX(e);
      if (e.hitWall) e.dir *= -1;
      moveY(e);
      const aheadC = e.dir > 0 ? Math.floor((e.x+e.w+1)/16) : Math.floor((e.x-1)/16);
      const footR = Math.floor((e.y+e.h+1)/16);
      if (e.onGround && !isSolid(tileAt(aheadC, footR)) && !isOneway(tileAt(aheadC, footR))) e.dir *= -1;
    }
    if (!e.fly && e.y > (ROWS + 2) * 16) { e.dead = true; e.dyTimer = 0; }   // fell in a pit
    // shot collision
    for (const s of Game.shots) {
      if (s.life > 0 && aabb(s, e)) {
        s.life = 0; e.hp--;
        spawnBurst(e.x+e.w/2, e.y+e.h/2, '#fff', 6, 80);
        if (e.hp <= 0) { defeatEnemy(e); }
        else SFX.bump();
      }
    }
    // player collision
    if (!e.dead && p.invuln <= 0 && aabb(p, e)) hurtPlayer(e);
  }
  Game.enemies = Game.enemies.filter(e => !(e.dead && e.dyTimer <= 0));

  // ---- pickups ----
  for (const k of Game.pickups) {
    if (k.taken) continue;
    k.t += dt;
    if (aabb(p, k)) collect(k);
  }
  Game.pickups = Game.pickups.filter(k => !k.taken);

  // ---- door / level clear ----
  const dc0 = Math.floor((p.x+p.w/2)/16), dr = Math.floor((p.y+p.h/2)/16);
  if (tileAt(dc0, dr) === 'D' || tileAt(Math.floor((p.x+p.w/2)/16), Math.floor(p.y/16)) === 'D') {
    levelClear();
  }

  // ---- particles ----
  updateParticles(dt);
  if (Game.shake > 0) Game.shake = Math.max(0, Game.shake - dt*60);
  if (Game.flash > 0) Game.flash = Math.max(0, Game.flash - dt*4);
}

function updateParticles(dt) {
  for (const pt of Game.particles) {
    pt.vy += (pt.grav||0) * dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
  }
  Game.particles = Game.particles.filter(pt => pt.life > 0);
}

function defeatEnemy(e) {
  e.dead = true; e.dyTimer = 0.4;
  Game.defeated.add(e.sc + ',' + e.sr);   // stays cleared across respawns (no death-farming)
  Game.score += 150; Game.levelScore += 150;
  spawnBurst(e.x+e.w/2, e.y+e.h/2, e.type==='flyer'?EGA.yellow:e.type==='bloog'?EGA.bmagenta:EGA.bgreen, 12, 120);
  Game.shake = Math.max(Game.shake, 4);
  SFX.enemy();
}

function hurtPlayer(e) {
  const p = Game.player;
  Game.hearts--;
  p.invuln = INVULN;
  p.vx = (p.x < e.x ? -1 : 1) * 150;
  p.vy = -180;
  Game.shake = 6; Game.flash = 0.6;
  SFX.hurt();
  if (Game.hearts <= 0) killPlayer();
}

function killPlayer() {
  if (Game.state !== 'play') return;
  Game.lives--;
  Game.state = 'dead';
  Game.timer = 1.2;
  Game.shake = 8; Game.flash = 0.8;
  spawnBurst(Game.player.x+5, Game.player.y+7, C.shirt, 16, 140);
  SFX.die();
}

function collect(k) {
  k.taken = true;
  if (k.kind === 'gem') { Game.score += 100; Game.levelScore += 100; Game.gems++; SFX.pickup(); }
  else if (k.kind === 'biggem') { Game.score += 500; Game.levelScore += 500; Game.gems++; SFX.biggem(); }
  else if (k.kind === 'ammo') { Game.ammo += 5; SFX.pickup(); }
  else if (k.kind === 'life') { Game.lives++; SFX.life(); }
  spawnBurst(k.x+8, k.y+8, k.kind==='ammo'?EGA.bred:k.kind==='life'?C.helmetHi:EGA.bcyan, 8, 70);
}

function levelClear() {
  Game.state = 'levelclear';
  Game.timer = 2.2;
  Game.score += 500; // clear bonus
  if (Game.gemsTotal > 0 && Game.gems >= Game.gemsTotal) { Game.score += 1000; Game.perfect = true; }
  else Game.perfect = false;
  saveHigh();
  SFX.exit();
}

/* --------------------------- RENDER -------------------------------- */
function drawBackdrop() {
  const t = THEMES[Game.theme];
  // sky gradient
  const grad = bx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, t.sky[0]); grad.addColorStop(0.55, t.sky[1]); grad.addColorStop(1, t.sky[2]);
  bx.fillStyle = grad; bx.fillRect(0, 0, W, H);
  const bd = makeBackdrop(Game.theme);
  const fx = -(Game.cam.x * 0.2) % W;
  bx.drawImage(bd.far, fx, 0); bx.drawImage(bd.far, fx + W, 0);
  const mx = -(Game.cam.x * 0.5) % W;
  bx.drawImage(bd.mid, mx, 0); bx.drawImage(bd.mid, mx + W, 0);
}

function drawTile(ch, sx, sy, c, r) {
  const t = THEMES[Game.theme];
  if (ch === '#') {
    const above = tileAt(c, r-1);
    if (!isSolid(above) && above !== 'T') {
      bx.fillStyle = t.grass; bx.fillRect(sx, sy, 16, 4);
      bx.fillStyle = t.accent; bx.fillRect(sx, sy, 16, 1);
      bx.fillStyle = t.dirt; bx.fillRect(sx, sy+4, 16, 12);
    } else { bx.fillStyle = t.dirt; bx.fillRect(sx, sy, 16, 16); }
    bx.fillStyle = t.dirtD;
    bx.fillRect(sx, sy+15, 16, 1); bx.fillRect(sx+15, sy+4, 1, 12);
    bx.fillStyle = 'rgba(255,255,255,0.05)'; bx.fillRect(sx+2, sy+6, 2, 2); bx.fillRect(sx+9, sy+10, 2, 2);
  } else if (ch === 'B') {
    bx.fillStyle = t.block; bx.fillRect(sx, sy, 16, 16);
    bx.fillStyle = 'rgba(255,255,255,0.22)'; bx.fillRect(sx, sy, 16, 2); bx.fillRect(sx, sy, 2, 16);
    bx.fillStyle = t.blockD; bx.fillRect(sx, sy+14, 16, 2); bx.fillRect(sx+14, sy, 2, 16);
    bx.fillStyle = t.blockD; bx.fillRect(sx+6, sy+6, 4, 4);
    bx.fillStyle = 'rgba(255,255,255,0.15)'; bx.fillRect(sx+6, sy+6, 2, 2);
  } else if (ch === 'T') {
    bx.fillStyle = t.block; bx.fillRect(sx, sy, 16, 5);
    bx.fillStyle = t.accent; bx.fillRect(sx, sy, 16, 1);
    bx.fillStyle = t.blockD; bx.fillRect(sx, sy+4, 16, 1);
    bx.fillStyle = t.blockD; bx.fillRect(sx+3, sy+5, 1, 3); bx.fillRect(sx+12, sy+5, 1, 3);
  } else if (ch === '^') {
    bx.fillStyle = t.spike;
    for (let i = 0; i < 4; i++) {
      const x = sx + i*4;
      bx.beginPath(); bx.moveTo(x, sy+16); bx.lineTo(x+2, sy+5); bx.lineTo(x+4, sy+16); bx.closePath(); bx.fill();
    }
    bx.fillStyle = t.spikeD; bx.fillRect(sx, sy+14, 16, 2);   // dark base — separates spikes from the ground cap
  } else if (ch === 'D') {
    // glowing exit door
    const pulse = 0.5 + 0.5*Math.sin(Game.timer*4);
    bx.fillStyle = EGA.black; bx.fillRect(sx+1, sy-16, 14, 32);
    bx.fillStyle = t.accent; bx.globalAlpha = 0.4 + 0.4*pulse;
    bx.fillRect(sx+3, sy-14, 10, 28); bx.globalAlpha = 1;
    bx.fillStyle = EGA.white; bx.fillRect(sx+6, sy-2, 4, 4);
    bx.fillStyle = EGA.black; bx.fillRect(sx, sy-16, 16, 1); bx.fillRect(sx, sy-16, 1, 32); bx.fillRect(sx+15, sy-16, 1, 32);
  }
}

function drawWorld() {
  const camx = Math.floor(Game.cam.x);
  const c0 = Math.max(0, Math.floor(camx/16)), c1 = Math.min(Game.cols-1, Math.floor((camx+W)/16)+1);
  // Single top-to-bottom tile pass. The exit door ('D') draws one tile taller than
  // its cell (upward). Level invariant: keep the cell directly above any 'D' empty.
  for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) {
    const ch = Game.grid[r][c];
    if (ch === ' ') continue;
    drawTile(ch, c*16 - camx, r*16, c, r);
  }

  // pickups
  for (const k of Game.pickups) {
    if (k.taken) continue;
    const bobY = Math.sin(k.t*3) * 2;
    const sx = Math.floor(k.x - camx), sy = Math.floor(k.y + bobY);
    let spr = k.kind === 'gem' ? SPR.gem : k.kind === 'biggem' ? SPR.biggem : k.kind === 'ammo' ? SPR.ammo : SPR.life;
    // sparkle glow
    if ((k.kind==='biggem'||k.kind==='life') && Math.sin(k.t*6) > 0.6) {
      bx.fillStyle = 'rgba(255,255,255,0.5)'; bx.fillRect(sx+8, sy+1, 1, 1);
    }
    bx.drawImage(spr, sx + (16-spr.width)/2, sy + (16-spr.height)/2);
  }

  // enemies
  for (const e of Game.enemies) {
    const sx = Math.floor(e.x - camx), sy = Math.floor(e.y);
    if (e.dead) {
      // squashed flash
      bx.globalAlpha = clamp(e.dyTimer/0.4, 0, 1);
      bx.fillStyle = '#fff'; bx.fillRect(sx, sy+e.h-3, e.w, 3); bx.globalAlpha = 1;
      continue;
    }
    const fr = e.hop ? (e.onGround ? 0 : 1) : (Math.floor(e.anim) % 2);
    const key = e.type + '_' + fr + '_' + (e.dir>0?'R':'L');
    const spr = SPR[key];
    if (spr) bx.drawImage(spr, sx + (e.w-spr.width)/2, sy + (e.h-spr.height));
  }

  // shots
  for (const s of Game.shots) {
    const sx = Math.floor(s.x - camx), sy = Math.floor(s.y);
    bx.fillStyle = C.gunGlow; bx.fillRect(sx, sy, 6, 4);
    bx.fillStyle = '#fff'; bx.fillRect(sx + (s.dir>0?4:0), sy+1, 2, 2);
  }

  // player
  const p = Game.player;
  if (p) {
    const blink = p.invuln > 0 && Math.floor(p.invuln*16) % 2 === 0;
    if (!blink) {
      let frame = p.state;
      if (frame === 'run') frame = (Math.floor(p.anim) % 2) ? 'run1' : 'run2';
      if (p.shootHold > 0 && p.onGround && Math.abs(p.vx) < 6) frame = 'shoot';
      const key = 'hero_' + frame + '_' + (p.dir>0?'R':'L');
      const spr = SPR[key] || SPR['hero_stand_'+(p.dir>0?'R':'L')];
      const sx = Math.floor(p.x - camx) - 3, sy = Math.floor(p.y) - 4;
      // pogo stick
      if (p.pogo) {
        const stretch = clamp(1 + p.vy/600, 0.6, 1.3);
        bx.fillStyle = C.gunD; bx.fillRect(Math.floor(p.x - camx)+p.w/2-1, sy+16, 2, Math.floor(6*stretch));
        bx.fillStyle = C.gun;  bx.fillRect(Math.floor(p.x - camx)+p.w/2-2, sy+16+Math.floor(6*stretch), 4, 2);
      }
      bx.drawImage(spr, sx, sy);
    }
  }

  // particles
  for (const pt of Game.particles) {
    bx.globalAlpha = clamp(pt.life*2, 0, 1);
    bx.fillStyle = pt.color;
    bx.fillRect(Math.floor(pt.x - camx), Math.floor(pt.y), pt.size, pt.size);
  }
  bx.globalAlpha = 1;
}

/* HUD + text */
function txt(str, x, y, size, col, align, glow) {
  bx.font = '700 ' + size + 'px "Press Start 2P", "Courier New", monospace';
  bx.textAlign = align || 'left';
  bx.textBaseline = 'top';
  if (glow) { bx.fillStyle = glow; for (const [dx,dy] of [[1,1],[-1,1],[1,-1],[-1,-1],[0,1],[0,-1]]) bx.fillText(str, x+dx, y+dy); }
  else { bx.fillStyle = 'rgba(0,0,0,0.6)'; bx.fillText(str, x+1, y+1); }
  bx.fillStyle = col; bx.fillText(str, x, y);
}

function drawHUD() {
  // top bar
  bx.fillStyle = 'rgba(0,0,0,0.6)'; bx.fillRect(0, 0, W, 14);
  bx.fillStyle = EGA.dgray; bx.fillRect(0, 14, W, 1);
  txt('SCORE ' + String(Game.score).padStart(6,'0'), 4, 4, 7, EGA.yellow);
  // hearts
  for (let i = 0; i < MAX_HEARTS; i++) drawHeart(bx, 132 + i*10, 3, i < Game.hearts);
  // lives
  bx.drawImage(SPR.life, 170, 1, 12, 12);
  txt('x' + Game.lives, 184, 4, 7, EGA.white);
  // ammo
  bx.drawImage(SPR.ammo, 214, 1, 12, 12);
  txt('x' + Game.ammo, 228, 4, 7, Game.ammo>0?EGA.white:EGA.bred);
  // gems
  txt(Game.gems + '/' + Game.gemsTotal, W-4, 4, 7, EGA.bcyan, 'right');
}

function drawVignette() {
  if (Game.flash > 0) { bx.fillStyle = 'rgba(170,0,0,' + (Game.flash*0.45) + ')'; bx.fillRect(0,0,W,H); }
}

/* ----------------------- OVERLAY SCREENS --------------------------- */
function centerPanel(lines) {
  bx.fillStyle = 'rgba(6,8,18,0.78)'; bx.fillRect(0, 0, W, H);
}

function drawTitle() {
  drawBackdrop();
  // animated hero on title
  const t = Game.timer;
  bx.fillStyle = 'rgba(0,0,0,0.35)'; bx.fillRect(0,0,W,H);
  txt('COMMANDER', W/2, 34, 18, EGA.yellow, 'center', EGA.brown);
  txt('COSMO', W/2, 56, 22, EGA.bgreen, 'center', EGA.green);
  txt('GALACTIC POGO PATROL', W/2, 86, 7, EGA.bgreen, 'center');

  // bouncing hero
  const by = 118 + Math.abs(Math.sin(t*4))* -16;
  bx.drawImage(SPR['hero_pogo_R'], W/2-8, by);
  bx.fillStyle = C.gunD; bx.fillRect(W/2-1, by+18, 2, 8);

  const blink = Math.floor(t*2) % 2 === 0;
  if (blink) txt('PRESS ENTER TO START', W/2, 150, 8, EGA.white, 'center', EGA.black);
  txt('HIGH ' + String(Game.highScore).padStart(6,'0'), W/2, 172, 7, EGA.bcyan, 'center');
  txt('A/D MOVE   Z SHOOT   X POGO   SPACE JUMP', W/2, 188, 6, EGA.lgray, 'center');
  txt('M  MUSIC' + (musicOn?' ON':'')  + '   N  MUTE', W/2, 198, 6, EGA.lgray, 'center');
}

function drawWorldMap() {
  const m = Game.map, t = m.t;
  // EGA sky -> horizon
  const grad = bx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, EGA.bblue); grad.addColorStop(1, EGA.bcyan);
  bx.fillStyle = grad; bx.fillRect(0,0,W,H);
  // distant hills + grass band
  bx.fillStyle = EGA.green;
  for (let x=-10;x<W+40;x+=54){ bx.beginPath(); bx.moveTo(x,H); bx.lineTo(x+27,H-46); bx.lineTo(x+54,H); bx.fill(); }
  bx.fillStyle = EGA.bgreen; bx.fillRect(0, H-36, W, 36);
  bx.fillStyle = EGA.green; bx.fillRect(0, H-36, W, 2);
  // path
  bx.strokeStyle = EGA.brown; bx.lineWidth = 3; bx.beginPath();
  for (let i=0;i<m.nodes.length;i++){ const n=m.nodes[i]; i===0?bx.moveTo(n.x,n.y):bx.lineTo(n.x,n.y); }
  bx.stroke();
  bx.fillStyle = EGA.yellow;
  for (let i=0;i<m.nodes.length-1;i++){ const a=m.nodes[i],b=m.nodes[i+1]; for(let s=0.15;s<0.9;s+=0.16){ bx.fillRect(Math.round(lerp(a.x,b.x,s))-1, Math.round(lerp(a.y,b.y,s))-1, 2, 2);} }
  // nodes
  for (let i=0;i<m.nodes.length;i++){
    const n=m.nodes[i], locked=i>m.maxUnlocked, done=m.done[i];
    bx.fillStyle = locked?EGA.dgray:EGA.lgray; bx.fillRect(n.x-8, n.y-1, 16, 7);   // mound
    bx.fillStyle = locked?EGA.dgray:(done?EGA.bgreen:EGA.bred); bx.fillRect(n.x-5, n.y-10, 10, 9); // dome
    bx.fillStyle = EGA.black; bx.fillRect(n.x-5, n.y-10, 10, 1);
    if (done){ bx.fillStyle=EGA.white; bx.fillRect(n.x-2, n.y-7, 4, 4); }
    else if (locked){ bx.fillStyle=EGA.black; bx.fillRect(n.x-2, n.y-8, 4, 5); }
    else if (Math.sin(t*6)>0){ bx.fillStyle=EGA.yellow; bx.fillRect(n.x-2, n.y-8, 4, 4); }
    txt(String(i+1), n.x, n.y+7, 6, locked?EGA.dgray:EGA.white, 'center');
  }
  // hero token
  const h=m.hero;
  const bob = h.moving ? Math.abs(Math.sin(t*18))*-3 : Math.abs(Math.sin(t*3))*-2;
  bx.drawImage(SPR['hero_stand_'+(h.dir>0?'R':'L')], Math.floor(h.x)-8, Math.floor(h.y)-18+bob);
  // top banner
  bx.fillStyle='rgba(0,0,0,0.55)'; bx.fillRect(0,0,W,26);
  txt('ORION SYSTEM MAP', W/2, 4, 8, EGA.yellow, 'center', EGA.brown);
  txt(m.nodes[m.cur].name.toUpperCase(), W/2, 16, 7, m.done[m.cur]?EGA.bgreen:EGA.white, 'center');
  // prompts
  if (!h.moving){
    if (Math.floor(t*2)%2===0) txt('SPACE / ENTER = PLAY', W/2, H-44, 7, EGA.bcyan, 'center', EGA.black);
    txt('A / D  TRAVEL', W/2, H-32, 6, EGA.lgray, 'center', EGA.black);
  }
  // mini hud
  txt('SCORE '+String(Game.score).padStart(6,'0'), 4, H-11, 7, EGA.yellow, 'left', EGA.black);
  bx.drawImage(SPR.life, W-58, H-13, 11, 11);
  txt('x'+Game.lives, W-44, H-11, 7, EGA.white, 'left', EGA.black);
}

function drawLevelCard() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(0,0,0,0.7)'; bx.fillRect(0, 0, W, H);
  txt('LEVEL ' + (Game.levelIndex+1), W/2, 70, 10, EGA.yellow, 'center', EGA.brown);
  txt(Game.levelName.toUpperCase(), W/2, 92, 9, EGA.white, 'center', EGA.black);
  txt(Game.levels[Game.levelIndex].hint, W/2, 116, 6, EGA.bgreen, 'center');
}

function drawPause() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(0,0,0,0.72)'; bx.fillRect(0, 0, W, H);
  txt('PAUSED', W/2, 70, 16, EGA.yellow, 'center', EGA.brown);
  txt('ENTER / P  RESUME', W/2, 100, 7, EGA.white, 'center');
  txt('M  MUSIC: ' + (musicOn?'ON':'OFF'), W/2, 116, 7, EGA.lgray, 'center');
  txt('N  SOUND: ' + (muted?'OFF':'ON'), W/2, 130, 7, EGA.lgray, 'center');
  txt('ESC  QUIT TO TITLE', W/2, 146, 7, EGA.lgray, 'center');
}

function drawDead() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(85,0,0,0.55)'; bx.fillRect(0, 0, W, H);
  txt('OUCH!', W/2, 84, 16, EGA.bred, 'center', EGA.black);
  txt('LIVES LEFT: ' + Game.lives, W/2, 116, 8, EGA.white, 'center');
}

function drawLevelClear() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(0,0,0,0.72)'; bx.fillRect(0, 0, W, H);
  txt('LEVEL CLEAR!', W/2, 60, 14, EGA.bgreen, 'center', EGA.green);
  txt('GEMS ' + Game.gems + '/' + Game.gemsTotal, W/2, 92, 8, EGA.bcyan, 'center');
  if (Game.perfect) txt('PERFECT! +1000', W/2, 108, 8, EGA.yellow, 'center');
  txt('SCORE ' + String(Game.score).padStart(6,'0'), W/2, 128, 8, EGA.white, 'center');
}

function drawGameOver() {
  bx.fillStyle = EGA.black; bx.fillRect(0,0,W,H);
  drawBackdrop();
  bx.fillStyle = 'rgba(0,0,0,0.7)'; bx.fillRect(0, 0, W, H);
  txt('GAME OVER', W/2, 64, 18, EGA.bred, 'center', EGA.black);
  txt('SCORE ' + String(Game.score).padStart(6,'0'), W/2, 100, 9, EGA.white, 'center');
  txt('HIGH  ' + String(Game.highScore).padStart(6,'0'), W/2, 118, 8, EGA.bcyan, 'center');
  const blink = Math.floor(Game.timer*2) % 2 === 0;
  if (blink) txt('PRESS ENTER', W/2, 150, 8, EGA.yellow, 'center');
}

function drawVictory() {
  drawBackdrop();
  bx.fillStyle = 'rgba(0,0,0,0.55)'; bx.fillRect(0, 0, W, H);
  const t = Game.timer;
  txt('YOU WIN!', W/2, 40, 20, EGA.yellow, 'center', EGA.brown);
  txt('THE SYSTEM IS SAFE', W/2, 70, 8, EGA.bgreen, 'center');
  // victory dancing hero
  const by = 92 + Math.abs(Math.sin(t*5))*-10;
  bx.drawImage(SPR[Math.floor(t*4)%2? 'hero_run1_R':'hero_run2_R'], W/2-8, by);
  txt('FINAL SCORE', W/2, 124, 8, EGA.white, 'center');
  txt(String(Game.score).padStart(6,'0'), W/2, 138, 12, EGA.yellow, 'center', EGA.brown);
  txt('HIGH ' + String(Game.highScore).padStart(6,'0'), W/2, 160, 7, EGA.bcyan, 'center');
  const blink = Math.floor(t*2) % 2 === 0;
  if (blink) txt('PRESS ENTER', W/2, 182, 7, EGA.white, 'center');
  // confetti
  if (Math.random() < 0.4) Game.particles.push({ x:Math.random()*W, y:-2, vx:(Math.random()*2-1)*20, vy:40+Math.random()*40, life:3, color:[EGA.yellow,EGA.bred,EGA.bcyan,EGA.bgreen][Math.random()*4|0], size:2, grav:30 });
  updateParticles(1/60);
  for (const pt of Game.particles) { bx.globalAlpha = clamp(pt.life,0,1); bx.fillStyle = pt.color; bx.fillRect(Math.floor(pt.x), Math.floor(pt.y), pt.size, pt.size); }
  bx.globalAlpha = 1;
}

/* --------------------------- STATE STEP ---------------------------- */
function update(dt) {
  switch (Game.state) {
    case 'title':
      Game.timer += dt;
      if (pressed.start) { ensureAudio(); startGame(); SFX.select(); }
      break;
    case 'worldmap':
      updateWorldMap(dt);
      break;
    case 'levelcard':
      Game.timer -= dt;
      if (Game.timer <= 0 || pressed.start) Game.state = 'play';
      break;
    case 'play':
      if (pressed.pause) { Game.state = 'pause'; SFX.select(); setAudioActive(false); break; }
      updatePlay(dt);
      break;
    case 'pause':
      if (pressed.pause || pressed.start) { Game.state = 'play'; setAudioActive(true); SFX.select(); }
      // ESC quits to title (handled by the keydown listener below)
      break;
    case 'dead':
      Game.timer -= dt;
      updateParticles(dt);
      if (Game.shake > 0) Game.shake = Math.max(0, Game.shake - dt*60);
      if (Game.flash > 0) Game.flash = Math.max(0, Game.flash - dt*2);
      if (Game.timer <= 0) {
        if (Game.lives <= 0) { Game.state = 'gameover'; Game.timer = 0; saveHigh(); }
        else respawn();
      }
      break;
    case 'levelclear':
      Game.timer -= dt;
      updateParticles(dt);
      if (Game.timer <= 0 || pressed.start) {
        const m = Game.map;
        m.done[Game.levelIndex] = true;
        if (m.done.every(Boolean)) { Game.state = 'victory'; Game.timer = 0; saveHigh(); }
        else {
          const next = Math.min(Game.levels.length - 1, Game.levelIndex + 1);
          m.maxUnlocked = Math.max(m.maxUnlocked, next);
          placeHeroOnNode(next);
          Game.state = 'worldmap';
        }
      }
      break;
    case 'gameover':
      Game.timer += dt;
      if (pressed.start) { Game.state = 'title'; Game.timer = 0; }
      break;
    case 'victory':
      Game.timer += dt;
      if (pressed.start) { Game.state = 'title'; Game.timer = 0; Game.particles = []; }
      break;
  }
  // global audio controls (apply in every state, once per press)
  if (pressed.music) { musicOn = !musicOn; Music.setEnabled(musicOn); }
  if (pressed.mute)  { muted = !muted; applyMute(); }
  clearPressed();
}

function render() {
  bx.save();
  // screen shake
  if (Game.shake > 0 && (Game.state==='play'||Game.state==='dead')) {
    bx.translate((Math.random()*2-1)*Game.shake, (Math.random()*2-1)*Game.shake);
  }
  switch (Game.state) {
    case 'title': drawTitle(); break;
    case 'worldmap': drawWorldMap(); break;
    case 'levelcard': drawLevelCard(); break;
    case 'play': drawBackdrop(); drawWorld(); drawHUD(); drawVignette(); break;
    case 'pause': drawPause(); break;
    case 'dead': drawBackdrop(); drawWorld(); drawHUD(); drawDead(); break;
    case 'levelclear': drawLevelClear(); break;
    case 'gameover': drawGameOver(); break;
    case 'victory': drawVictory(); break;
  }
  bx.restore();

  // blit to screen (letterboxed, INTEGER-scaled in device pixels => crisp)
  ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, view.x, view.y, view.w, view.h);
}

/* ESC-to-title handling in pause needs a dedicated check (escape maps to pause) */
window.addEventListener('keydown', e => {
  if (Game.state === 'pause' && e.code === 'Escape') {
    Game.state = 'title'; Game.timer = 0; saveHigh(); setAudioActive(true);
  }
});

/* Stop all audio when the tab/window is hidden; resume when it returns. */
document.addEventListener('visibilitychange', () => {
  setAudioActive(document.visibilityState === 'visible' && Game.state !== 'pause');
});

/* --------------------------- MAIN LOOP ----------------------------- */
let last = 0, acc = 0;
const STEP = 1/60;
function frame(ts) {
  if (!last) last = ts;
  let dt = (ts - last) / 1000; last = ts;
  if (dt > 0.1) dt = 0.1;             // avoid spiral after tab switch
  acc += dt;
  let guard = 0;
  while (acc >= STEP && guard < 5) { update(STEP); acc -= STEP; guard++; }
  if (guard >= 5) acc = 0;
  render();
  requestAnimationFrame(frame);
}

/* --------------------------- BOOT ---------------------------------- */
function boot() {
  resize();
  bakeAll();
  loadHigh();
  Game.levels = buildLevels();
  bindTouch();
  Game.state = 'title'; Game.timer = 0;
  // hide loading
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  requestAnimationFrame(frame);
}
// wait for optional webfont, but never block
if (document.fonts && document.fonts.ready) {
  Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]).then(boot);
} else {
  window.addEventListener('load', boot);
}
