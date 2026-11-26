'use strict';
// Regression tests for persistent target lock, homing missiles, stationary
// laser hits, the missile HUD counter and the TAB > Controls panel.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ORDER = [
  'lib/three.min.js',
  'js/audio.js',
  'js/player.js',
  'js/space3d.js',
  'js/planet2d.js',
  'js/game.js'
];

function makeEl(){
  const el = { id: '', style: {}, children: [], textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, cb){ if(type === 'click') this._click = cb; },
    remove(){},
    click(){ if(this._click) this._click(); },
    getContext(){ return null; } };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get(){ return html; },
    set(v){ html = v == null ? '' : String(v); el.children = []; }
  });
  return el;
}

function makeContext(seedSave){
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const data = new Map();
  if(seedSave) data.set('galaxy-one-save', JSON.stringify(seedSave));
  const localStorage = {
    data,
    getItem(k){ return data.has(k) ? data.get(k) : null; },
    setItem(k, v){ data.set(k, String(v)); },
    removeItem(k){ data.delete(k); }
  };
  const window = {
    localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener(){}, devicePixelRatio: 1
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame(){},
    setTimeout, clearTimeout, AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements, localStorage };
}

function v3(context, x, y, z){
  return vm.runInContext('new THREE.Vector3(' + (x || 0) + ',' + (y || 0) + ',' + (z || 0) + ')', context);
}

function collectText(node){
  const out = [node.innerHTML || node.textContent || ''];
  for(const c of (node.children || [])) out.push(...collectText(c));
  return out;
}

function collectButtons(node, out){
  if(!node) return out;
  for(const c of (node.children || [])){
    if(typeof c._click === 'function') out.push(c);
    collectButtons(c, out);
  }
  return out;
}

function findButton(node, label){
  return collectButtons(node, []).find(b => (b.textContent || '').indexOf(label) >= 0);
}

// Boots a real-enough spaceflight controller so update()/laser/missile loops
// run against the actual game code, not a reimplementation.
function bootSpace(windowObj, context){
  const S = windowObj.Space;
  const Game = windowObj.Game;
  const PD = windowObj.PD;

  S.active = true;
  S.ready = true;
  S.scene = vm.runInContext('new THREE.Scene()', context);
  S.ship = vm.runInContext('new THREE.Group()', context);
  S.hull = vm.runInContext('new THREE.Group()', context);
  S.ship.add(S.hull);
  S.camera = vm.runInContext('new THREE.PerspectiveCamera(68, 1280 / 720, 0.5, 12000)', context);
  S.vel = v3(context);
  S.warp = null; S.stats = { speed: 0, thrust: 0 };
  S.thrustS = 0; S.bank = 0; S.shake = 0; S.shieldDelay = 0;
  S.empCD = 0; S.empPulses = [];
  S.lasers = []; S.oreDrops = []; S.parts = []; S.pirates = []; S.asteroids = [];
  S.missiles3d = []; S.stations = []; S.planetMeshes = []; S.nebula = null;
  S.fireTimer = 0; S.wing = 0;
  S.lockT = 0; S.locked = false; S.lockedTarget = null; S.lockedId = null;
  S.lockCandidateId = null; S.hover = null; S.hoverId = null; S.lockNeed = 3;
  S.warpScanT = 0; S.warpScanId = null;
  S.warpTo = null; S.warpPrompt = ''; S.camPos = null;
  S.engine = { scale: { setScalar(){} } };
  S.flame = { scale: { set(){}, setScalar(){} }, material: { opacity: 0 } };
  S.plume = { scale: { set(){}, setScalar(){} }, material: { opacity: 0 } };
  S.shipLight = { intensity: 0 };
  S.pirateTimer = 9999;
  S._emitTrail = function(){};
  S._emitWarpStreaks = function(){};

  Game.state = 'space';
  Game.menuOpenNow = false;
  Game.els = {
    prompt: { style: {}, classList: { add(){}, remove(){} }, innerHTML: '', textContent: '' },
    toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null }
  };
  Game.uiToast = function(){};
  Game.onPirateKill = function(){};
  Game.onPirateDisable = function(){};
  Game.onSpaceDeath = function(){};
  Game.input = {
    keys: new Set(), pressedCodes: new Set(), mouseDown: false, mouseWorldX: 0, mouseWorldY: 0,
    pressed(c){ return this.pressedCodes.has(c); }
  };

  PD.hp = 5000;
  PD.alive = true;
  PD.missiles = 3;
  PD.installed = ['missiles'];
  PD.systemIdx = 0;

  return { window: windowObj, context, S, Game, PD };
}

function makePirate(context, S, x, y, z, hp){
  const grp = vm.runInContext('new THREE.Group()', context);
  grp.position.set(x || 0, y || 0, z || 0);
  const p = {
    mesh: grp,
    type: Object.assign({}, S.PIRATE_TYPES[0], { dmg: 0, fire: [9999, 9999] }),
    id: 'pirate-test-' + Math.random(),
    missionId: null,
    hp: hp == null ? 1000 : hp,
    fireT: 9999,
    disabledT: 0,
    vel: v3(context),
    bank: 0,
    seed: 0
  };
  S.pirates.push(p);
  S.scene.add(grp);
  return p;
}

test('persistent lock: moving the reticle away or turning does not release the target', () => {
  const { window } = makeContext();
  const S = window.Space;
  const P = window.PD;
  P.up.scanner = 1; // 3s lock time
  S.pirates = [];
  S.lockedTarget = null; S.locked = false; S.lockedId = null;
  S.lockCandidateId = null; S.lockT = 0;
  const p = { mesh: {}, hp: 40, type: { name: 'VOID RAIDER' } };
  S.pirates.push(p);

  let targets = [{ id: 'p0', entity: p, x: 0.5, y: 0.5, dist: 100, size: 20, type: 'pirate' }];
  S.getScreenTargets = () => targets;

  for(let i = 0; i < 40; i++) S._updateLock(0.1);
  assert.equal(S.lockedTarget, p, 'lock acquired after the scanner lock time');
  assert.equal(S.locked, true);

  // Player turns away / reticle leaves the target entirely.
  targets = [];
  S._updateLock(0.1);
  assert.equal(S.lockedTarget, p, 'lock survives an empty reticle');
  assert.equal(S.locked, true, 'lock state remains active');

  // Aiming at an unrelated asteroid must not drop the pirate lock either.
  targets = [{ id: 'a0', x: 0.5, y: 0.5, dist: 40, size: 30, type: 'ore' }];
  S._updateLock(0.1);
  assert.equal(S.lockedTarget, p, 'lock survives hovering a non-target object');

  // Destroyed/removed targets are the legitimate release condition.
  S.pirates.length = 0;
  S._updateLock(0.1);
  assert.equal(S.lockedTarget, null, 'lock clears when the target is removed');
  assert.equal(S.locked, false);
});

test('persistent lock: holding a different pirate long enough intentionally retargets', () => {
  const { window } = makeContext();
  const S = window.Space;
  const P = window.PD;
  P.up.scanner = 5; // 0.5s lock time
  S.pirates = [];
  const a = { mesh: {}, hp: 40, type: { name: 'A' } };
  const b = { mesh: {}, hp: 40, type: { name: 'B' } };
  S.pirates.push(a, b);
  S.lockedTarget = a; S.locked = true; S.lockedId = 'p0'; S.lockT = 0; S.lockCandidateId = null;

  let targets = [{ id: 'p1', entity: b, x: 0.5, y: 0.5, dist: 100, size: 20, type: 'pirate' }];
  S.getScreenTargets = () => targets;
  S._updateLock(0.2);
  assert.equal(S.lockedTarget, a, 'short retarget hover keeps the original lock');
  for(let i = 0; i < 4; i++) S._updateLock(0.2);
  assert.equal(S.lockedTarget, b, 'intentional held retarget switches the lock');
});

test('lasers damage and destroy a target while stationary and while moving', () => {
  for(const moving of [false, true]){
    const { window, context } = makeContext();
    const t = bootSpace(window, context);
    const { S, Game, PD } = t;
    S._updateLock = function(){}; // deterministic: target stays on the crosshair

    // Put the target exactly on the camera crosshair ray.
    S.camera.position.set(0, 3.2, 11);
    S.camera.lookAt(v3(context, 0, 0, -30));
    S.camera.updateMatrixWorld(true);
    const dir = v3(context, 0, 0, 0.5).unproject(S.camera).sub(S.camera.position).normalize();
    const targetPos = S.camera.position.clone().addScaledVector(dir, 111);
    const p = makePirate(context, S, targetPos.x, targetPos.y, targetPos.z, 1000);
    S.hover = { id: 'p0', entity: p, type: 'pirate', dist: 100, size: 20 };
    S.lockedTarget = p; S.locked = true;
    S.ship.position.set(0, 0, 0);
    S.vel.set(0, 0, moving ? -PD.maxSpeed() / 3 : 0);
    S.thrustS = moving ? 0.33 : 0;
    S.fireTimer = 0;

    Game.input.keys.clear();
    Game.input.keys.add('Space');
    for(let i = 0; i < 180; i++) S.update(1 / 60);

    assert.ok(p.hp < 1000, (moving ? 'moving' : 'stationary') + ' lasers must damage the target (hp ' + p.hp + ')');
    assert.ok(p.hp <= 1000 - 20, (moving ? 'moving' : 'stationary') + ' target takes multiple hits, not a single grazing shot');

    // Finish it off: laser damage must also destroy a stationary target.
    if(!moving){
      p.hp = 1;
      for(let i = 0; i < 90 && S.pirates.includes(p); i++) S.update(1 / 60);
      assert.equal(S.pirates.includes(p), false, 'stationary lasers destroy the target');
    }
  }
});

test('homing missile keeps tracking its launch target after the player turns away', () => {
  const { window, context } = makeContext();
  const t = bootSpace(window, context);
  const { S, Game, PD } = t;
  S._updateLock = function(){};

  const p = makePirate(context, S, 0, 0, -320, 1000);
  S.ship.position.set(0, 0, 0);
  S.vel.set(0, 0, 0); S.thrustS = 0;
  S.lockedTarget = p; S.locked = true;
  S._launchMissile(p);
  assert.equal(S.missiles3d.length, 1, 'missile launched');
  assert.equal(S.missiles3d[0].target, p, 'missile stores the locked entity');

  // Player immediately turns around and selects nothing: guidance must be independent.
  S.ship.quaternion.setFromAxisAngle(v3(context, 0, 1, 0), Math.PI);
  S.lockedTarget = null; S.locked = false; S.hover = null;
  Game.input.keys.clear();
  for(let i = 0; i < 240; i++) S.update(1 / 60);

  assert.ok(p.hp < 1000, 'missile guided into the original target despite the turn (hp ' + p.hp + ')');
  assert.equal(S.missiles3d.length, 0, 'missile was consumed on impact/expiry');
});

test('missiles survive a destroyed reference and fly on without guidance', () => {
  const { window, context } = makeContext();
  const t = bootSpace(window, context);
  const { S, Game } = t;
  S._updateLock = function(){};
  const p = makePirate(context, S, 0, 0, -320, 1000);
  S._launchMissile(p);
  assert.equal(S.missiles3d.length, 1);
  // Target disappears between frames (destroyed elsewhere / left the encounter).
  S.pirates.length = 0;
  Game.input.keys.clear();
  for(let i = 0; i < 30; i++) S.update(1 / 60);
  assert.ok(S.missiles3d.length <= 1, 'invalid target reference is handled without throwing');
});

test('missile HUD shows remaining ammo, zero, and hides without the module', () => {
  const { window, document } = makeContext();
  const Game = window.Game;
  const PD = window.PD;
  Game.state = 'space';
  Game.els = {
    prompt: document.getElementById('hud-prompt'),
    toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null }
  };
  Game.menuOpenNow = false;
  window.Space.warp = null;
  window.Space.warpPrompt = '';

  PD.installed = ['missiles'];
  PD.missiles = 3;
  Game._renderHudDom();
  const label = document.getElementById('msl-label');
  const txt = document.getElementById('msl-txt');
  assert.equal(txt.textContent, '×3', 'HUD shows remaining missiles');
  assert.notEqual(label.style.display, 'none', 'missile row visible with module installed in space');

  PD.missiles = 0;
  Game._renderHudDom();
  assert.equal(txt.textContent, '×0', 'HUD shows zero when depleted');

  PD.missiles = 2;
  PD.installed = [];
  Game._renderHudDom();
  assert.equal(label.style.display, 'none', 'missile row hidden without the Homing Missile System');
  assert.equal(txt.textContent, '', 'no stale missile count without the module');

  PD.installed = ['missiles'];
  PD.missiles = 2;
  Game.state = 'planet';
  Game._renderHudDom();
  assert.equal(label.style.display, 'none', 'missile row hidden on planetary surfaces');
});

test('TAB galaxy map exposes a Controls panel with actual bindings and a Back button', () => {
  const { window } = makeContext();
  const Game = window.Game;
  const PD = window.PD;
  PD.systemIdx = 0;
  const menu = makeEl();
  Game.els = { menuInner: menu, toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  window.Space.pirates = [];
  window.Space.ship = { position: { x: 0, y: 0, z: 0 } };
  window.Space.stations = [];
  window.Space.planetMeshes = [];

  Game._renderGalaxy();
  let text = collectText(menu).join('\n');
  assert.match(text, /GALAXY MAP/);
  assert.match(text, /CONTROLS/);
  const controlsBtn = findButton(menu, 'CONTROLS');
  assert.ok(controlsBtn, 'TAB map has a Controls button');
  controlsBtn.click();

  text = collectText(menu).join('\n');
  assert.match(text, /SPACE FLIGHT & NAVIGATION/);
  assert.match(text, /WEAPONS & COMBAT/);
  assert.match(text, /PLANETARY MOVEMENT & COMBAT/);
  assert.match(text, /INTERACTION & MINING/);
  assert.match(text, /MENUS & GENERAL/);
  assert.match(text, /EQUIPMENT-DEPENDENT CONTROLS/);
  assert.match(text, /fire ship lasers/);
  assert.match(text, /Homing Missile System/);
  assert.match(text, /EMP Emitter/);
  assert.match(text, /BACK TO GALAXY MAP/);

  const back = findButton(menu, 'BACK TO GALAXY MAP');
  assert.ok(back, 'Controls panel has a Back button');
  back.click();
  assert.match(collectText(menu).join('\n'), /GALAXY MAP/, 'Back returns to the TAB menu');
});

test('equipment descriptions carry the real activation keys', () => {
  const { window } = makeContext();
  const Game = window.Game;
  const PD = window.PD;
  PD.credits = 1000;
  PD.marketStock['station'] = { energyCells: 1, missiles: 1, weapons: { laserpistol: 1, assaultrifle: 1 } };
  const menu = makeEl();
  Game.els = { menuInner: menu, toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderEquipment(menu);
  const text = collectText(menu).join('\n');
  assert.match(text, /\[SPACE\] fire/, 'planetary weapons show the fire key');
  assert.match(text, /\[H\]/, 'medkit shows its use key');
  assert.match(text, /\[G\] homing missile ammunition/, 'missiles show the launch key');
  assert.match(text, /EMP Emitter[\s\S]*\[F\]|\[F\][\s\S]*EMP Emitter/, 'EMP module shows its activation key');
  assert.match(text, /Homing Missile System[\s\S]*\[G\]|\[G\][\s\S]*Homing Missile System/, 'missile module shows its launch key');
});

test('source: missiles use G and EMP keeps F; controls references exist', () => {
  const spaceSrc = fs.readFileSync(path.join(ROOT, 'js/space3d.js'), 'utf8');
  const gameSrc = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'js/player.js'), 'utf8');
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(spaceSrc, /inp\.pressed\('KeyG'\) && PD\.hasModule\('missiles'\)/,
    'Homing Missile System launches with G');
  assert.match(spaceSrc, /inp\.pressed\('KeyF'\) && PD\.hasModule\('emp'\)/,
    'EMP Emitter keeps F');
  assert.match(spaceSrc, /inp\.pressed\('KeyQ'\) && this\.warpTo/,
    'quick travel uses the scanned travel target independently of a held pirate lock');
  assert.doesNotMatch(spaceSrc, /inp\.pressed\('KeyF'\) && PD\.hasModule\('missiles'\)/,
    'missiles must not share F with EMP');
  assert.match(playerSrc, /Homing Missile System', desc: 'missile fire \[G\]/,
    'module description advertises [G]');
  assert.match(playerSrc, /EMP Emitter',\s+desc: 'non-lethal pirate disable \[F\]'/,
    'EMP description advertises [F]');
  assert.match(gameSrc, /_renderControls\(\)\{/, 'Controls panel renderer exists');
  assert.match(idxSrc, /TAB<\/b><span>galaxy map · controls<\/span>/, 'start screen points at TAB > Controls');
});
