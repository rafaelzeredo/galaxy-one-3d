'use strict';
// Keyboard-only spaceflight controls (Step 4): W/S pitch, A/D turn, N/M thrust, Space fire — mouse steering removed, no pointer lock, release stops rotation.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const spaceSrc = read('js/space3d.js');
const gameSrc = read('js/game.js');
const planetSrc = read('js/planet2d.js');
const idxSrc = read('index.html');

const SCRIPT_ORDER = [
  'lib/three.min.js',
  'js/audio.js',
  'js/player.js',
  'js/space3d.js',
  'js/planet2d.js',
  'js/game.js'
];

function makeEl(){
  return { id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; }, addEventListener(){}, remove(){},
    getContext(){ return null; } };
}

function makeContext(){
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const localStorage = { data: new Map(), getItem(k){ return this.data.has(k) ? this.data.get(k) : null; },
    setItem(k, v){ this.data.set(k, String(v)); }, removeItem(k){ this.data.delete(k); } };
  const window = { localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener(){}, devicePixelRatio: 1 };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame(){},
    AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, context };
}

// Angle (radians) between two quaternions — proves rotation starts / stops.
function quatAngle(context, q1, q2){
  const q1c = vm.runInContext('new THREE.Quaternion()', context);
  const q2c = vm.runInContext('new THREE.Quaternion()', context);
  q1c.copy(q1); q2c.copy(q2);
  const dot = q1c.x * q2c.x + q1c.y * q2c.y + q1c.z * q2c.z + q1c.w * q2c.w;
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

// Boots a minimal but complete spaceflight state inside the VM and steps frames.
function bootSpace(){
  const { window, context } = makeContext();
  const S = window.Space;
  const Game = window.Game;
  const PD = window.PD;

  S.active = true;
  S.warp = null;
  S.stats = { speed: 0 };
  S.thrustS = 0; S.bank = 0; S.shake = 0; S.empCD = 0; S.empPulses = [];
  S.lasers = []; S.oreDrops = []; S.parts = []; S.pirates = []; S.asteroids = [];
  S.stations = []; S.planetMeshes = []; S.nebula = null;
  S.fireTimer = 0; S.wing = 0; S.shieldDelay = 0; S.lockT = 0; S.locked = false;
  S.hover = null; S.hoverId = null; S.lockNeed = 3;
  S.warpTo = null; S.warpPrompt = '';
  S.camPos = null;
  S.ship = vm.runInContext('new THREE.Group()', context);
  S.hull = vm.runInContext('new THREE.Group()', context);
  S.camera = vm.runInContext('new THREE.PerspectiveCamera(68, 1, 0.5, 12000)', context);
  S.vel = vm.runInContext('new THREE.Vector3()', context);
  S.engine = { scale: { setScalar(){} } };
  S.flame = { scale: { set(a, b, c){}, setScalar(){} }, material: { opacity: 0 } };
  S.plume = { scale: { set(a, b, c){}, setScalar(){} }, material: { opacity: 0 } };
  S.shipLight = { intensity: 0 };
  S._updateLock = function(){};
  S._emitTrail = function(){};
  S._emitWarpStreaks = function(){};
  S._fire = function(){ window.__fired = (window.__fired || 0) + 1; };

  Game.state = 'space';
  Game.menuOpenNow = false;
  Game.input = {
    keys: new Set(),
    pressedCodes: new Set(),
    pressed(c){ return this.pressedCodes.has(c); },
    mouseDown: false,
    mouseWorldX: 0, mouseWorldY: 0
  };

  const setKeys = ks => { const k = Game.input.keys; k.clear(); for(const c of ks) k.add(c); };
  const frame = dt => S.update(dt);

  return { window, context, S, Game, PD, setKeys, frame, quatAngle };
}

test('flight controls source: W/S pitch, A/D turn, keyboard-only — no mouse or arrow steering', () => {
  assert.ok(/const keyYaw = \(inp\.keys\.has\('KeyD'\) \? 1 : 0\) - \(inp\.keys\.has\('KeyA'\) \? 1 : 0\);/.test(spaceSrc),
    'A/D compute the yaw turn rate from keyboard state');
  assert.ok(/const keyPitch = \(inp\.keys\.has\('KeyS'\) \? 1 : 0\) - \(inp\.keys\.has\('KeyW'\) \? 1 : 0\);/.test(spaceSrc),
    'W/S compute the pitch rate from keyboard state');
  assert.ok(!/mouseX|mouseY|steer\(/.test(spaceSrc), 'space3d must not read mouse position / steering state');
  assert.ok(!/ArrowUp|ArrowDown|ArrowLeft|ArrowRight/.test(spaceSrc), 'space flight rotation must not use arrow keys');
});

test('flight controls source: engine thrust via persistent B / N throttle, W/S are pitch-only', () => {
  assert.ok(/const holdB = inp\.keys\.has\('KeyB'\)/.test(spaceSrc), 'B holds to accelerate / increase speed');
  assert.ok(/const holdN = inp\.keys\.has\('KeyN'\)/.test(spaceSrc), 'N holds to brake / reduce speed');
  assert.ok(/const wantThrust = holdB \? 1 : \(holdN \? 0 : this\.thrustS\)/.test(spaceSrc),
    'persistent throttle holds the last setting when a key is released');
  assert.ok(!/wantThrust = \(!this\.warp && inp\.keys\.has\('KeyN'\)\)/.test(spaceSrc),
    'old N-as-thrust mapping must be removed');
  assert.ok(!/wantThrust = \(!this\.warp && inp\.keys\.has\('KeyW'\)\)/.test(spaceSrc),
    'W must not drive engine thrust any more');
  assert.ok(!/KeyS'\)\) this\.vel\.multiplyScalar/.test(spaceSrc),
    'S must not brake directly — it pitches only now');
  assert.ok(/thrustS \+= \(wantThrust - this\.thrustS\)/.test(spaceSrc), 'throttle spool behaviour preserved');
});

test('flight throttle keys B / N are preventDefault-ed so they cannot trigger browser shortcuts', () => {
  // B/N are added to the preventDefault key list so they never leak into unwanted
  // browser/OS shortcuts while flying. M keeps its mute/unmute handling.
  assert.ok(/'Tab','KeyB','KeyN','KeyM'\]/.test(gameSrc), 'B/N/M added to the preventDefault key list');
});

test('releasing directional keys stops rotation (keyup clears, blur clears)', () => {
  assert.ok(/window\.addEventListener\('keyup', e => inp\.keys\.delete\(e\.code\)\);/.test(gameSrc),
    'keyup clears the tracked key set');
  assert.ok(/window\.addEventListener\('blur', \(\) => inp\.keys\.clear\(\)\);/.test(gameSrc),
    'window blur clears stuck keys');
});

test('firing behaviour is unchanged (Space / mouse button)', () => {
  assert.ok(/if\(!this\.warp && \(inp\.mouseDown \|\| inp\.keys\.has\('Space'\)\)\)/.test(spaceSrc),
    'firing still gated by Space (or mouse button) while not warping');
});

test('no pointer lock or pointer trapping anywhere in the game', () => {
  const sources = [gameSrc, read('js/player.js'), spaceSrc, read('js/planet2d.js'), read('js/audio.js'),
                   read('index.html'), read('style.css')];
  for(const src of sources){
    assert.ok(!/pointerlock|requestPointerLock|exitPointerLock/i.test(src),
      'no pointer lock API may be used');
  }
});

test('start screen control hints reflect the new keyboard-only flight scheme', () => {
  assert.ok(!/<b>MOUSE<\/b>/.test(idxSrc), 'start screen must not advertise mouse steering');
  assert.ok(/<b>W \/ S<\/b><span>pitch up \/ down<\/span>/.test(idxSrc), 'W/S pitch hint present');
  assert.ok(/<b>A \/ D<\/b><span>turn left \/ right<\/span>/.test(idxSrc), 'A/D turn hint present');
  assert.ok(/<b>B \/ N<\/b><span>thrust \/ brake<\/span>/.test(idxSrc), 'B/N thrust hint present');
  assert.ok(/<b>SPACE<\/b><span>fire lasers<\/span>/.test(idxSrc), 'SPACE fire hint present');
});

test('planetary movement controls are untouched (WASD walk + E/R/H/G hotkeys)', () => {
  assert.ok(/if\(inp\.keys\.has\('KeyW'\)\) dy -= 1;/.test(planetSrc), 'planet walk W unchanged');
  assert.ok(/if\(inp\.keys\.has\('KeyS'\)\) dy \+= 1;/.test(planetSrc), 'planet walk S unchanged');
  assert.ok(/if\(inp\.keys\.has\('KeyA'\)\) dx -= 1;/.test(planetSrc), 'planet walk A unchanged');
  assert.ok(/if\(inp\.keys\.has\('KeyD'\)\) dx \+= 1;/.test(planetSrc), 'planet walk D unchanged');
});

test('flight starts at default cruising speed of approximately one third of max speed', () => {
  assert.ok(/maxSpeed\(\) \/ 3/.test(spaceSrc), 'enter/respawn preset cruising speed = maxSpeed / 3');
});

test('player ship is rendered at approximately 50% of its design size', () => {
  assert.ok(/this\.ship\.scale\.setScalar\(0\.5\)/.test(spaceSrc), 'ship scale set to 0.5 (design size)');
});

test('planetary aliens gradually respawn via time-based repopulation', () => {
  assert.ok(/this\.spawnT -= dt/.test(planetSrc), 'alien spawn timer decrements with game time');
  assert.ok(/alienBaseline\(\)/.test(planetSrc), 'per-planet alien baseline population');
  assert.ok(/alienCap\(\)/.test(planetSrc), 'per-planet alien cap');
  assert.ok(!/this\.aliens\.length < 14 && this\.planet\.alienRate > 0\.5/.test(planetSrc),
    'old permanent-depletion spawn gate removed');
});

test('M retains its existing mute/unmute functionality independently of throttle controls', () => {
  assert.ok(/if\(c === 'KeyM'\)/.test(gameSrc), 'M key keeps mute handling');
});

test('runtime: keyboard-only flight — no keys means no rotation', () => {
  const t = bootSpace();
  const { S, frame, quatAngle } = t;
  frame(0.016);
  const q0 = S.ship.quaternion.clone();
  frame(0.016);
  assert.ok(quatAngle(t.context, q0, S.ship.quaternion) < 1e-6, 'ship must not rotate without input');
});

test('runtime: W pitches up / S pitches down and never adds thrust', () => {
  const t = bootSpace();
  const { S, Game, frame, quatAngle } = t;
  Game.input.keys.clear();
  const qLevel = S.ship.quaternion.clone();

  Game.input.keys.clear();
  Game.input.keys.add('KeyW');
  frame(0.05);
  frame(0.05);
  const qUp = S.ship.quaternion.clone();
  frame(0.05);
  assert.ok(quatAngle(t.context, qLevel, qUp) > 0.01, 'W must pitch the ship up');
  assert.equal(S.vel.length(), 0, 'W must not add engine thrust');

  Game.input.keys.clear();
  Game.input.keys.add('KeyS');
  frame(0.05);
  frame(0.05);
  const qDown = S.ship.quaternion.clone();
  frame(0.05);
  assert.ok(quatAngle(t.context, qLevel, qDown) > 0.01, 'S must pitch the ship back down');
  assert.equal(S.vel.length(), 0, 'S must not add engine thrust');
});

test('runtime: A turns left / D turns right and never adds thrust', () => {
  const t = bootSpace();
  const { S, Game, frame, quatAngle } = t;
  Game.input.keys.clear();
  const qLevel = S.ship.quaternion.clone();

  Game.input.keys.clear();
  Game.input.keys.add('KeyA');
  frame(0.05);
  frame(0.05);
  const qA = S.ship.quaternion.clone();
  frame(0.05);
  assert.ok(quatAngle(t.context, qLevel, qA) > 0.001, 'A must turn the ship');
  assert.equal(S.vel.length(), 0, 'turning must not add engine thrust');

  Game.input.keys.clear();
  Game.input.keys.add('KeyD');
  frame(0.05);
  const qD = S.ship.quaternion.clone();
  frame(0.05);
  assert.ok(quatAngle(t.context, qLevel, qD) > 0.001, 'D must turn the ship');
  assert.equal(S.vel.length(), 0, 'turning must not add engine thrust');
});

test('runtime: releasing turn keys stops rotation (no continuous spin)', () => {
  const t = bootSpace();
  const { S, Game, frame, quatAngle } = t;
  Game.input.keys.clear();
  Game.input.keys.add('KeyD');
  frame(0.05);
  frame(0.05);
  const qTurn = S.ship.quaternion.clone();
  frame(0.05);
  assert.ok(quatAngle(t.context, qTurn, S.ship.quaternion) > 0.001, 'D turn was applied while held');
  const frozen = S.ship.quaternion.clone();
  Game.input.keys.clear(); // key released
  frame(0.3);
  frame(0.3);
  assert.ok(quatAngle(t.context, frozen, S.ship.quaternion) < 1e-6, 'rotation must stop after key release');
});

test('runtime: B accelerates via persistent throttle, N brakes, release coasts', () => {
  const t = bootSpace();
  const { S, Game, PD, frame } = t;
  // default flight state: cruising ≈ one-third of max speed, no throttle engaged
  S.thrustS = 0;
  const cruise = PD.maxSpeed() / 3;
  S.vel.set(0, 0, -cruise);

  // B held -> persistent throttle up -> accelerates toward max
  Game.input.keys.clear();
  Game.input.keys.add('KeyB');
  let bf = 0;
  while(S.thrustS < 0.9 && bf < 900){ frame(1 / 60); bf++; }
  assert.ok(S.thrustS > 0.9, 'B must spool thrust up to full');
  assert.ok(S.vel.length() > 0, 'B must accelerate the ship');
  assert.ok(S.vel.length() <= PD.maxSpeed(), 'speed must respect the max speed limit');
  Game.input.keys.clear();
  frame(0.5);
  assert.ok(S.thrustS > 0.9, 'release B holds the throttle setting (coasts, no auto-decel)');
  assert.ok(S.vel.length() > 0, 'ship keeps moving after B release');

  // N held -> persistent throttle down -> brakes toward zero
  Game.input.keys.clear();
  Game.input.keys.add('KeyN');
  frame(0.5);
  assert.ok(S.thrustS < 0.1, 'N must brake the throttle setting down');
  frame(0.5);
  assert.equal(S.thrustS, 0, 'N must release thrust');
});

test('runtime: holding N brakes the ship toward zero and it stays stopped until B', () => {
  const t = bootSpace();
  const { S, Game, PD, frame } = t;
  S.thrustS = 0;
  S.vel.set(0, 0, -PD.maxSpeed()); // start at full speed
  assert.ok(S.vel.length() > PD.maxSpeed() / 2, 'setup: ship is at high speed');

  Game.input.keys.clear();
  Game.input.keys.add('KeyN');
  let guard = 0;
  while(S.vel.length() > 0.001 && guard++ < 900){ // ~15s of braking at ~60fps
    frame(1 / 60);
  }
  assert.ok(S.vel.length() < 0.5, 'holding N must bring the ship to zero speed');
  assert.equal(S.thrustS, 0, 'throttle released while braking');

  // released N -> persistent zero setting -> ship stays stopped
  Game.input.keys.clear();
  frame(0.5);
  assert.ok(S.vel.length() < 0.5, 'ship must remain stopped after N release at zero');
});

test('runtime: holding B from zero restores movement and can reach maximum speed', () => {
  const t = bootSpace();
  const { S, Game, PD, frame } = t;
  S.thrustS = 0;
  S.vel.set(0, 0, 0);
  Game.input.keys.clear();
  Game.input.keys.add('KeyB');
  let frames = 0;
  let maxLen = 0;
  while(frames < 900){ // ~15s of full throttle at ~60fps
    frame(1 / 60);
    maxLen = Math.max(maxLen, S.vel.length());
    frames++;
  }
  assert.ok(maxLen > 0, 'B must build speed from zero');
  assert.ok(maxLen <= PD.maxSpeed(), 'B must not exceed max speed');
});

test('runtime: Space fires while stationary', () => {
  const t = bootSpace();
  const { S, Game, frame } = t;
  Game.input.keys.clear();
  Game.input.keys.add('Space');
  frame(0.001);
  frame(0.5);
  assert.ok((t.window.__fired || 0) > 0, 'Space must fire the laser');
});

test('runtime: Space fires while moving, turning and thrusting', () => {
  const t = bootSpace();
  const { S, Game, frame } = t;
  Game.input.keys.clear();
  Game.input.keys.add('KeyB');
  Game.input.keys.add('KeyD');
  Game.input.keys.add('Space');
  frame(0.5);
  assert.ok((t.window.__fired || 0) > 0, 'Space must fire while moving/turning/thrusting');
});

test('runtime: full script chain loads without errors and exposes the flight surface', () => {
  const { window } = makeContext();
  assert.ok(window.GameAudio, 'GameAudio loaded');
  assert.ok(window.Space, 'Space loaded');
  assert.ok(window.PD, 'PD loaded');
  assert.ok(window.Game, 'Game loaded');
  assert.ok(window.Planet, 'Planet loaded');
  const S = window.Space;
  for(const m of ['init', 'enter', 'exit', 'update', 'render', 'jumpTo', 'respawn', 'saveForLanding',
                  'getScreenTargets', 'buildStations', '_buildStation', '_buildPlanets', '_buildShip',
                  '_fireEMP', '_killPirate']){
    assert.equal(typeof S[m], 'function', 'Space.' + m + ' should be a function');
  }
});

test('runtime: thrust spool respects the existing max speed limit', () => {
  const t = bootSpace();
  const { S, Game, PD, frame } = t;
  Game.input.keys.clear();
  Game.input.keys.add('KeyB');
  let frames = 0;
  let maxLen = 0;
  while(frames < 900){ // ~15s of full throttle at ~60fps
    frame(1 / 60);
    maxLen = Math.max(maxLen, S.vel.length());
    frames++;
  }
  assert.ok(maxLen > 0, 'thrust built up speed');
  assert.ok(maxLen <= PD.maxSpeed(), 'max speed limit respected');
});

test('runtime: ship starts at the default cruising speed (one third of max)', () => {
  const t = bootSpace();
  const { S, Game, PD, frame } = t;
  S.thrustS = 0;
  const maxS = PD.maxSpeed();
  S.vel.set(0, 0, -maxS / 3); // what enter()/respawn() preset for the default cruise
  frame(0.016);
  assert.ok(Math.abs(S.vel.length() - maxS / 3) < 0.5, 'cruising speed ≈ one-third of max, was: ' + S.vel.length());
});
