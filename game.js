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
// Each key maps to one or more actions. ArrowUp/W are both 'jump' (levels) and 'up' (overworld).
const KEYMAP = {
  ArrowLeft:['left'], KeyA:['left'],
  ArrowRight:['right'], KeyD:['right'],
  ArrowUp:['jump','up'], KeyW:['jump','up'], Space:['jump'],
  ArrowDown:['down'], KeyS:['down'],
  KeyZ:['shoot'], ControlLeft:['shoot'], ControlRight:['shoot'], KeyJ:['shoot'],
  KeyX:['pogo'], ShiftLeft:['pogo'], ShiftRight:['pogo'], KeyK:['pogo'],
  KeyP:['pause'], Escape:['pause'],
  Enter:['start'], NumpadEnter:['start'],
  KeyM:['music'], KeyN:['mute'], KeyF:['fullscreen'], KeyO:['options'], KeyQ:['quit'],
};
const held = {};
const pressed = {};
/* Fullscreen — must be invoked from inside a user gesture. requestFullscreen is a no-op on
   iPhone Safari (unsupported); there the PWA "Add to Home Screen" launches truly chrome-less. */
let triedFS = false;
function requestFS() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen;
  if (!fn || document.fullscreenElement || document.webkitFullscreenElement) return;
  try { const p = fn.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
function toggleFS() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) try { fn.call(document); } catch (e) {}
  } else requestFS();
}
function goFullscreenOnce() { if (triedFS) return; triedFS = true; requestFS(); }
function onKey(e, down) {
  const acts = KEYMAP[e.code];
  if (!acts) return;
  e.preventDefault();
  for (const a of acts) {
    if (down) { if (!held[a]) pressed[a] = true; held[a] = true; }
    else held[a] = false;
  }
  if (down && acts.includes('fullscreen')) toggleFS();      // F = manual toggle
  if (down && acts.includes('start')) goFullscreenOnce();   // pressing Start goes fullscreen
  ensureAudio();
}
window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));
window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
document.addEventListener('fullscreenchange', resize);
document.addEventListener('webkitfullscreenchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
function clearPressed() { for (const k in pressed) pressed[k] = false; }

/* On-screen touch controls (mobile).
   A single container-level tracker hit-tests every active touch against the buttons each event,
   so multi-touch (move + jump) AND sliding a thumb between buttons both work. */
let touchEl = null, isTouch = false;
function bindTouch() {
  touchEl = document.getElementById('touch');
  if (!touchEl) return;
  const buttons = [['btn-left','left'],['btn-right','right'],['btn-up','up'],['btn-down','down'],
                   ['btn-jump','jump'],['btn-shoot','shoot'],['btn-pogo','pogo']]
    .map(([id, act]) => ({ el: document.getElementById(id), act })).filter(b => b.el);
  const hit = (x, y) => {
    for (const b of buttons) {
      const r = b.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b;
    }
    return null;
  };
  const refresh = touches => {
    const now = {};
    for (let i = 0; i < touches.length; i++) {
      const b = hit(touches[i].clientX, touches[i].clientY);
      if (b) now[b.act] = true;
    }
    for (const b of buttons) {
      const on = !!now[b.act];
      if (on && !held[b.act]) pressed[b.act] = true;
      held[b.act] = on;
      b.el.classList.toggle('on', on);
    }
    // On menus / overworld the JUMP button = confirm/enter and POGO = back, so touch can
    // operate Settings, enter forts, and exit pause (none of which the D-pad can do otherwise).
    const st = Game.state;
    if (st === 'title' || st === 'settings' || st === 'worldmap' || st === 'pause') {
      if (pressed.jump) pressed.start = true;
      if (pressed.pogo && (st === 'settings' || st === 'pause')) pressed.pause = true;
    }
    ensureAudio();
  };
  const handler = e => { e.preventDefault(); refresh(e.touches); };
  for (const ev of ['touchstart','touchmove','touchend','touchcancel'])
    touchEl.addEventListener(ev, handler, { passive: false });
  isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  // Tap to confirm ONLY on menu screens that have no on-screen button (so phone players can
  // start & advance them). In play/worldmap/pause the pad's own buttons handle input — a stray
  // tap there must NOT fire Start (which would re-enter a fort / unpause). Audio unlock stays
  // outside the guard so the first tap in any state enables sound.
  const MENU = { title:1, levelcard:1, gameover:1, victory:1, intro:1, credits:1 };
  const tapStart = () => { ensureAudio(); if (MENU[Game.state]) { pressed.start = true; goFullscreenOnce(); } };
  canvas.addEventListener('touchstart', tapStart, { passive: true });
  canvas.addEventListener('mousedown', tapStart);
}
// Show the on-screen pad where input is needed: gameplay, map, pause, and the navigable menus.
const PAD_STATES = { play:1, worldmap:1, pause:1, title:1, settings:1 };
function updateTouchVisibility() {
  if (!isTouch || !touchEl) return;
  const want = PAD_STATES[Game.state] ? 'flex' : 'none';
  if (touchEl._vis !== want) { touchEl.style.display = want; touchEl._vis = want; }
}

/* ---------------------------- AUDIO -------------------------------- */
let actx = null, master = null, musicGain = null, sfxGain = null;
let audioReady = false;
let soundOn = true, musicOn = true, muted = false;    // music autoplays once audio unlocks; N = master mute
let musicVol = 0.5, sfxVol = 0.9;                     // 0..1, adjustable in Options + persisted
const MASTER_VOL = 0.6;

function applyMute() { if (master) master.gain.value = muted ? 0 : MASTER_VOL; }
function applyVolumes() { if (musicGain) musicGain.gain.value = musicVol; if (sfxGain) sfxGain.gain.value = sfxVol; }
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem('cosmo_settings') || 'null');
    if (s) { if (typeof s.music === 'number') musicVol = clamp(s.music, 0, 1);
      if (typeof s.sfx === 'number') sfxVol = clamp(s.sfx, 0, 1);
      if (typeof s.musicOn === 'boolean') musicOn = s.musicOn; } } catch(e){}
}
function saveSettings() { try { localStorage.setItem('cosmo_settings', JSON.stringify({ music: musicVol, sfx: sfxVol, musicOn })); } catch(e){} }
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
    musicGain = actx.createGain(); musicGain.gain.value = musicVol; musicGain.connect(master);
    sfxGain = actx.createGain(); sfxGain.gain.value = sfxVol; sfxGain.connect(master);
    audioReady = true;
    if (actx.state === 'suspended') actx.resume();   // unlock within the user gesture (mobile)
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
// In-place compaction: keep elements where keep(e) is truthy, mutate + truncate the SAME array
// (no per-frame allocation). Returns the array.
function compact(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[w++] = arr[i];
  arr.length = w;
  return arr;
}

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

  // Turret (stationary cannon) — fr1 = muzzle glow when firing. Barrel faces right.
  for (const fr of [0, 1]) {
    const c = newSprite(16, 16); const g = c.getContext('2d');
    P(g,2,3,11,12,EGA.dgray); P(g,2,3,11,1,EGA.lgray); P(g,2,14,11,1,EGA.black);
    P(g,5,6,6,5,EGA.bred); P(g,6,7,3,3,fr?EGA.yellow:EGA.white);   // eye
    P(g,12,7,4,3,EGA.lgray); P(g,12,8,4,1,EGA.dgray);              // barrel
    if (fr) P(g,16-1,7,1,3,EGA.yellow);
    SPR['turret_'+fr+'_R'] = c; SPR['turret_'+fr+'_L'] = flip(c);
  }

  // Bouncer (invincible spiked ball — must be dodged) — fr toggles spike orientation
  for (const fr of [0, 1]) {
    const c = newSprite(16, 16); const g = c.getContext('2d');
    P(g,4,4,8,8,EGA.bmagenta); P(g,5,5,6,6,EGA.magenta); P(g,6,6,2,2,EGA.white);
    if (fr === 0) { P(g,7,0,2,4,EGA.white); P(g,7,12,2,4,EGA.white); P(g,0,7,4,2,EGA.white); P(g,12,7,4,2,EGA.white); }
    else { P(g,2,2,3,3,EGA.white); P(g,11,2,3,3,EGA.white); P(g,2,11,3,3,EGA.white); P(g,11,11,3,3,EGA.white); }
    SPR['bouncer_'+fr+'_R'] = c; SPR['bouncer_'+fr+'_L'] = flip(c);
  }

  // BOSS: the Overseer — a hovering mech-eye (28x22), fr toggles eye + thrusters
  for (const fr of [0, 1]) {
    const c = newSprite(28, 22); const g = c.getContext('2d');
    P(g,8,0,2,3,EGA.lgray); P(g,18,0,2,3,EGA.lgray);                 // antennae
    P(g,2,6,24,8,EGA.dgray);                                          // hull mid
    P(g,4,2,20,13,EGA.dgray); P(g,4,2,20,2,EGA.lgray); P(g,4,13,20,2,EGA.black);
    P(g,5,4,2,2,EGA.lgray); P(g,21,4,2,2,EGA.lgray);                 // rivets
    P(g,9,5,10,8,EGA.bred); P(g,11,7,5,5,fr?EGA.yellow:EGA.white);   // eye
    P(g,11,8,2,2,EGA.black);
    P(g,5,15,5,5,fr?EGA.bcyan:EGA.cyan); P(g,18,15,5,5,fr?EGA.cyan:EGA.bcyan); // thrusters
    SPR['boss_'+fr+'_R'] = c; SPR['boss_'+fr+'_L'] = flip(c);
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
  ice:     { sky:[EGA.blue, EGA.bblue, EGA.bcyan], grass:EGA.white, grassD:EGA.bcyan,
             dirt:EGA.bcyan, dirtD:EGA.blue, block:EGA.white, blockD:EGA.bcyan,
             accent:EGA.bcyan, spike:EGA.bblue, spikeD:EGA.blue, icy:true },
  lava:    { sky:[EGA.black, EGA.red, EGA.brown], grass:EGA.dgray, grassD:EGA.black,
             dirt:EGA.dgray, dirtD:EGA.black, block:EGA.dgray, blockD:EGA.black,
             accent:EGA.bred, spike:EGA.yellow, spikeD:EGA.red },
  forest:  { sky:[EGA.blue, EGA.green, EGA.bgreen], grass:EGA.bgreen, grassD:EGA.green,
             dirt:EGA.brown, dirtD:EGA.black, block:EGA.brown, blockD:EGA.black,
             accent:EGA.bgreen, spike:EGA.lgray, spikeD:EGA.dgray },
  factory: { sky:[EGA.black, EGA.blue, EGA.dgray], grass:EGA.lgray, grassD:EGA.dgray,
             dirt:EGA.dgray, dirtD:EGA.black, block:EGA.lgray, blockD:EGA.dgray,
             accent:EGA.bcyan, spike:EGA.yellow, spikeD:EGA.red },
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
  if (theme === 'surface' || theme === 'forest' || theme === 'ice') {
    // sky specks (stars / snow)
    for (let i = 0; i < 44; i++) { const x = rnd()*W, y = rnd()*70; gf.fillStyle=EGA.white; gf.globalAlpha=0.4+rnd()*0.5; gf.fillRect(x,y,1,1); }
    gf.globalAlpha = 1;
    gf.fillStyle = theme === 'forest' ? EGA.green : theme === 'ice' ? EGA.bcyan : EGA.blue;
    for (let x = -20; x < W+20; x += 46) { const h = 50+rnd()*40; gf.beginPath(); gf.moveTo(x,H); gf.lineTo(x+23,H-h); gf.lineTo(x+46,H); gf.fill(); }
  } else if (theme === 'cavern' || theme === 'factory') {
    for (let i = 0; i < 60; i++) { gf.fillStyle = t.accent; gf.globalAlpha = 0.15+rnd()*0.25; const x=rnd()*W,y=rnd()*H; gf.fillRect(x,y,1,1); }
    gf.globalAlpha = 1; gf.fillStyle = EGA.dgray;
    if (theme === 'factory') { for (let x = 4; x < W; x += 26) { const h = 30+rnd()*60; gf.fillRect(x, H-h, 10, h); gf.fillRect(x-2, H-h, 14, 4); } } // pipes/towers
    else for (let x = 0; x < W; x += 30) { const h = 24+rnd()*40; gf.beginPath(); gf.moveTo(x,0); gf.lineTo(x+15,h); gf.lineTo(x+30,0); gf.fill(); } // stalactites
  } else {
    // fortress / lava: dark glow blobs
    gf.fillStyle = theme === 'lava' ? EGA.red : EGA.dgray;
    for (let i=0;i<26;i++){ const x=rnd()*W,y=rnd()*H,w=8+rnd()*22; gf.fillRect(x,y,w,3); }
    gf.fillStyle = t.accent; gf.globalAlpha=0.2;
    for (let i=0;i<30;i++){ gf.fillRect(rnd()*W,rnd()*H,2,2);} gf.globalAlpha=1;
  }
  // mid layer: hills/structures
  const gm = mid.getContext('2d');
  gm.fillStyle = (theme === 'surface' || theme === 'forest') ? EGA.green : theme === 'ice' ? EGA.bcyan
               : (theme === 'cavern' || theme === 'factory') ? EGA.dgray : EGA.red;
  for (let x = -10; x < W+40; x += 64) { const h = 40+rnd()*50; gm.beginPath(); gm.moveTo(x,H); gm.lineTo(x+10,H-h); gm.lineTo(x+50,H-h*0.7); gm.lineTo(x+64,H); gm.fill(); }
  bgCache[theme] = { far, mid };
  return bgCache[theme];
}

/* --------------------------- LEVELS -------------------------------- */
/* Built with a small DSL to guarantee aligned, valid maps. Grid chars:
   ' ' air · '#' ground · 'B' block · 'T' one-way platform · '^' spikes · 'L' lava
   '<'/'>' conveyor · 'm'/'v' moving platform (horiz/vert) · 'C' checkpoint · 'D' exit door
   'o' gem · 'G' big gem · 'a' ammo · 'h' 1-up · 'P' start
   enemies: 'y' yorp · 'b' bloog · 'f' flyer · 'F' homing flyer · 'j' hopper · 'u' turret · 'X' bouncer · 'Z' boss */
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
    lava(c, r, len) { for (let i=0;i<len;i++) set(c+i,r,'L'); return this; },               // lethal floor (sits on ground)
    conv(c, r, len, dir) { const ch = dir>0?'>':'<'; for (let i=0;i<len;i++) set(c+i,r,ch); return this; }, // conveyor belt
    put(c, r, ch) { set(c,r,ch); return this; },
  };
}

// Deterministically fill a column range [c0..c1] of an already-grounded level with extra
// content (pits, platforms, hop-blocks, jump-over hazards, enemies, pickups) to lengthen it.
// Invariants kept: pits <= 3 tiles, >=3 ground after each pit, hazards sit on solid ground with
// run-up + landing room, nothing within 4 cols of the exit. Same seed => same layout every time.
function decorate(m, c0, c1, theme, seed) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 0x1000000; };
  const pool = ({
    surface:['y','b','f','j'], cavern:['f','F','b','y'], fortress:['b','f','j','b'],
    ice:['y','b','f','j'], forest:['j','b','F','j'], lava:['b','u','j','b'], factory:['b','u','X','F'],
  })[theme] || ['y','b','f'];
  const pick = () => pool[(rnd()*pool.length)|0];
  m.put(c0, 10, 'C');                        // mid-level checkpoint at the start of the tail
  const tailEnd = c1 - 18;                   // reserve the last stretch for a hand-authored finale
  let c = c0 + 2;
  while (c < tailEnd) {
    const prog = (c - c0) / Math.max(1, tailEnd - c0);   // difficulty ramps toward the finale
    const roll = rnd();
    if (roll < 0.22 + prog * 0.14) {         // pits get more common toward the end (still <= 3 wide)
      const w = rnd() < (0.35 + prog * 0.25) ? 3 : 2;
      for (let i = 0; i < w; i++) { m.set(c+i, 11, ' '); m.set(c+i, 12, ' '); }
      c += w + 3;
    } else if (roll < 0.48) {                // floating platform + gem (+ maybe an enemy below)
      const ph = rnd() < 0.5 ? 8 : 7;
      m.plat(c, ph, 3); m.put(c+1, ph-1, rnd() < 0.3 ? 'G' : 'o');
      if (rnd() < 0.55) m.put(c+1, 10, pick());
      c += 4 + ((rnd()*3)|0);
    } else if (roll < 0.6) {                 // jump-over hazard on flat ground
      if (theme === 'lava') m.lava(c, 10, 2); else m.spikes(c, 10, 2);
      c += 5;
    } else if (roll < 0.72) {                // 2-tall hop block + gem
      m.block(c, 9, 1, 2); m.put(c, 8, 'o');
      c += 3 + ((rnd()*2)|0);
    } else {                                 // enemy + pickup
      m.put(c, 10, pick());
      if (rnd() < 0.5) m.put(c+2, 10, rnd() < 0.3 ? 'a' : 'o');
      c += 4 + ((rnd()*3)|0);
    }
  }
  finale(m, theme, c1);                      // signature, theme-specific run-up to the exit
}

// A hand-authored ~16-col climax ending just before the door (placed at doorC by the caller).
// Ground already spans this range; pits stay <= 2 and hazards sit on solid ground.
function finale(m, theme, doorC) {
  const c = doorC - 17;
  if (theme === 'lava') {                    // rising-lava gauntlet
    m.lava(c+2, 10, 2); m.plat(c+5, 8, 3); m.put(c+6, 7, 'G');
    m.lava(c+9, 10, 2); m.put(c+12, 10, 'u'); m.put(c+14, 10, 'o');
  } else if (theme === 'factory') {          // conveyor + turret + bouncer run
    m.conv(c+1, 11, 5, 1); m.put(c+3, 10, 'u'); m.put(c+8, 10, 'X');
    m.plat(c+10, 8, 3); m.put(c+11, 7, 'G'); m.put(c+14, 10, 'a');
  } else if (theme === 'ice' || theme === 'cavern') {  // chasm leaps over the void
    for (let i = 0; i < 2; i++) { const pc = c + 3 + i*6;
      m.set(pc,11,' '); m.set(pc,12,' '); m.set(pc+1,11,' '); m.set(pc+1,12,' ');
      m.plat(pc-1, 7, 3); m.put(pc, 6, 'G'); }
    m.put(c+14, 10, theme === 'ice' ? 'b' : 'F');
  } else {                                   // surface / forest / fortress — platform ascent
    m.plat(c+2, 8, 3); m.put(c+3, 7, 'o'); m.plat(c+6, 6, 3); m.put(c+7, 5, 'G');
    m.put(c+10, 10, 'b'); m.spikes(c+13, 10, 2);
  }
}

function buildLevels() {
  const L = [];

  /* ---- Level 1: Verdant Outpost (surface, gentle) ---- */
  {
    const cols = 140;
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
    decorate(m, 84, cols-2, 'surface', 1);
    m.put(cols-2, 10, 'D');
    L.push(m);
  }

  /* ---- Level 2: Crystal Caves (cavern, vertical + flyers) ---- */
  {
    const cols = 150;
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
    decorate(m, 92, cols-2, 'cavern', 2);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 3: Iron Fortress (fortress, tougher) ---- */
  {
    const cols = 162;
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
    decorate(m, 100, cols-2, 'fortress', 3);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 4: Tangled Thicket (surface, hoppers + a homing flyer) ---- */
  {
    const cols = 156;
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
    decorate(m, 96, cols-2, 'surface', 4);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 5: Deep Hollows (cavern, vertical climb + flyer swarm) ---- */
  {
    const cols = 166;
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
    decorate(m, 104, cols-2, 'cavern', 5);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 6: The Core (fortress, the gauntlet) ---- */
  {
    const cols = 174;
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
    decorate(m, 112, cols-2, 'fortress', 6);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 7: Frostbite Caverns (ICE - slippery footing, vertical lifts) ---- */
  {
    const cols = 158;
    const m = makeLevel(cols, 'ice', 'Frostbite Caverns', 'Slippery ice! Brake early.');
    m.ground(0, 24, 11);
    m.put(2,10,'P'); m.put(4,10,'o'); m.put(5,10,'o'); m.put(6,10,'a');
    m.put(10,10,'y'); m.put(15,10,'b');
    m.block(12,9,1,2); m.put(12,8,'o');
    m.plat(17,8,3); m.put(18,7,'o'); m.spikes(21,10,2);
    m.ground(28, 50, 11);                 // 3-tile pit 25-27
    m.put(31,10,'F'); m.put(36,10,'b'); m.put(41,10,'j'); m.put(47,10,'y');
    m.plat(32,8,3); m.put(33,7,'o');
    m.put(38,8,'v'); m.put(38,4,'G');     // vertical lift to a bonus big-gem
    m.spikes(44,10,2);
    m.ground(54, 74, 11);                 // 3-tile pit 51-53
    m.put(56,10,'b'); m.put(61,10,'F'); m.put(66,10,'j'); m.put(71,10,'b');
    m.plat(57,8,3); m.put(58,7,'o'); m.plat(63,6,3); m.put(64,5,'G');
    m.put(68,10,'a'); m.put(69,10,'h'); m.spikes(72,10,2);
    m.ground(78, cols-1, 11);             // 3-tile pit 75-77
    m.put(80,10,'F'); m.put(85,10,'b'); m.put(90,10,'j');
    m.plat(82,8,3); m.put(83,7,'o');
    m.put(92,10,'o'); m.put(93,10,'o');
    decorate(m, 98, cols-2, 'ice', 7);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 8: Whispering Woods (FOREST - hoppers, flyers, lifts) ---- */
  {
    const cols = 164;
    const m = makeLevel(cols, 'forest', 'Whispering Woods', 'The brush is alive with hoppers.');
    m.ground(0, 28, 11);
    m.put(2,10,'P'); m.put(4,10,'o'); m.put(5,10,'o');
    m.put(9,10,'j'); m.put(14,10,'j'); m.put(20,10,'b');
    m.block(12,9,1,2); m.put(12,8,'o');
    m.plat(16,8,3); m.put(17,7,'o'); m.plat(22,7,3); m.put(23,6,'G');
    m.spikes(26,10,2);
    m.ground(32, 54, 11);                 // 3-tile pit 29-31
    m.put(34,10,'F'); m.put(39,10,'j'); m.put(44,10,'b'); m.put(50,10,'j');
    m.plat(35,8,3); m.put(36,7,'o');
    m.put(42,8,'v'); m.put(42,4,'G');
    m.put(47,10,'a'); m.spikes(52,10,2);
    m.ground(58, 80, 11);                 // 3-tile pit 55-57
    m.put(60,10,'b'); m.put(65,10,'F'); m.put(70,10,'j'); m.put(76,10,'F');
    m.plat(61,8,3); m.put(62,7,'o'); m.plat(72,7,3); m.put(73,6,'G');
    m.put(78,10,'h'); m.spikes(68,10,2);
    m.ground(84, cols-1, 11);             // 3-tile pit 81-83
    m.put(86,10,'j'); m.put(91,10,'b'); m.put(96,10,'F');
    m.plat(88,8,3); m.put(89,7,'o');
    m.put(98,10,'a'); m.put(99,10,'o');
    decorate(m, 104, cols-2, 'forest', 8);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 9: Magma Works (LAVA pools + conveyors + turrets) ---- */
  {
    const cols = 168;
    const m = makeLevel(cols, 'lava', 'Magma Works', 'Lava kills. Conveyors shove. Turrets fire.');
    m.ground(0, 26, 11);
    m.put(2,10,'P'); m.put(4,10,'a'); m.put(5,10,'a');
    m.put(9,10,'b'); m.put(14,10,'u');               // turret on ground
    m.lava(18, 10, 3);                                // lethal lava pool (jump over)
    m.put(23,10,'j');
    m.plat(11,8,3); m.put(12,7,'o'); m.block(20,9,1,2); m.put(20,8,'o');
    m.ground(30, 52, 11);                 // 3-tile pit 27-29
    m.conv(31, 11, 6, 1);                              // conveyor pushes right
    m.put(34,10,'b'); m.put(40,10,'u'); m.put(46,10,'b');
    m.lava(43, 10, 2); m.plat(36,7,3); m.put(37,6,'G');
    m.put(49,10,'a');
    m.ground(56, 80, 11);                 // 3-tile pit 53-55
    m.conv(70, 11, 6, -1);                             // conveyor pushes left (toward you)
    m.put(58,10,'u'); m.put(63,10,'b'); m.put(76,10,'j');
    m.lava(66, 10, 3); m.plat(59,7,3); m.put(60,6,'G');
    m.put(78,10,'h'); m.put(79,10,'a');
    m.ground(84, cols-1, 11);             // 3-tile pit 81-83
    m.put(86,10,'u'); m.put(92,10,'b'); m.lava(96, 10, 3); m.put(101,10,'j');
    m.plat(88,8,3); m.put(89,7,'o');
    m.put(103,10,'o'); m.put(104,10,'o');
    decorate(m, 108, cols-2, 'lava', 9);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 10: Treasure Trove (BONUS - short, gem-rich breather) ---- */
  {
    const cols = 60;
    const m = makeLevel(cols, 'surface', 'Treasure Trove', 'A reward stop. Grab it all!');
    m.ground(0, cols-1, 11);
    m.put(2,10,'P');
    for (let c=4;c<=20;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(6,8,3); m.put(6,7,'o'); m.put(7,7,'o'); m.put(8,7,'o');
    m.plat(12,6,3); m.put(12,5,'o'); m.put(13,5,'G'); m.put(14,5,'o');
    m.put(18,10,'h');
    m.put(24,10,'y'); m.put(30,10,'y');                // only gentle grazers
    m.plat(22,8,4); m.put(23,7,'o'); m.put(24,7,'o'); m.put(25,7,'G');
    m.block(28,9,1,2); m.put(28,8,'o');
    for (let c=32;c<=44;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(34,7,4); m.put(35,6,'o'); m.put(36,6,'G'); m.put(37,6,'o');
    m.put(40,10,'h'); m.put(46,10,'a');
    m.plat(48,8,4); m.put(49,7,'o'); m.put(50,7,'o'); m.put(51,7,'G');
    m.put(54,10,'o'); m.put(55,10,'o');
    m.put(cols-2,10,'D');
    m.secret = true;                 // hidden bonus — found by exploring the overworld
    L.push(m);
  }

  /* ---- Level 11: The Foundry (FACTORY finale - everything) ---- */
  {
    const cols = 178;
    const m = makeLevel(cols, 'factory', 'The Foundry', 'Conveyors, turrets, bouncers. Reach the lair.');
    m.ground(0, 24, 11);
    m.put(2,10,'P'); m.put(4,10,'a'); m.put(5,10,'a');
    m.put(8,10,'u'); m.conv(11, 11, 5, 1); m.put(16,10,'b'); m.put(20,10,'X');   // bouncer arena
    m.plat(13,8,3); m.put(14,7,'o');
    m.ground(28, 50, 11);                 // 3-tile pit 25-27
    m.put(30,10,'u'); m.put(35,10,'b'); m.put(40,10,'F'); m.put(45,10,'X');
    m.conv(36, 11, 6, -1); m.plat(31,7,3); m.put(32,6,'G');
    m.put(47,8,'v'); m.put(47,4,'G'); m.put(49,10,'a');
    m.ground(54, 78, 11);                 // 3-tile pit 51-53
    m.put(56,10,'b'); m.put(61,10,'u'); m.put(66,10,'X'); m.put(72,10,'b');
    m.lava(69, 10, 2); m.conv(57, 11, 5, 1);
    m.plat(58,7,3); m.put(59,6,'G'); m.plat(74,7,3); m.put(75,6,'o');
    m.put(77,10,'h');
    m.ground(82, 104, 11);                // 3-tile pit 79-81
    m.put(84,10,'u'); m.put(89,10,'X'); m.put(94,10,'b'); m.put(99,10,'F');
    m.conv(90, 11, 6, 1); m.lava(96, 10, 2);
    m.plat(85,8,3); m.put(86,7,'o'); m.plat(100,7,3); m.put(101,6,'G');
    m.put(103,10,'a');
    m.ground(108, cols-1, 11);            // 3-tile pit 105-107
    m.put(110,10,'X'); m.put(112,10,'o'); m.put(113,10,'o');
    decorate(m, 116, cols-2, 'factory', 11);
    m.put(cols-2,10,'D');
    L.push(m);
  }

  /* ---- Level 12: Overlord's Lair (BOSS arena - defeat the Overseer to win) ---- */
  {
    const cols = 30;
    const m = makeLevel(cols, 'fortress', "Overlord's Lair", 'Defeat the Overseer!');
    m.ground(0, cols-1, 11);
    for (let r = 0; r < 11; r++) { m.put(0,r,'B'); m.put(1,r,'B'); m.put(cols-2,r,'B'); m.put(cols-1,r,'B'); }  // containment walls
    m.put(4,10,'P');
    m.plat(5,7,3); m.plat(cols-9,7,3); m.plat(12,5,5);     // cover platforms
    m.put(7,10,'a'); m.put(22,10,'a'); m.put(14,4,'a'); m.put(19,10,'a'); m.put(16,10,'a'); m.put(25,10,'a');  // ammo refills (shoot the boss!)
    m.put(6,6,'o'); m.put(23,6,'o'); m.put(10,10,'h');
    m.put(13,3,'Z');                                        // the boss (no exit door — beat it to win)
    L.push(m);
  }

  /* ---- Level 13: Hidden Grotto (SECRET bonus - crystal vault of gems) ---- */
  {
    const cols = 64;
    const m = makeLevel(cols, 'cavern', 'Hidden Grotto', 'You found a secret! Loot the vault.');
    m.ground(0, cols-1, 11);
    m.put(2,10,'P');
    for (let c=4;c<=22;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(6,8,3); m.put(6,7,'o'); m.put(7,7,'G'); m.put(8,7,'o');
    m.plat(12,6,3); m.put(12,5,'o'); m.put(13,5,'o'); m.put(14,5,'G');
    m.put(16,10,'h'); m.block(19,9,1,2); m.put(19,8,'G');
    m.put(26,10,'f');                                       // one harmless-ish flyer
    m.plat(24,7,4); m.put(24,6,'o'); m.put(25,6,'G'); m.put(26,6,'o'); m.put(27,6,'G');
    for (let c=30;c<=46;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(32,8,3); m.put(33,7,'G'); m.plat(38,6,4); m.put(39,5,'G'); m.put(40,5,'o'); m.put(41,5,'G');
    m.put(44,10,'h'); m.put(48,10,'a');
    m.plat(50,7,5); m.put(51,6,'G'); m.put(52,6,'o'); m.put(53,6,'G'); m.put(54,6,'o');
    m.put(58,10,'o'); m.put(59,10,'o'); m.put(60,10,'G');
    m.put(cols-2,10,'D');
    m.secret = true;
    L.push(m);
  }

  /* ---- Level 14: Sky Vault (SECRET bonus - a forest canopy gem-climb) ---- */
  {
    const cols = 62;
    const m = makeLevel(cols, 'forest', 'Sky Vault', 'A secret in the canopy!');
    m.ground(0, cols-1, 11);
    m.put(2,10,'P');
    for (let c=4;c<=18;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(6,9,3); m.put(7,8,'o'); m.plat(10,7,3); m.put(11,6,'G'); m.plat(14,5,3); m.put(15,4,'G');
    m.put(20,10,'h'); m.put(24,10,'j');
    m.plat(22,8,3); m.put(23,7,'G'); m.plat(27,6,4); m.put(28,5,'o'); m.put(29,5,'G'); m.put(30,5,'o');
    for (let c=33;c<=46;c++) if (c%2===0) m.put(c,10,'o');
    m.plat(35,8,3); m.put(36,7,'G'); m.plat(40,6,3); m.put(41,5,'G'); m.plat(44,5,3); m.put(45,4,'G');
    m.put(48,10,'h'); m.put(50,10,'a');
    m.plat(52,8,4); m.put(53,7,'G'); m.put(54,7,'o'); m.put(55,7,'G');
    m.put(58,10,'o'); m.put(59,10,'G');
    m.put(cols-2,10,'D');
    m.secret = true;
    L.push(m);
  }

  /* ---- Level 15: Buried Cache (SECRET bonus - a fortress treasure dig) ---- */
  {
    const cols = 60;
    const m = makeLevel(cols, 'fortress', 'Buried Cache', 'A hidden stash - mind the spikes.');
    m.ground(0, cols-1, 11);
    m.put(2,10,'P');
    for (let c=4;c<=16;c++) if (c%2===0) m.put(c,10,'o');
    m.block(8,9,1,2); m.put(8,8,'G'); m.plat(12,7,4); m.put(13,6,'G'); m.put(14,6,'o'); m.put(15,6,'G');
    m.spikes(18,10,2); m.put(22,10,'b');
    m.plat(20,8,3); m.put(21,7,'G');
    for (let c=25;c<=40;c++) if (c%2===0) m.put(c,10,'o');
    m.block(27,9,1,2); m.put(27,8,'G'); m.plat(31,7,4); m.put(32,6,'G'); m.put(33,6,'o'); m.put(34,6,'G');
    m.spikes(37,10,2); m.put(42,10,'h'); m.put(44,10,'a');
    m.plat(46,8,4); m.put(47,7,'G'); m.put(48,7,'o'); m.put(49,7,'G');
    m.put(53,10,'o'); m.put(54,10,'o'); m.put(55,10,'G');
    m.put(cols-2,10,'D');
    m.secret = true;
    L.push(m);
  }

  return L;
}

// Build-time invariant checks — logs (does not throw) so bad authoring is caught during dev.
function validateLevels() {
  const solid = ch => ch === '#' || ch === 'B' || ch === '<' || ch === '>';
  Game.levels.forEach((lvl, li) => {
    const g = lvl.g, cols = lvl.cols, at = (c, r) => (r < 0 || r >= ROWS || c < 0 || c >= cols) ? ' ' : g[r][c];
    const warn = msg => console.warn('[level ' + li + ' "' + lvl.name + '"] ' + msg);
    let starts = 0, doors = 0, boss = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
      const ch = g[r][c];
      if (ch === 'P') starts++;
      if (ch === 'Z') boss++;
      if (ch === 'D') { doors++;
        if (at(c, r-1) !== ' ') warn('cell above exit door not empty at ' + c + ',' + (r-1));
        if (!solid(at(c, r+1))) warn('no ground beneath exit door at col ' + c); }
      if ((ch === '^' || ch === 'L') && !solid(at(c, r+1)) && at(c, r+1) !== '^' && at(c, r+1) !== 'L')
        warn('floating hazard "' + ch + '" at ' + c + ',' + r);
    }
    if (starts !== 1) warn('expected exactly 1 player start, found ' + starts);
    if (doors === 0 && boss === 0) warn('no exit (neither a D door nor a Z boss)');
  });
}

/* --------------------------- ENTITIES ------------------------------ */
function makeEnemy(type, c, r) {
  const base = { type, dead:false, dyTimer:0, anim:0, dir: -1, sc:c, sr:r };
  if (type === 'yorp') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:12, vx:0, vy:0, speed:26, hp:1, fly:false });
  if (type === 'bloog') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:12, vx:0, vy:0, speed:50, hp:1, fly:false, charge:true });
  if (type === 'flyer') return Object.assign(base, { x:c*16, y:r*16, w:14, h:10, vx:0, vy:0, speed:42, hp:1, fly:true, homing:false, homeY:r*16 - 16, wasBlocked:false, t:Math.random()*6 });
  if (type === 'hopper') return Object.assign(base, { x:c*16+1, y:r*16+2, w:14, h:13, vx:0, vy:0, speed:0, hp:1, fly:false, hop:true, onGround:false, hopTimer:0.4 + Math.random()*0.8 });
  if (type === 'turret') return Object.assign(base, { x:c*16, y:r*16, w:14, h:15, vx:0, vy:0, speed:0, hp:2, fly:false, turret:true, fireTimer:0.5 + Math.random()*1.2 });
  if (type === 'bouncer') return Object.assign(base, { x:c*16+2, y:r*16+2, w:12, h:12, vx:0, vy:0, speed:58, hp:999, fly:false, bounce:true, invincible:true, bounceVel:300, onGround:false });
  if (type === 'boss') return Object.assign(base, { x:c*16, y:r*16, w:28, h:22, vx:0, vy:0, speed:44, hp:12, maxHp:12, fly:true, boss:true, homeY:r*16, t:Math.random()*6, attackTimer:1.4, flash:0 });
  return base;
}
// Map a level-grid char to an enemy (y yorp, b bloog, f flyer, F homing flyer, j hopper, u turret, X bouncer, Z boss)
const isEnemyChar = ch => ch==='y'||ch==='b'||ch==='f'||ch==='F'||ch==='j'||ch==='u'||ch==='X'||ch==='Z';
function enemyFromChar(ch, c, r) {
  const type = ch==='y'?'yorp':ch==='b'?'bloog':ch==='j'?'hopper':ch==='u'?'turret':ch==='X'?'bouncer':ch==='Z'?'boss':'flyer';
  const en = makeEnemy(type, c, r);
  if (ch === 'F') en.homing = true;
  return en;
}
// Build moving platforms from a level's grid. Deterministic phase => identical position every
// load AND every respawn, so a lift/mover is never in a different place on retry.
function buildPlatforms(lvl) {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < lvl.cols; c++) {
    const ch = lvl.g[r][c];
    if (ch === 'm' || ch === 'v') out.push({
      x: c*16, y: r*16+4, w: 32, h: 8, axis: ch==='m' ? 'h' : 'v',
      x0: c*16, y0: r*16+4, range: ch==='m' ? 44 : 40, speed: 1.1,
      t: ((c*7 + r*13) % 12) * 0.5, dx: 0, dy: 0,
    });
  }
  return out;
}

/* --------------------------- GAME STATE ---------------------------- */
const Game = {
  state: 'title',      // title, levelcard, play, pause, dead, levelclear, gameover, victory
  levels: [],
  levelIndex: 0,
  grid: null, cols: 0, theme: 'surface', levelName: '',
  player: null,
  enemies: [], pickups: [], shots: [], eshots: [], platforms: [], particles: [],
  cam: { x: 0, y: 0 },
  lives: START_LIVES, hearts: MAX_HEARTS, ammo: START_AMMO,
  score: 0, gems: 0, gemsTotal: 0, levelScore: 0,
  timer: 0, flash: 0, shake: 0,
  menuSel: 0,
  highScore: 0, save: null,
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
/* ---- Run/level progress persistence (one flat blob) ---- */
function saveVer() { return Game.levels.length + ':' + Game.levels.filter(l => l.secret).length; }
function loadProgress() { try { Game.save = JSON.parse(localStorage.getItem('cosmo_save') || 'null'); } catch(e){ Game.save = null; } }
function saveProgress() {
  const m = Game.map; if (!m) return;
  const blob = { ver: saveVer(), maxUnlocked:m.maxUnlocked, done:m.done.slice(), grades:(m.grades||[]).slice(),
    score:Game.score, lives:Game.lives, secretsFound:m.secretsFound,
    takenKeys: m.pickups.filter(p => p.taken).map(p => p.c + ',' + p.r) };   // identity (cell), not array index
  try { localStorage.setItem('cosmo_save', JSON.stringify(blob)); Game.save = blob; } catch(e){}
}
function clearProgress() { try { localStorage.removeItem('cosmo_save'); } catch(e){} Game.save = null; }
function saveUsable() { return !!(Game.save && Game.save.ver === saveVer()); }   // ignore saves from a different level set
function hasSave() { const s = Game.save; return !!(saveUsable() && (s.maxUnlocked > 0 || (s.done && s.done.some(Boolean)) || s.secretsFound > 0 || (s.takenKeys && s.takenKeys.length))); }
function titleOptions() { return hasSave() ? ['continue', 'new', 'options'] : ['start', 'options']; }
function continueGame() {
  Game.lives = START_LIVES; Game.hearts = MAX_HEARTS; Game.ammo = START_AMMO; Game.score = 0;
  buildWorldMap();
  const s = Game.save, m = Game.map;
  if (s && saveUsable()) {
    m.maxUnlocked = s.maxUnlocked | 0;
    if (s.done) for (let i = 0; i < m.done.length && i < s.done.length; i++) m.done[i] = s.done[i];
    if (s.grades) for (let i = 0; i < m.grades.length && i < s.grades.length; i++) m.grades[i] = s.grades[i];
    if (s.takenKeys) { const tk = new Set(s.takenKeys); for (const p of m.pickups) if (tk.has(p.c + ',' + p.r)) p.taken = true; }
    m.secretsFound = m.pickups.reduce((n, p) => n + (p.taken ? 1 : 0), 0);
    Game.score = s.score | 0; Game.lives = (s.lives | 0) || START_LIVES;
    const mains = m.forts.filter(f => !f.secret).length;
    const target = m.forts.find(f => !f.secret && f.order === Math.min(m.maxUnlocked, mains - 1));
    if (target) placeHeroOnNode(target.li);
  }
  Game.state = 'worldmap';
}

function newPlayer(start) {
  return {
    x: start.x + 3, y: start.y, w: 10, h: 14,
    vx: 0, vy: 0, dir: 1,
    onGround: false, coyote: 0, jumpBuf: 0, jumping: false,
    pogo: false, anim: 0, shootCool: 0, shootHold: 0,
    invuln: 0, hazImmune: 0, state: 'stand',
  };
}

function loadLevel(idx) {
  const lvl = Game.levels[idx];
  Game.cols = lvl.cols; Game.theme = lvl.theme; Game.levelName = lvl.name;
  Game.grid = lvl.g.map(row => row.slice());
  Game.enemies = []; Game.pickups = []; Game.shots = []; Game.particles = [];
  Game.eshots = []; Game.platforms = [];
  Game.gems = 0; Game.gemsTotal = 0; Game.levelScore = 0;
  Game.defeated = new Set();   // enemy spawns already cleared this level (persist across respawns)
  Game.cpTriggered = new Set();// checkpoint cells reached this level ('C' tiles)
  let start = { x: 32, y: 160 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < lvl.cols; c++) {
      const ch = Game.grid[r][c];
      if (ch === 'P') { start = { x: c*16, y: r*16 }; Game.grid[r][c] = ' '; }
      else if (ch === 'm' || ch === 'v') { Game.grid[r][c] = ' '; }  // platforms built from lvl.g below
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
  Game.platforms = buildPlatforms(lvl);
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
/* ---- Overworld: a walkable top-down island. Grass/path = walkable;
       water/tree/rock = blocked. Walk onto a fort + press JUMP/ENTER to play it. ---- */
const MAP_WALK = ch => ch === '.' || ch === 'p' || ch === 'F' || ch === 'S';  // S = secret fort
function buildWorldMap() {
  const MW = 48, MH = 26;                         // big 2D island — scrolls in both axes
  let s = 1337;                                   // deterministic seed -> same island each run
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const grid = [];
  for (let r = 0; r < MH; r++) { const row = []; for (let c = 0; c < MW; c++) row.push('.'); grid.push(row); }
  for (let c = 0; c < MW; c++) { grid[0][c]=grid[1][c]='~'; grid[MH-1][c]=grid[MH-2][c]='~'; }   // ocean frame
  for (let r = 0; r < MH; r++) { grid[r][0]=grid[r][1]='~'; grid[r][MW-1]=grid[r][MW-2]='~'; }
  const lake = (cx, cy, rad) => { for (let r=cy-rad;r<=cy+rad;r++) for (let c=cx-rad;c<=cx+rad;c++)
    if ((c-cx)*(c-cx)+(r-cy)*(r-cy) <= rad*rad && r>1 && r<MH-2 && c>1 && c<MW-2) grid[r][c]='~'; };
  lake(11,7,3); lake(37,18,3); lake(24,5,2); lake(15,20,2); lake(40,9,2);   // inland lakes
  // forts: main (progression) on a serpentine path; secret in hidden coves
  const main = [], secret = [];
  Game.levels.forEach((lvl, i) => (lvl.secret ? secret : main).push(i));
  const forts = new Array(Game.levels.length);
  const margin = 4;
  const used = new Set();
  const claim = (c, r) => {                         // nudge to the nearest free cell so forts never overlap
    c = clamp(c, 3, MW-4); r = clamp(r, 3, MH-4);
    for (let d = 0; d < 12; d++) for (const [dc, dr] of [[0,0],[0,d],[0,-d],[d,0],[-d,0]]) {
      const cc = clamp(c+dc, 3, MW-4), rr = clamp(r+dr, 3, MH-4), key = cc+','+rr;
      if (!used.has(key)) { used.add(key); return { c:cc, r:rr }; }
    }
    used.add(c+','+r); return { c, r };
  };
  main.forEach((li, k) => {
    const t = main.length > 1 ? k/(main.length-1) : 0.5;
    const p = claim(Math.round(margin + t * (MW-1 - 2*margin)), Math.round(MH/2 + Math.sin(t * Math.PI * 2.6) * (MH/2 - 5)));
    forts[li] = { c:p.c, r:p.r, li, name:Game.levels[li].name, theme:Game.levels[li].theme, secret:false, order:k };
  });
  const coves = [[MW-4,3],[3,MH-4],[MW-5,MH-5],[3,3]];
  secret.forEach((li, k) => { const p = claim(coves[k % coves.length][0], coves[k % coves.length][1]);
    forts[li] = { c:p.c, r:p.r, li, name:Game.levels[li].name, theme:Game.levels[li].theme, secret:true, order:-1 }; });
  forts.forEach(f => {                            // grass clearing + the fort tile
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { const rr=f.r+dr,cc=f.c+dc;
      if (rr>1 && rr<MH-2 && cc>1 && cc<MW-2) grid[rr][cc]='.'; }
    grid[f.r][f.c] = f.secret ? 'S' : 'F';
  });
  for (let k = 0; k < main.length-1; k++) {       // dirt path between consecutive main forts
    let a=forts[main[k]], b=forts[main[k+1]], c=a.c, r=a.r;
    while (c!==b.c || r!==b.r) { if (grid[r][c]==='.') grid[r][c]='p';
      if (c!==b.c) c += Math.sign(b.c-c); else r += Math.sign(b.r-r); }
  }
  for (let k = 0; k < 140; k++) {                 // forests/rocks on open grass (don't wall forts)
    const c = 2+((rnd()*(MW-4))|0), r = 2+((rnd()*(MH-4))|0);
    if (grid[r][c] !== '.') continue;
    let nearFort=false; for (const f of forts) if (Math.abs(f.c-c)<=1 && Math.abs(f.r-r)<=1) nearFort=true;
    if (!nearFort) grid[r][c] = rnd() < 0.6 ? 'T' : 'R';
  }
  // hidden collectibles tucked in nooks (biased toward the forests)
  const pickups = [], kinds = ['gem','gem','life','gem','ammo','gem','life','gem','gem','ammo'];
  let placed=0, tries=0;
  while (placed < kinds.length && tries++ < 600) {
    const c = 2+((rnd()*(MW-4))|0), r = 2+((rnd()*(MH-4))|0);
    if (grid[r][c] !== '.') continue;
    let nearFort=false; for (const f of forts) if (Math.abs(f.c-c)<=2 && Math.abs(f.r-r)<=2) nearFort=true;
    if (nearFort) continue;
    let nearTree=false; for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++){ const t=grid[r+dr]&&grid[r+dr][c+dc]; if (t==='T'||t==='R') nearTree=true; }
    if (!nearTree && rnd() < 0.55) continue;      // prefer hidden-by-trees spots
    pickups.push({ c, r, x:c*16+2, y:r*16+2, w:12, h:12, kind:kinds[placed], taken:false });
    placed++;
  }
  const start = forts[main[0]];
  Game.map = {
    MW, MH, grid, forts, pickups, t:0, cur:main[0], maxUnlocked:0, nearFort:main[0],
    done: Game.levels.map(() => false), grades: Game.levels.map(() => 0), secretsTotal: pickups.length, secretsFound: 0,
    hero: { x: start.c*16+2, y: start.r*16+2, w:12, h:12, dir:1, anim:0 },
    cam: { x:0, y:0 },
  };
  syncMapCam();
}
function syncMapCam() {
  const m = Game.map, h = m.hero;
  m.cam.x = clamp(h.x + h.w/2 - W/2, 0, Math.max(0, m.MW*16 - W));
  m.cam.y = clamp(h.y + h.h/2 - H/2, 0, Math.max(0, m.MH*16 - H));
}
function placeHeroOnNode(i) {
  const m = Game.map, f = m.forts[i];
  m.cur = i; m.nearFort = i;
  m.hero.x = f.c*16 + 2; m.hero.y = f.r*16 + 2;
  syncMapCam();
}
function enterMapLevel() {
  saveProgress();                 // persist overworld exploration (found secrets) before entering
  Game.levelIndex = Game.map.cur;
  loadLevel(Game.levelIndex);
  enterLevelCard();
  SFX.exit();
}
function updateWorldMap(dt) {
  const m = Game.map, h = m.hero; m.t += dt;
  const walk = (c, r) => MAP_WALK((r < 0 || r >= m.MH || c < 0 || c >= m.MW) ? '~' : m.grid[r][c]);
  const SP = 70;
  let vx = (held.right?1:0) - (held.left?1:0), vy = (held.down?1:0) - (held.up?1:0);
  if (vx) h.dir = vx > 0 ? 1 : -1;
  if (vx) {
    const nx = h.x + vx*SP*dt, edge = Math.floor((vx > 0 ? nx + h.w : nx)/16);
    if (walk(edge, Math.floor(h.y/16)) && walk(edge, Math.floor((h.y+h.h-1)/16))) h.x = nx;
  }
  if (vy) {
    const ny = h.y + vy*SP*dt, edge = Math.floor((vy > 0 ? ny + h.h : ny)/16);
    if (walk(Math.floor(h.x/16), edge) && walk(Math.floor((h.x+h.w-1)/16), edge)) h.y = ny;
  }
  if (vx || vy) h.anim += dt * 8;
  // collect hidden map pickups
  for (const pk of m.pickups) {
    if (pk.taken) continue;
    if (h.x < pk.x+pk.w && h.x+h.w > pk.x && h.y < pk.y+pk.h && h.y+h.h > pk.y) {
      pk.taken = true; m.secretsFound++;
      if (pk.kind === 'life') { Game.lives++; SFX.life(); }
      else if (pk.kind === 'ammo') { Game.ammo += 5; SFX.pickup(); }
      else { Game.score += 250; SFX.biggem(); }
    }
  }
  const hc = Math.floor((h.x+h.w/2)/16), hr = Math.floor((h.y+h.h/2)/16);
  m.nearFort = m.forts.findIndex(f => f.c === hc && f.r === hr);
  syncMapCam();
  if (pressed.start) {                            // confirm only (NOT jump — Up doubles as jump and would auto-enter)
    if (m.nearFort >= 0) {
      const f = m.forts[m.nearFort];
      if (f.secret || f.order <= m.maxUnlocked) { m.cur = m.nearFort; enterMapLevel(); }
      else SFX.bump();                            // locked main fort
    }
  }
}
function respawn() {
  Game.hearts = MAX_HEARTS;
  Game.player = newPlayer(Game.startPos);
  Game.player.invuln = 1.0;
  Game.player.hazImmune = 1.0;       // mirror i-frames for hazards too, so a hazard-adjacent checkpoint can't death-loop
  Game.cam.x = clamp(Game.player.x - W/2, 0, Game.cols*16 - W);
  Game.shots = []; Game.eshots = [];
  Game.platforms = buildPlatforms(Game.levels[Game.levelIndex]);  // reset to deterministic phase
  // restore non-collected pickups? keep collected. reset enemies positions of this level:
  loadEnemiesOnly();
  // Boss arena only: the boss resets to full HP on death, so refresh its ammo each attempt —
  // otherwise spent ammo + a renewed boss + no exit door is a softlock. (Only the boss level
  // has a 'Z'; normal levels keep collected pickups gone to avoid gem-farming.)
  const lvl = Game.levels[Game.levelIndex];
  if (Game.enemies.some(e => e.boss)) {
    Game.pickups = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < lvl.cols; c++) {
      const ch = lvl.g[r][c];
      if (ch === 'o' || ch === 'G' || ch === 'a' || ch === 'h')
        Game.pickups.push({ kind: ch==='o'?'gem':ch==='G'?'biggem':ch==='a'?'ammo':'life', x:c*16, y:r*16, w:16, h:16, t:0, taken:false });
    }
  }
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
const isSolid = ch => ch === '#' || ch === 'B' || ch === '<' || ch === '>';  // conveyors are solid floor
const isOneway = ch => ch === 'T';
const isHazard = ch => ch === '^' || ch === 'L';                              // spikes + lava = instant death
const conveyorDir = ch => ch === '<' ? -1 : ch === '>' ? 1 : 0;

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

/* ----- Moving platforms & conveyor belts ----- */
function updatePlatforms(dt) {
  if (!Game.platforms) return;
  for (const pf of Game.platforms) {
    pf.t += dt;
    const ox = pf.x, oy = pf.y;
    if (pf.axis === 'h') pf.x = pf.x0 + Math.sin(pf.t * pf.speed) * pf.range;
    else pf.y = pf.y0 + Math.sin(pf.t * pf.speed) * pf.range;
    pf.dx = pf.x - ox; pf.dy = pf.y - oy;
  }
}
function ridePlatforms(e) {
  if (!Game.platforms) return;
  for (const pf of Game.platforms) {
    const overX = e.x + e.w > pf.x + 1 && e.x < pf.x + pf.w - 1;
    const feet = e.y + e.h;
    if (e.vy >= 0 && overX && feet >= pf.y - 1 && feet <= pf.y + 9) {
      // vertical carry — but don't snap the rider up through a solid ceiling
      const ny = pf.y - e.h, headR = Math.floor(ny / 16);
      let ceil = false;
      for (let c = Math.floor(e.x/16); c <= Math.floor((e.x+e.w-1)/16); c++) if (isSolid(tileAt(c, headR))) ceil = true;
      e.y = ceil ? (headR + 1) * 16 : ny; e.vy = 0; e.onGround = true;
      // horizontal carry — clamp against walls WITHOUT re-integrating run velocity (no double-move)
      if (pf.dx !== 0) {
        const nx = e.x + pf.dx, top = Math.floor(e.y/16), bot = Math.floor((e.y+e.h-1)/16);
        if (pf.dx > 0) { const c = Math.floor((nx+e.w-1)/16); let hit=false; for (let r=top;r<=bot;r++) if (isSolid(tileAt(c,r))) hit=true; e.x = hit ? c*16 - e.w : nx; }
        else          { const c = Math.floor(nx/16);         let hit=false; for (let r=top;r<=bot;r++) if (isSolid(tileAt(c,r))) hit=true; e.x = hit ? (c+1)*16 : nx; }
      }
    }
  }
}
function applyConveyor(e, dt) {
  if (!e.onGround) return;
  const fr = Math.floor((e.y + e.h) / 16);
  const c0 = Math.floor((e.x + 2) / 16), c1 = Math.floor((e.x + e.w - 2) / 16);
  let dir = 0;
  for (let c = c0; c <= c1; c++) { const d = conveyorDir(tileAt(c, fr)); if (d) { dir = d; break; } }
  if (dir) { const sv = e.vx; e.vx = dir * 70; moveX(e); e.vx = sv; }
}

/* --------------------------- PARTICLES ----------------------------- */
function spawnBurst(x, y, color, n, spd) {
  n = Math.min(n, Math.max(0, 280 - Game.particles.length));   // cap total live particles
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
  const icy = THEMES[Game.theme].icy && p.onGround;     // slippery footing on ice
  const accel = icy ? RUN_ACCEL * 0.45 : RUN_ACCEL;
  const frict = icy ? 140 : RUN_FRICT;
  const dirIn = (held.right?1:0) - (held.left?1:0);
  if (dirIn !== 0) {
    p.vx += dirIn * accel * dt;
    p.vx = clamp(p.vx, -RUN_SPEED, RUN_SPEED);
    p.dir = dirIn;
  } else {
    if (p.vx > 0) p.vx = Math.max(0, p.vx - frict*dt);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + frict*dt);
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
  if (p.hazImmune > 0) p.hazImmune -= dt;

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
  updatePlatforms(dt);
  moveX(p);
  moveY(p);
  if (p.hitCeil) p.vy = 0;
  ridePlatforms(p);                 // land on / be carried by moving platforms
  applyConveyor(p, dt);             // conveyor belts push you while grounded

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

  // ---- checkpoint ----
  { const cc = Math.floor((p.x+p.w/2)/16), cr = Math.floor((p.y+p.h/2)/16);
    if (tileAt(cc, cr) === 'C' && !Game.cpTriggered.has(cc+','+cr)) {
      Game.cpTriggered.add(cc+','+cr);
      Game.startPos = { x: cc*16, y: cr*16 };       // respawn here instead of the level start
      spawnBurst(cc*16+8, cr*16+4, EGA.bcyan, 10, 80); SFX.select();
    } }
  // ---- hazards / fall death (i-frames + brief post-hit grace don't save you from a pit) ----
  if ((touchingHazard(p) && p.hazImmune <= 0) || p.y > ROWS*16 + 24) { killPlayer(); return; }

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
  compact(Game.shots, s => s.life > 0);

  // ---- enemies ----
  const spawnBuf = [];                       // boss adds, flushed after the loop (no mutate-during-iteration)
  for (const e of Game.enemies) {
    if (e.dead) { e.dyTimer -= dt; continue; }
    e.anim += dt * 6;
    if (e.boss) {
      // The Overseer — 3 escalating phases: P1 fixed spread; P2 faster + aimed; P3 fastest + summons adds
      e.t += dt; if (e.flash > 0) e.flash -= dt;
      const phase = e.hp <= e.maxHp/3 ? 3 : e.hp <= 2*e.maxHp/3 ? 2 : 1;
      const spd = e.speed * (phase === 3 ? 2.2 : phase === 2 ? 1.6 : 1.0);
      const tx = clamp(p.x + p.w/2 - e.w/2, 32, Game.cols*16 - e.w - 32);
      e.x += Math.sign(tx - e.x) * Math.min(Math.abs(tx - e.x), spd * dt);
      e.dir = (p.x + p.w/2 >= e.x + e.w/2) ? 1 : -1;
      e.y = e.homeY + Math.sin(e.t * (phase === 1 ? 1.6 : 2.4)) * 24;
      e.attackTimer -= dt;
      if (e.attackTimer < 0.28) e.flash = Math.max(e.flash, 0.12);   // windup telegraph before a volley
      if (e.attackTimer <= 0) {
        e.attackTimer = phase === 3 ? 1.0 : phase === 2 ? 1.35 : 1.9;
        const cx = e.x + e.w/2, cy = e.y + e.h - 2;
        if (phase === 1) {
          for (const vx of [-95, 0, 95]) Game.eshots.push({ x:cx-3, y:cy, w:6, h:5, vx, vy:135, life:3.5 });
        } else {                                                     // aimed 3-shot fan toward the player
          const dx = (p.x + p.w/2) - cx, dy = Math.max(45, p.y - cy), k = 160 / Math.hypot(dx, dy);
          const ax = dx*k, ay = dy*k;
          for (const off of [-70, 0, 70]) Game.eshots.push({ x:cx-3, y:cy, w:6, h:5, vx:ax+off, vy:ay, life:3.5 });
        }
        SFX.shoot();
      }
      if (phase === 3) {                                             // summon up to 2 homing flyer adds
        e.addTimer = (e.addTimer || 0) - dt;
        if (e.addTimer <= 0) {
          e.addTimer = 4.5;
          let adds = 0; for (const x of Game.enemies) if (x.bossAdd && !x.dead) adds++;
          if (adds < 2) { const fl = makeEnemy('flyer', Math.floor((e.x+e.w/2)/16), 4); fl.homing = true; fl.bossAdd = true; spawnBuf.push(fl); }
        }
      }
    } else if (e.fly) {
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
    } else if (e.turret) {
      // stationary cannon: fires down its lane when the player is roughly aligned in front
      e.fireTimer -= dt;
      e.dir = (p.x + p.w/2 >= e.x + e.w/2) ? 1 : -1;
      const dx = Math.abs((p.x+p.w/2) - (e.x+e.w/2)), dy = Math.abs((p.y+p.h/2) - (e.y+e.h/2));
      if (e.fireTimer <= 0 && dx < 170 && dy < 26) {
        e.fireTimer = 1.5;
        Game.eshots.push({ x: e.x + (e.dir>0 ? e.w : -6), y: e.y + 6, w:6, h:4, vx: e.dir*155, life:3 });
        SFX.shoot();
      }
    } else if (e.bounce) {
      // invincible bouncing hazard — perpetual bounce, reflects off walls, turns at ledges (never self-destructs in a pit)
      e.vy += GRAV * dt; if (e.vy > MAX_FALL) e.vy = MAX_FALL;
      e.vx = e.dir * e.speed;
      moveX(e);
      if (e.hitWall) e.dir *= -1;
      moveY(e);
      if (e.onGround) {
        // predict where this bounce arc lands; reverse BEFORE leaping if it would land in a pit
        // (the arc overshoots a narrow pit, so an at-landing ledge check is too late)
        const air = 2 * e.bounceVel / GRAV;                       // time to return to launch height
        const landX = e.x + e.dir * e.speed * air;
        const landC = e.dir > 0 ? Math.floor((landX + e.w) / 16) : Math.floor(landX / 16);
        const footR = Math.floor((e.y + e.h + 1) / 16);
        let grounded = false;
        for (let r = footR; r <= footR + 4; r++) if (isSolid(tileAt(landC, r))) { grounded = true; break; }
        if (!grounded) e.dir *= -1;                               // landing column has no floor -> turn back
        e.vy = -e.bounceVel;
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
        s.life = 0;
        if (e.invincible) { spawnBurst(e.x+e.w/2, e.y+e.h/2, EGA.white, 4, 60); SFX.bump(); continue; }
        e.hp--;
        if (e.boss) e.flash = 0.12;
        spawnBurst(e.x+e.w/2, e.y+e.h/2, EGA.white, 6, 80);
        if (e.hp <= 0) { if (e.boss) defeatBoss(e); else defeatEnemy(e); }
        else SFX.bump();
      }
    }
    // player collision
    if (!e.dead && p.invuln <= 0 && aabb(p, e)) hurtPlayer(e);
  }
  for (const s of spawnBuf) Game.enemies.push(s);   // flush boss adds (they act starting next frame)
  compact(Game.enemies, e => !(e.dead && e.dyTimer <= 0));

  // ---- enemy projectiles (turret = horizontal, boss = spread w/ vy) ----
  for (const es of Game.eshots) {
    es.x += es.vx * dt; es.y += (es.vy || 0) * dt; es.life -= dt;
    const c = Math.floor((es.x + es.w/2)/16), r = Math.floor((es.y + es.h/2)/16);
    if (isSolid(tileAt(c, r))) { es.life = 0; spawnBurst(es.x, es.y, EGA.bred, 3, 50); }
    else if (p.invuln <= 0 && aabb(p, es)) { es.life = 0; hurtPlayer(es); }
  }
  compact(Game.eshots, es => es.life > 0);

  // ---- pickups ----
  for (const k of Game.pickups) {
    if (k.taken) continue;
    k.t += dt;
    if (aabb(p, k)) collect(k);
  }
  compact(Game.pickups, k => !k.taken);

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
  compact(Game.particles, pt => pt.life > 0);
}

function defeatEnemy(e) {
  e.dead = true; e.dyTimer = 0.4;
  Game.defeated.add(e.sc + ',' + e.sr);   // stays cleared across respawns (no death-farming)
  Game.score += 150; Game.levelScore += 150;
  spawnBurst(e.x+e.w/2, e.y+e.h/2, e.type==='flyer'?EGA.yellow:e.type==='bloog'?EGA.bmagenta:EGA.bgreen, 12, 120);
  Game.shake = Math.max(Game.shake, 4);
  SFX.enemy();
}

function defeatBoss(e) {
  e.dead = true; e.dyTimer = 0.6;
  Game.defeated.add(e.sc + ',' + e.sr);
  Game.score += 5000; Game.levelScore += 5000;
  for (let i = 0; i < 6; i++)
    spawnBurst(e.x + Math.random()*e.w, e.y + Math.random()*e.h, [EGA.yellow,EGA.bred,EGA.white,EGA.bcyan][i%4], 14, 150);
  Game.shake = 16; Game.flash = 1; Game.eshots = [];
  for (const x of Game.enemies) if (x.bossAdd) { x.dead = true; x.dyTimer = 0.4; }   // clear summoned adds
  SFX.win();
  levelClear();         // boss is in the final level -> level-clear cascades to victory
}

function hurtPlayer(e) {
  const p = Game.player;
  Game.hearts--;
  p.invuln = INVULN;
  p.hazImmune = 0.28;               // brief grace so knockback can't fling you onto spikes/lava
  p.pogo = false;                   // drop pogo on a hit so a stray toggle can't snowball into death
  p.vx = (p.x < e.x ? -1 : 1) * 150;
  p.vy = -180;
  Game.shake = 6; Game.flash = 0.6;
  SFX.hurt();
  if (Game.hearts <= 0) killPlayer();
}

function killPlayer() {
  if (Game.state !== 'play') return;
  Game.lives--;
  Game.player.pogo = false;
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
const skyGradCache = {};
function skyGrad(theme) {
  if (skyGradCache[theme]) return skyGradCache[theme];
  const t = THEMES[theme], g = bx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.sky[0]); g.addColorStop(0.55, t.sky[1]); g.addColorStop(1, t.sky[2]);
  return (skyGradCache[theme] = g);   // static per theme — built once, not every frame
}
function drawBackdrop() {
  bx.fillStyle = skyGrad(Game.theme); bx.fillRect(0, 0, W, H);
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
  } else if (ch === 'L') {
    // lava (instant death) — bright, churning
    const ph = Math.sin(Game.timer*3 + c) ;
    bx.fillStyle = EGA.red; bx.fillRect(sx, sy, 16, 16);
    bx.fillStyle = EGA.bred; bx.fillRect(sx, sy + (ph>0?1:2), 16, 4);
    bx.fillStyle = EGA.yellow;
    bx.fillRect(sx + ((c*3 + Math.floor(Game.timer*4)) % 12), sy+1, 3, 1);
    bx.fillRect(sx + ((c*5 + Math.floor(Game.timer*5)) % 12), sy+5, 2, 1);
  } else if (ch === '<' || ch === '>') {
    // conveyor belt — solid floor that pushes you
    bx.fillStyle = t.block; bx.fillRect(sx, sy, 16, 16);
    bx.fillStyle = t.blockD; bx.fillRect(sx, sy, 16, 2); bx.fillRect(sx, sy+14, 16, 2);
    bx.fillStyle = t.accent;
    const off = Math.floor(Game.timer * 20) % 8, d = ch === '>' ? 1 : -1;
    for (let i = -1; i < 3; i++) { const ax = sx + ((i*8 + d*off) & 15); bx.fillRect(ax, sy+6, 4, 4); }
  } else if (ch === 'C') {
    // checkpoint flag — green/raised once reached, gray/lowered until then
    const lit = Game.cpTriggered && Game.cpTriggered.has(c + ',' + r);
    bx.fillStyle = EGA.dgray; bx.fillRect(sx+7, sy+2, 2, 14);            // pole
    bx.fillStyle = lit ? EGA.bgreen : EGA.lgray;
    const fy = lit ? sy+2 : sy+8;                                        // flag rides up when lit
    bx.fillRect(sx+9, fy, 6, 4); bx.fillRect(sx+9, fy, 1, 4);
    if (lit && Math.sin(Game.timer*8) > 0) { bx.fillStyle = EGA.white; bx.fillRect(sx+10, fy+1, 1, 1); }
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

  // moving platforms
  { const t = THEMES[Game.theme];
    for (const pf of Game.platforms) {
      const sx = Math.floor(pf.x - camx), sy = Math.floor(pf.y);
      bx.fillStyle = t.block; bx.fillRect(sx, sy, pf.w, pf.h);
      bx.fillStyle = t.accent; bx.fillRect(sx, sy, pf.w, 2);
      bx.fillStyle = t.blockD; bx.fillRect(sx, sy+pf.h-2, pf.w, 2);
      bx.fillStyle = t.blockD; bx.fillRect(sx+3, sy+3, 2, 2); bx.fillRect(sx+pf.w-5, sy+3, 2, 2);
    }
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
    const fr = e.hop ? (e.onGround ? 0 : 1)
             : e.turret ? (e.fireTimer < 0.25 ? 1 : 0)
             : (Math.floor(e.anim) % 2);
    const key = e.type + '_' + fr + '_' + (e.dir>0?'R':'L');
    const spr = SPR[key];
    if (spr) bx.drawImage(spr, sx + (e.w-spr.width)/2, sy + (e.h-spr.height));
    if (e.boss && e.flash > 0) { bx.globalAlpha = 0.6; bx.fillStyle = EGA.white; bx.fillRect(sx, sy, e.w, e.h); bx.globalAlpha = 1; }
  }

  // shots
  for (const s of Game.shots) {
    const sx = Math.floor(s.x - camx), sy = Math.floor(s.y);
    bx.fillStyle = C.gunGlow; bx.fillRect(sx, sy, 6, 4);
    bx.fillStyle = EGA.white; bx.fillRect(sx + (s.dir>0?4:0), sy+1, 2, 2);
  }
  // enemy shots
  for (const es of Game.eshots) {
    const sx = Math.floor(es.x - camx), sy = Math.floor(es.y);
    bx.fillStyle = EGA.bred; bx.fillRect(sx, sy, 6, 4);
    bx.fillStyle = EGA.yellow; bx.fillRect(sx + (es.vx>0?4:0), sy+1, 2, 2);
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
  // pogo indicator (lit while pogo mode is on, so the modal state is never hidden)
  if (Game.player && Game.player.pogo) {
    bx.fillStyle = EGA.bgreen; bx.fillRect(250, 2, 26, 11);
    bx.fillStyle = EGA.green; bx.fillRect(250, 11, 26, 2);
    txt('POGO', 263, 4, 6, EGA.black, 'center');
  }
  // gems
  txt(Game.gems + '/' + Game.gemsTotal, W-4, 4, 7, EGA.bcyan, 'right');
  // boss health bar (when a boss is alive on-screen)
  const boss = Game.enemies && Game.enemies.find(e => e.boss && !e.dead);
  if (boss) {
    const bw = 160, bx0 = (W-bw)/2, by0 = 18;
    txt('OVERSEER', W/2, 18, 6, EGA.bred, 'center', EGA.black);
    bx.fillStyle = EGA.black; bx.fillRect(bx0-1, by0+8, bw+2, 6);
    bx.fillStyle = EGA.dgray; bx.fillRect(bx0, by0+9, bw, 4);
    bx.fillStyle = EGA.bred; bx.fillRect(bx0, by0+9, Math.max(0, Math.round(bw * boss.hp / boss.maxHp)), 4);
    bx.fillStyle = EGA.yellow; bx.fillRect(bx0, by0+9, Math.max(0, Math.round(bw * boss.hp / boss.maxHp)), 1);
  }
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
  const opts = titleOptions(), labels = { continue:'CONTINUE', new:'NEW GAME', start:'START', options:'OPTIONS' };
  const y0 = 142;
  opts.forEach((o, i) => {
    const on = i === Game.menuSel;
    const confirming = on && o === 'new' && Game.confirmNew;
    txt((on ? '> ' : '  ') + (confirming ? 'ERASE? AGAIN' : labels[o]), W/2, y0 + i*14, 8, confirming ? EGA.bred : on ? EGA.yellow : EGA.lgray, 'center', EGA.black);
  });
  if (blink) txt('UP/DOWN  +  ENTER / TAP', W/2, y0 + opts.length*14 + 2, 6, EGA.bcyan, 'center');
  txt('HIGH ' + String(Game.highScore).padStart(6,'0'), W/2, 198, 6, EGA.bcyan, 'center');
}

function drawIntro() {
  drawBackdrop();
  bx.fillStyle = 'rgba(0,0,0,0.78)'; bx.fillRect(0, 0, W, H);
  txt('THE BRIEFING', W/2, 22, 10, EGA.yellow, 'center', EGA.brown);
  const lines = [
    'The Overseer has seized the Orion system,',
    'caging its worlds behind iron forts and',
    'flooding them with its machine swarm.',
    '',
    'You are COMMANDER COSMO. Pack your raygun,',
    'mount your pogo, and clear every fort -',
    'then bring the Overseer down.',
  ];
  lines.forEach((s, i) => txt(s, W/2, 56 + i*15, 6, i === 0 || i >= 4 ? EGA.white : EGA.bgreen, 'center'));
  if (Math.floor(Game.timer*2) % 2 === 0) txt('PRESS ENTER / TAP TO BEGIN', W/2, H-22, 7, EGA.bcyan, 'center', EGA.black);
}

function drawCredits() {
  bx.fillStyle = EGA.black; bx.fillRect(0, 0, W, H);
  drawBackdrop(); bx.fillStyle = 'rgba(0,0,0,0.6)'; bx.fillRect(0, 0, W, H);
  const lines = [
    '~ COMMANDER COSMO ~', 'GALACTIC POGO PATROL', '',
    'THE ORION SYSTEM IS FREE', '',
    'DESIGN & CODE ... you & Claude',
    'ART & MUSIC ..... generated in code',
    'ENGINE .......... HTML5 canvas',
    '', 'AN ORIGINAL HOMAGE TO THE', 'CLASSIC EGA PLATFORMERS', '',
    'FINAL SCORE  ' + String(Game.score).padStart(6,'0'),
    'THANKS FOR PLAYING!',
  ];
  const scroll = H - Math.floor(Game.timer * 22);     // slow upward roll
  lines.forEach((s, i) => { const y = scroll + i*16; if (y > -10 && y < H)
    txt(s, W/2, y, i === 0 ? 9 : 6, i === 0 ? EGA.yellow : i === 12 ? EGA.bcyan : EGA.bgreen, 'center', EGA.black); });
  if (Math.floor(Game.timer*2) % 2 === 0) txt('PRESS ENTER / TAP', W/2, H-12, 6, EGA.lgray, 'center', EGA.black);
}

function drawSettings() {
  drawBackdrop(); bx.fillStyle = 'rgba(0,0,0,0.8)'; bx.fillRect(0, 0, W, H);
  txt('OPTIONS', W/2, 28, 14, EGA.yellow, 'center', EGA.brown);
  const bar = (y, label, v, on) => {
    txt(label, W/2 - 60, y, 7, on ? EGA.yellow : EGA.lgray, 'left');
    const bx0 = W/2 + 8, bw = 60;
    bx.fillStyle = EGA.dgray; bx.fillRect(bx0, y, bw, 6);
    bx.fillStyle = on ? EGA.bgreen : EGA.green; bx.fillRect(bx0, y, Math.round(bw * v), 6);
    if (on) { bx.fillStyle = EGA.bcyan; bx.fillRect(bx0-6, y, 3, 6); bx.fillRect(bx0+bw+3, y, 3, 6); }  // < > arrows
  };
  bar(70,  'MUSIC VOL', musicVol, Game.setSel === 0);
  bar(92,  'SFX VOL',   sfxVol,   Game.setSel === 1);
  txt('MUSIC', W/2 - 60, 114, 7, Game.setSel === 2 ? EGA.yellow : EGA.lgray, 'left');
  txt(musicOn ? 'ON' : 'OFF', W/2 + 8, 114, 7, musicOn ? EGA.bgreen : EGA.bred, 'left');
  txt((Game.setSel === 3 ? '> ' : '  ') + 'BACK', W/2, 140, 8, Game.setSel === 3 ? EGA.yellow : EGA.lgray, 'center');
  txt('UP/DOWN SELECT   LEFT/RIGHT ADJUST', W/2, 166, 6, EGA.lgray, 'center');
  txt('ENTER CONFIRM   ESC BACK', W/2, 176, 6, EGA.lgray, 'center');
}

function drawMapTile(ch, sx, sy, c, r, t) {
  if (ch === '~') {                                // water
    bx.fillStyle = EGA.blue; bx.fillRect(sx, sy, 16, 16);
    bx.fillStyle = EGA.bcyan;
    if ((c + r + Math.floor(t*2)) % 3 === 0) bx.fillRect(sx+3, sy+6, 6, 1);
    if ((c*2 + r + Math.floor(t*2)) % 4 === 0) bx.fillRect(sx+9, sy+11, 4, 1);
    return;
  }
  bx.fillStyle = EGA.green; bx.fillRect(sx, sy, 16, 16);     // grass base
  bx.fillStyle = EGA.bgreen; bx.fillRect(sx, sy, 16, 3);
  bx.fillStyle = EGA.green; if ((c*7 + r*3) % 5 === 0) bx.fillRect(sx+10, sy+9, 2, 2);
  if (ch === 'p') {                                // dirt path
    bx.fillStyle = EGA.brown; bx.fillRect(sx+1, sy+1, 14, 14);
    bx.fillStyle = EGA.yellow; bx.fillRect(sx+5, sy+5, 2, 2); bx.fillRect(sx+10, sy+9, 2, 2);
  } else if (ch === 'T') {                          // tree
    bx.fillStyle = EGA.brown; bx.fillRect(sx+7, sy+9, 3, 6);
    bx.fillStyle = EGA.green; bx.fillRect(sx+2, sy+1, 12, 9);
    bx.fillStyle = EGA.bgreen; bx.fillRect(sx+3, sy+1, 8, 4); bx.fillRect(sx+5, sy+5, 4, 3);
  } else if (ch === 'R') {                          // rock
    bx.fillStyle = EGA.lgray; bx.fillRect(sx+2, sy+5, 12, 9);
    bx.fillStyle = EGA.white; bx.fillRect(sx+4, sy+6, 3, 2);
    bx.fillStyle = EGA.dgray; bx.fillRect(sx+2, sy+13, 12, 1);
  }
}
function drawFort(f, sx, sy, t, m) {
  const done = m.done[f.li];
  if (f.secret) {                                                                  // hidden cave/grotto
    bx.fillStyle = EGA.brown; bx.fillRect(sx-3, sy+7, 22, 9);                       // mound
    bx.fillStyle = done ? EGA.bgreen : EGA.dgray; bx.fillRect(sx-1, sy-2, 18, 12);
    bx.fillStyle = EGA.bgreen; bx.fillRect(sx-1, sy-2, 18, 2);
    bx.fillStyle = EGA.black; bx.fillRect(sx+5, sy+2, 6, 8);                        // cave mouth
    if (done) { bx.fillStyle = EGA.white; bx.fillRect(sx+6, sy+3, 4, 4); }          // checkmark
    else txt('?', sx+8, sy-2, 8, (Math.sin(t*5) > 0) ? EGA.yellow : EGA.bmagenta, 'center', EGA.black);
    return;
  }
  const locked = f.order > m.maxUnlocked;
  bx.fillStyle = done ? EGA.green : EGA.brown; bx.fillRect(sx-3, sy+8, 22, 8);     // base
  bx.fillStyle = locked ? EGA.dgray : (done ? EGA.bgreen : EGA.lgray);             // tower
  bx.fillRect(sx, sy-3, 16, 13);
  bx.fillStyle = EGA.dgray; bx.fillRect(sx, sy+9, 16, 1);
  bx.fillStyle = locked ? EGA.dgray : EGA.lgray;                                   // battlements
  bx.fillRect(sx, sy-6, 4, 4); bx.fillRect(sx+6, sy-6, 4, 4); bx.fillRect(sx+12, sy-6, 4, 4);
  bx.fillStyle = EGA.black; bx.fillRect(sx+6, sy+3, 4, 7);                          // door
  if (done) {
    bx.fillStyle = EGA.white; bx.fillRect(sx+6, sy-1, 4, 4);                        // checkmark
    const g = (m.grades && m.grades[f.li]) || 1;                                    // grade pips above the tower
    for (let i = 0; i < g; i++) { bx.fillStyle = EGA.yellow; bx.fillRect(sx+3 + i*4, sy-9, 2, 2); }
  }
  else if (locked) { bx.fillStyle = EGA.black; bx.fillRect(sx+5, sy-1, 6, 5); bx.fillStyle = EGA.yellow; bx.fillRect(sx+7, sy+1, 2, 2); } // padlock
  else { bx.fillStyle = (Math.sin(t*6) > 0) ? EGA.bred : EGA.yellow; bx.fillRect(sx+8, sy-13, 2, 7); bx.fillRect(sx+10, sy-13, 5, 3); }   // flag
  txt(String(f.order+1), sx+8, sy+12, 6, locked ? EGA.dgray : EGA.white, 'center', EGA.black);
}
function drawWorldMap() {
  const m = Game.map, t = m.t, camx = Math.floor(m.cam.x), camy = Math.floor(m.cam.y);
  bx.fillStyle = EGA.blue; bx.fillRect(0, 0, W, H);
  const c0 = Math.max(0, Math.floor(camx/16)), c1 = Math.min(m.MW-1, Math.floor((camx+W)/16)+1);
  const r0 = Math.max(0, Math.floor(camy/16)), r1 = Math.min(m.MH-1, Math.floor((camy+H)/16)+1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
    drawMapTile(m.grid[r][c], c*16 - camx, r*16 - camy, c, r, t);
  // hidden map collectibles
  for (const pk of m.pickups) {
    if (pk.taken) continue;
    const sx = Math.floor(pk.x - camx), sy = Math.floor(pk.y - camy);
    if (sx < -16 || sx > W || sy < -16 || sy > H) continue;
    const spr = pk.kind === 'life' ? SPR.life : pk.kind === 'ammo' ? SPR.ammo : SPR.biggem;
    const bob = Math.sin(t*4 + pk.c) * 2;
    bx.drawImage(spr, sx + (16-spr.width)/2, sy - 2 + bob + (16-spr.height)/2);
    if (Math.sin(t*6 + pk.r) > 0.5) { bx.fillStyle = EGA.white; bx.fillRect(sx+8, sy-2+bob, 1, 1); }  // glint
  }
  for (let i = 0; i < m.forts.length; i++) {
    const f = m.forts[i];
    if (f.c < c0-1 || f.c > c1+1 || f.r < r0-2 || f.r > r1+1) continue;
    drawFort(f, f.c*16 - camx, f.r*16 - camy, t, m);
  }
  // hero (walk-bob)
  const h = m.hero, moving = held.left||held.right||held.up||held.down;
  const frame = moving ? ((Math.floor(h.anim) % 2) ? 'run1' : 'run2') : 'stand';
  bx.drawImage(SPR['hero_'+frame+'_'+(h.dir>0?'R':'L')], Math.floor(h.x - camx)-2, Math.floor(h.y - camy)-6);
  // banner
  bx.fillStyle = 'rgba(0,0,0,0.55)'; bx.fillRect(0, 0, W, 24);
  let won = true; for (const f of m.forts) if (f && !f.secret && !m.done[f.li]) { won = false; break; }
  txt(won ? 'SYSTEM SECURED *' : 'ORION SYSTEM', W/2, 4, 8, won ? EGA.bgreen : EGA.yellow, 'center', EGA.brown);
  if (m.nearFort >= 0) {
    const f = m.forts[m.nearFort], locked = !f.secret && f.order > m.maxUnlocked;
    txt((f.secret ? 'SECRET: ' : '') + f.name.toUpperCase(), W/2, 15, 7, locked?EGA.lgray:(f.secret?EGA.bmagenta:EGA.white), 'center');
    if (locked) txt('LOCKED - CLEAR EARLIER FORTS', W/2, H-30, 7, EGA.bred, 'center', EGA.black);
    else if (Math.floor(t*2)%2===0) txt('JUMP / ENTER = PLAY', W/2, H-30, 7, EGA.bcyan, 'center', EGA.black);
  } else {
    txt(won ? 'ALL FORTS CLEARED - HUNT SECRETS & STARS' : 'EXPLORE - SECRETS HIDDEN IN THE TREES', W/2, 15, 6, EGA.bgreen, 'center');
  }
  // mini hud
  txt('SCORE '+String(Game.score).padStart(6,'0'), 4, H-11, 7, EGA.yellow, 'left', EGA.black);
  txt('SECRETS ' + m.secretsFound + '/' + m.secretsTotal, W/2, H-11, 6, EGA.bmagenta, 'center', EGA.black);
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
  txt('PAUSED', W/2, 62, 16, EGA.yellow, 'center', EGA.brown);
  txt('P / ESC  RESUME', W/2, 94, 7, EGA.white, 'center');
  txt('O  OPTIONS', W/2, 110, 7, EGA.lgray, 'center');
  txt('M  MUSIC: ' + (musicOn?'ON':'OFF') + '   N  ' + (muted?'UNMUTE':'MUTE'), W/2, 126, 6, EGA.lgray, 'center');
  txt('Q  QUIT TO TITLE', W/2, 142, 7, EGA.lgray, 'center');
}

function drawDead() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(85,0,0,0.55)'; bx.fillRect(0, 0, W, H);
  txt('OUCH!', W/2, 84, 16, EGA.bred, 'center', EGA.black);
  txt('LIVES LEFT: ' + Game.lives, W/2, 116, 8, EGA.white, 'center');
}

// three rank "stars" (plus-shapes), filled up to `grade`
function drawStars(cx, y, grade) {
  const sp = 12, x0 = cx - sp;
  for (let i = 0; i < 3; i++) {
    const x = x0 + i*sp; bx.fillStyle = i < grade ? EGA.yellow : EGA.dgray;
    bx.fillRect(x+1, y, 1, 5); bx.fillRect(x-1, y+2, 5, 1);
    if (i < grade) { bx.fillStyle = EGA.white; bx.fillRect(x+1, y+2, 1, 1); }
  }
}
function drawLevelClear() {
  drawBackdrop(); drawWorld(); drawHUD();
  bx.fillStyle = 'rgba(0,0,0,0.72)'; bx.fillRect(0, 0, W, H);
  txt('LEVEL CLEAR!', W/2, 56, 14, EGA.bgreen, 'center', EGA.green);
  const grade = (Game.map && Game.map.grades && Game.map.grades[Game.levelIndex]) || 1;
  drawStars(W/2, 84, grade);
  txt('GEMS ' + Game.gems + '/' + Game.gemsTotal, W/2, 98, 8, EGA.bcyan, 'center');
  if (Game.perfect) txt('PERFECT! +1000', W/2, 114, 8, EGA.yellow, 'center');
  txt('SCORE ' + String(Game.score).padStart(6,'0'), W/2, 132, 8, EGA.white, 'center');
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
  // confetti (spawned + advanced in update() at fixed dt; here we only render)
  for (const pt of Game.particles) { bx.globalAlpha = clamp(pt.life,0,1); bx.fillStyle = pt.color; bx.fillRect(Math.floor(pt.x), Math.floor(pt.y), pt.size, pt.size); }
  bx.globalAlpha = 1;
}

/* --------------------------- STATE STEP ---------------------------- */
function update(dt) {
  switch (Game.state) {
    case 'title': {
      Game.timer += dt;
      const opts = titleOptions();                       // ['continue','new','options'] or ['start','options']
      if (Game.menuSel >= opts.length) Game.menuSel = 0;
      if (pressed.up)   { Game.menuSel = (Game.menuSel + opts.length - 1) % opts.length; Game.confirmNew = false; SFX.select(); }
      if (pressed.down) { Game.menuSel = (Game.menuSel + 1) % opts.length; Game.confirmNew = false; SFX.select(); }
      if (pressed.start) {                                // confirm = Enter / tap (not jump, to avoid Up=jump clash)
        ensureAudio(); SFX.select();
        const pick = opts[Game.menuSel];
        if (pick === 'continue') continueGame();
        else if (pick === 'options') { Game.settingsReturn = 'title'; Game.setSel = 0; Game.state = 'settings'; }
        else if (pick === 'new') {                        // NEW GAME wipes the save — require a confirm tap
          if (Game.confirmNew) { Game.confirmNew = false; clearProgress(); Game.state = 'intro'; Game.timer = 0; }
          else Game.confirmNew = true;
        } else { clearProgress(); Game.state = 'intro'; Game.timer = 0; }   // start (no save)
      }
      break;
    }
    case 'intro':
      Game.timer += dt;
      if (pressed.start && Game.timer > 0.3) { ensureAudio(); startGame(); SFX.select(); }
      break;
    case 'settings': {
      const N = 4;                                        // [music vol, sfx vol, music on/off, back]
      if (pressed.up)   { Game.setSel = (Game.setSel + N - 1) % N; SFX.select(); }
      if (pressed.down) { Game.setSel = (Game.setSel + 1) % N; SFX.select(); }
      const sel = Game.setSel, dir = (held.right?1:0) - (held.left?1:0);   // hold to ramp (works for keys + touch)
      if ((sel === 0 || sel === 1) && dir) {
        const fresh = pressed.left || pressed.right;
        Game.adjT = fresh ? 0 : (Game.adjT || 0) - dt;
        if (fresh || Game.adjT <= 0) {
          Game.adjT = fresh ? 0.32 : 0.09;                                  // initial delay, then repeat
          if (sel === 0) musicVol = clamp(Math.round((musicVol + dir*0.1)*10)/10, 0, 1);
          else            sfxVol  = clamp(Math.round((sfxVol  + dir*0.1)*10)/10, 0, 1);
          applyVolumes(); saveSettings(); SFX.pickup();
        }
      } else Game.adjT = 0;
      if (pressed.start) {
        if (sel === 2) { musicOn = !musicOn; Music.setEnabled(musicOn); saveSettings(); SFX.select(); }
        else if (sel === 3) { Game.state = Game.settingsReturn || 'title'; SFX.select(); }
        else SFX.select();
      }
      if (pressed.pause || pressed.options) { Game.state = Game.settingsReturn || 'title'; SFX.select(); }
      break;
    }
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
      if (pressed.options) { Game.settingsReturn = 'pause'; Game.setSel = 0; Game.state = 'settings'; SFX.select(); break; }
      if (pressed.quit) { Game.state = 'title'; Game.timer = 0; Game.menuSel = 0; saveHigh(); setAudioActive(true); SFX.select(); break; }
      if (pressed.pause || pressed.start) { Game.state = 'play'; setAudioActive(true); SFX.select(); }
      // P/ESC resume; Q quits to title
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
        const m = Game.map, f = m.forts[Game.levelIndex];
        m.done[Game.levelIndex] = true;
        const ratio = Game.gemsTotal > 0 ? Game.gems / Game.gemsTotal : 1;          // grade: 3=perfect,2=>=60%,1=clear
        const grade = Game.perfect ? 3 : ratio >= 0.6 ? 2 : 1;
        m.grades[Game.levelIndex] = Math.max(m.grades[Game.levelIndex] || 0, grade);
        if (f && !f.secret) m.maxUnlocked = Math.max(m.maxUnlocked, f.order + 1);  // unlock next main fort
        saveHigh(); saveProgress();
        const won = m.forts.filter(x => x && !x.secret).every(x => m.done[x.li]);   // secrets are optional
        if (won) { Game.state = 'victory'; Game.timer = 0; }
        else { placeHeroOnNode(Game.levelIndex); Game.state = 'worldmap'; }          // back to the fort just cleared
      }
      break;
    case 'gameover':
      Game.timer += dt;
      if (pressed.start && Game.timer > 0.5) { Game.state = 'title'; Game.timer = 0; Game.menuSel = 0; }  // guard a stray entry-frame press
      break;
    case 'victory':
      Game.timer += dt;
      if (Math.random() < dt * 24) Game.particles.push({ x:Math.random()*W, y:-2, vx:(Math.random()*2-1)*20, vy:40+Math.random()*40, life:3, color:[EGA.yellow,EGA.bred,EGA.bcyan,EGA.bgreen][Math.random()*4|0], size:2, grav:30 });
      updateParticles(dt);   // fixed-step, refresh-rate independent
      if (pressed.start && Game.timer > 0.5) { Game.state = 'credits'; Game.timer = 0; Game.particles = []; }
      break;
    case 'credits':
      Game.timer += dt;
      if (pressed.start && Game.timer > 1) { Game.state = 'title'; Game.timer = 0; Game.menuSel = 0; }
      break;
  }
  // global audio controls (apply in every state, once per press)
  if (pressed.music) { musicOn = !musicOn; Music.setEnabled(musicOn); }
  if (pressed.mute)  { muted = !muted; applyMute(); }
  clearPressed();
}

function render() {
  updateTouchVisibility();
  bx.save();
  // screen shake
  if (Game.shake > 0 && (Game.state==='play'||Game.state==='dead')) {
    bx.translate((Math.random()*2-1)*Game.shake, (Math.random()*2-1)*Game.shake);
  }
  switch (Game.state) {
    case 'title': drawTitle(); break;
    case 'intro': drawIntro(); break;
    case 'settings': drawSettings(); break;
    case 'credits': drawCredits(); break;
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
  if (!(dt > 0)) dt = STEP;           // guard NaN / zero / negative timestamps
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
  loadProgress();
  loadSettings();
  Game.levels = buildLevels();
  validateLevels();
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
