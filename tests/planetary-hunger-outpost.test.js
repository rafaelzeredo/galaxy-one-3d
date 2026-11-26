'use strict';
// Planetary hunger + Outpost construction regression tests, and homing-missile visual checks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ORDER = ['lib/three.min.js', 'js/audio.js', 'js/player.js', 'js/space3d.js', 'js/planet2d.js', 'js/game.js'];

function makeEl(){
  const el = { id: '', style: {}, children: [], textContent: '', value: '', disabled: false,
    classList: { add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, cb){ if(type === 'click') this._click = cb; if(type === 'mousedown') this._mdown = cb; },
    setAttribute(){}, removeAttribute(){},
    remove(){}, blur(){},
    click(){ const e = { preventDefault(){}, currentTarget: el }; if(this._click) this._click(e); },
    getContext(){ return null; } };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get(){ return html; },
    set(v){ html = v == null ? '' : String(v); el.children = []; }
  });
  return el;
}

function makeCanvas(){
  const noop = () => {};
  const ctx = { canvas: { width: 0, height: 0 }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    save: noop, restore: noop, translate: noop, drawImage: noop, fillRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    ellipse: noop, fill: noop, arc: noop, stroke: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, strokeRect: noop, setTransform: noop, rotate: noop, scale: noop };
  const c = { width: 2400, height: 2400, getContext(){ return ctx; }, style: {} };
  return c;
}

function makeCtx2D(){
  const noop = () => {};
  const grad = () => ({ addColorStop(){} });
  const ctx = { canvas: { width: 800, height: 600 }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    save: noop, restore: noop, translate: noop, drawImage: noop, fillRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    ellipse: noop, fill: noop, arc: noop, stroke: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, strokeRect: noop, setTransform: noop, rotate: noop, scale: noop, setLineDash: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    createRadialGradient: grad, createLinearGradient: grad, createPattern: () => ({}) };
  return ctx;
}

function makeContext(seedSave){
  const elements = {};
  const document = {
    createElement(tag){ if(tag === 'canvas') return makeCanvas(); return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const data = new Map();
  if(seedSave) data.set('galaxy-one-save', JSON.stringify(seedSave));
  const localStorage = {
    data, getItem(k){ return data.has(k) ? data.get(k) : null; },
    setItem(k, v){ data.set(k, String(v)); }, removeItem(k){ data.delete(k); }
  };
  const window = { localStorage, document, innerWidth: 1280, innerHeight: 720, __GALAXY_TEST__: true,
    addEventListener(){}, devicePixelRatio: 1 };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date, Number, String, Array, Object,
    isFinite, parseInt, parseFloat, performance: { now: () => Date.now() }, requestAnimationFrame(){},
    setTimeout, clearTimeout, AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements, localStorage };
}

test('planetary hunger drains gradually and food rations restore it', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.hunger = 100;
  PD.hungerDeplete(25);
  assert.equal(PD.hunger, 90, 'hunger drains gradually at the configured rate');

  PD.hunger = 50;
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 1 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  assert.equal(PD.consumeFood(), true, 'food ration is consumable');
  assert.equal(PD.hunger, 85, 'eating restores hunger');
  assert.equal(PD.cargo.food, 0, 'consumed ration decrements cargo');

  PD.hunger = 100;
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 2 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  assert.equal(PD.consumeFood(), false, 'eating at full hunger is refused');
  assert.equal(PD.hunger, 100, 'full hunger is not consumed');
});

test('critical hunger gradually bleeds player health while below the threshold', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.hunger = 10;
  PD.playerHp = 50;
  PD.alive = true;
  PD.applyCriticalHunger(1);
  assert.equal(PD.playerHp, 48, 'critical hunger drains health gradually');
  PD.hunger = 50;
  PD.playerHp = 50;
  PD.applyCriticalHunger(1);
  assert.equal(PD.playerHp, 50, 'critical hunger only applies below the threshold');
});

test('hunger HUD reads the persisted planetary hunger value', () => {
  const { window, document } = makeContext();
  const Game = window.Game;
  const PD = window.PD;
  Game.state = 'planet';
  Game.els = {
    prompt: { style: {}, classList: { add(){}, remove(){}, contains(){ return false; } } },
    toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null }
  };
  PD.hunger = 42;
  Game._renderHudDom();  const txt = document.getElementById('hunger-txt');
  const bar = document.getElementById('hunger-bar');
  assert.ok(txt.textContent.indexOf('HUNGER 42/100') >= 0, 'hunger HUD shows the value: ' + txt.textContent);
  assert.ok(Math.abs(parseFloat(bar.style.width) - 42) < 0.001, 'hunger HUD shows the bar width');
});

test('hunger and food persist through save/load and reset on a new game', () => {
  const first = makeContext();
  const PD = first.window.PD;
  PD.hunger = 33;
  PD.save();
  const raw = JSON.parse(first.localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.hunger, 33, 'hunger is persisted');

  const second = makeContext(raw);
  assert.equal(second.window.PD.hunger, 33, 'hunger restores across save/load');
  second.window.PD.newGame();
  assert.equal(second.window.PD.hunger, 100, 'new game resets hunger to full');
});

test('outpost construction consumes wood and iron only on success', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Planet = window.Planet;
  const Game = window.Game;
  Game.els = { toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  PD.cargo = { ore: 30, wood: 20, crystal: 0, goo: 0 };
  Planet.state = { outposts: [], trader: null, ship: null, trees: [], rocks: [], crystals: [], nestsR: [], nests: [] };
  Planet.player = { x: 100, y: 100, aim: 0 };
  Planet.interior = false;

  assert.equal(Planet.canConstructOutpost(), true, 'sufficient wood + iron allows construction');
  assert.equal(Planet.constructOutpost(), true, 'construction succeeds with required materials');
  assert.equal((Planet.state.outposts || []).length, 1, 'outpost is stored on the planetary surface state');
  assert.equal(PD.cargo.wood, 0, 'wood deducted after construction');
  assert.equal(PD.cargo.ore, 0, 'iron deducted after construction');

  PD.cargo = { ore: 30, wood: 19, crystal: 0, goo: 0 };
  Planet.state = { outposts: [], trader: null, ship: null, trees: [], rocks: [], crystals: [], nestsR: [], nests: [] };
  Planet.player = { x: 100, y: 100, aim: 0 };
  Planet.interior = false;
  assert.equal(Planet.constructOutpost(), false, 'construction refuses without enough wood');
  assert.equal((Planet.state.outposts || []).length, 0, 'failed construction stores no outpost');
});

test('outpost enter/exit and persistence transition work', () => {
  const { window } = makeContext();
  const Planet = window.Planet;
  const PD = window.PD;
  const Game = window.Game;
  Game.els = { toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game.state = 'planet';
  Game.input = { keys: new Set(), pressedCodes: new Set(), pressed(c){ return this.pressedCodes.has(c); }, mouseDown: false, mouseWorldX: 0, mouseWorldY: 0 };
  Planet.active = true;
  Planet.ctx = { canvas: { width: 800, height: 600 } };
  Planet.state = { outposts: [{ x: 100, y: 100, w: 44, h: 36, built: true }], trader: null, ship: null,
    trees: [], rocks: [], crystals: [], nestsR: [], aliens: [], bullets: [], fx: [] };
  Planet.player = { x: 100, y: 100, aim: 0 };
  Planet.interior = true;
  Game.input.keys = new Set();
  Game.input.pressedCodes = new Set();
  Game.input.pressedCodes.add('KeyE');
  Planet.fx = [];
  Planet.aliens = [];
  Planet.bullets = [];
  Planet.fireFlash = 0;
  Planet.update(1 / 60);
  assert.equal(Planet.interior, false, 'E exits the outpost');

  Planet.state = { outposts: [], trader: null, ship: null, trees: [], rocks: [], crystals: [], nestsR: [], aliens: [], bullets: [], fx: [] };
  Planet.player = { x: 100, y: 100, aim: 0 };
  Planet.interior = false;
  PD.cargo = { ore: 30, wood: 20, crystal: 0, goo: 0 };
  Game.input.pressedCodes = new Set();
  Game.input.pressedCodes.add('KeyE');
  Planet.update(1 / 60);
  assert.equal(Planet.interior, true, 'E constructs and enters the outpost');
});

test('outpost persists through save/load and clears with a new game surface state', () => {
  const first = makeContext();
  const PD = first.window.PD;
  const Planet = first.window.Planet;
  PD.surfaceStates = { [PD.planetIndex]: { outposts: [{ x: 120, y: 140, w: 44, h: 36, built: true }], interior: false } };
  PD.save();
  const raw = JSON.parse(first.localStorage.getItem('galaxy-one-save'));

  const second = makeContext(raw);
  const P2 = second.window.PD;
  const Planet2 = second.window.Planet;
  assert.equal((P2.surfaceStates[P2.planetIndex].outposts || []).length, 1, 'outpost restores from saved surface state');
  P2.newGame();
  assert.deepEqual(P2.surfaceStates[P2.planetIndex] || {}, {}, 'new game clears the saved surface state');
});

test('homing missile visual upgrade keeps the physical body, fins, flame and trail', () => {
  const spaceSrc = fs.readFileSync(path.join(ROOT, 'js/space3d.js'), 'utf8');
  assert.match(spaceSrc, /new THREE\.ConeGeometry\(0\.55, 2\.2/, 'missile has a pointed elongated nose');
  assert.match(spaceSrc, /new THREE\.PlaneGeometry\(2\.3, 1\.7/, 'missile has rear fins');
  assert.match(spaceSrc, /missile-flame/, 'missile has a visible flame');
  assert.match(spaceSrc, /missile-trail/, 'missile has a trail');
});

test('EAT RATION HUD button consumes one food ration and restores hunger', () => {
  const { window, document } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const Planet = window.Planet;
  Game.state = 'planet';
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } } }
  };
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 1 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  PD.hunger = 10;
  Game._bindInput();
  const btn = document.getElementById('eat-rations');
  assert.ok(btn, 'EAT RATION button exists in the HUD');
  btn.disabled = false;
  assert.equal(btn.disabled, false, 'button is enabled while a food ration is available');
  assert.equal(Game.eatFood(), true, 'eating through the HUD action consumes a ration');
  assert.equal(PD.hunger, 45, 'eating restores hunger by the ration amount');
  assert.equal(PD.cargo.food, 0, 'consumed ration is removed from cargo');
  assert.equal(document.getElementById('food-count').textContent, '×0', 'HUD food count refreshes immediately');
});

test('EAT RATION HUD button refuses to eat without rations and disables itself', () => {
  const { window, document } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } } }
  };
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 0 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  PD.hunger = 10;
  Game._bindInput();
  const btn = document.getElementById('eat-rations');
  btn.disabled = false;
  assert.equal(Game.eatFood(), false, 'eating without rations is refused');
  assert.equal(btn.disabled, true, 'button is disabled when no rations remain');
  assert.equal(PD.hunger, 10, 'hunger is untouched when no rations are available');
});

test('food ration J keyboard shortcut still restores hunger', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const Planet = window.Planet;
  Game.state = 'planet';
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } } }
  };
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 1 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  PD.hunger = 10;
  Game._bindInput();
  Game.input.pressedCodes.add('KeyJ');
  Planet.active = true;
  Planet.ctx = makeCtx2D();
  Planet.state = { tex: makeCanvas(), trees: [], rocks: [], crystals: [], nests: [], nestsR: [], trader: null, ship: { x: 100, y: 200 }, stats: { wood: 0, ore: 0, crystal: 0, kills: 0 }, interior: false };
  Planet.player = { x: 100, y: 100, aim: 0 };
  Planet.interior = false;
  Planet.fx = [];
  Planet.aliens = [];
  Planet.bullets = [];
  Planet.fireFlash = 0;
  Planet.hitFlash = 0;
  Planet.update(1 / 60);
  assert.ok(Math.abs(PD.hunger - 45) < 0.01, 'J shortcut eats a ration and restores hunger');
});

test('death → Continue → descend to same planet rebuilds lost surface texture and renders without errors', () => {
  const { window, localStorage } = makeContext();
  const PD = window.PD;
  const Planet = window.Planet;
  const Game = window.Game;
  Game.state = 'planet';
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } } }
  };
  // In-session landed planet: surface state with a real canvas texture.
  PD.surfaceStates = { 2: { tex: makeCanvas(), trees: [], rocks: [], crystals: [], nests: [], nestsR: [], trader: null, ship: { x: 100, y: 200 }, stats: { wood: 0, ore: 0, crystal: 0, kills: 0 }, interior: false, outposts: [] } };
  Planet.active = true;
  Planet.ctx = makeCtx2D();
  Planet.enter(2);
  assert.ok(Planet.state.tex && Planet.state.tex.width, 'landed surface texture is a valid canvas');
  assert.equal(Planet.state.tex.width, 2400, 'surface texture canvas is WORLD-sized');

  // Death → save → Continue → reload → descend again onto the same planet.
  PD.save();
  const ctx2 = makeContext(JSON.parse(localStorage.getItem('galaxy-one-save')));
  const PD2 = ctx2.window.PD;
  const Planet2 = ctx2.window.Planet;
  const Game2 = ctx2.window.Game;
  Game2.state = 'planet';
  Game2.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } } }
  };
  Planet2.active = true;
  Planet2.ctx = makeCtx2D();
  Planet2.enter(2);
  assert.ok(Planet2.state.tex && Planet2.state.tex.width, 'restored surface texture rebuilt after save/load round-trip');
  assert.ok(Array.isArray(Planet2.state.outposts), 'outpost state survives death/continue round-trip');

  // Planetary rendering must run without errors on the restored state.
  Planet2.render();
});

test('planetary death -> Continue -> return to same planet -> descend renders without errors', () => {
  const { window, localStorage, document } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const Planet = window.Planet;

  // Minimal game DOM/hooks used by death flow.
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } }, style: {} },
    gameover: { classList: { _h: true, add(){ this._h = true; }, remove(){ this._h = false; }, contains(){ return this._h; } } },
    hud: { classList: { _h: false, add(){ this._h = true; }, remove(){ this._h = false; } } },
    cross: { classList: { _h: true, add(){ this._h = true; }, remove(){ this._h = false; } } },
    space: { classList: { _h: false, add(){ this._h = true; }, remove(){ this._h = false; } } },
  };
  Game._fade = (cb) => { if(cb) cb(); };
  Game._toSpace = function(fresh){ this.state = 'space'; if(window.Planet && window.Planet.active) window.Planet.exit(); };
  window.Space = window.Space || {};
  window.Space.exit = window.Space.exit || (() => {});
  window.Space.enter = window.Space.enter || (() => {});
  window.Space.syncWorld = window.Space.syncWorld || (() => {});
  window.Space.saveForLanding = window.Space.saveForLanding || (() => {});
  window.Space.ship = window.Space.ship || { position: { x:0,y:0,z:0 } };

  // Land on a planet and establish a valid in-session surface.
  PD.planetIndex = 2;
  PD.surfaceStates = {};
  Planet.active = true;
  Planet.ctx = makeCtx2D();
  Planet.enter(2);
  Game.state = 'planet';
  assert.ok(Planet.state.tex && Planet.state.tex.width, 'initial surface texture is valid');

  // Simulate planetary death.
  PD.playerHp = 0;
  PD.alive = false;
  Game.onPlanetDeath();
  assert.equal(Game.state, 'gameover', 'death transitions to gameover');
  assert.equal(PD.alive, true, 'death leaves a playable alive flag');
  assert.ok(PD.playerHp > 0, 'death checkpoint restores player HP');

  // Continue from game over.
  const btnContinue = document.getElementById('btn-gameover-continue');
  assert.ok(btnContinue && btnContinue.onclick, 'Continue button is wired');
  btnContinue.onclick();
  assert.equal(Game.state, 'space', 'Continue returns to space');
  assert.ok(PD.playerHp > 0, 'Continue restores playable HP');

  // Travel back to the same planet and descend.
  Planet.ctx = makeCtx2D();
  Planet.enter(2);
  Game.state = 'planet';
  assert.ok(PD.playerHp > 0, 'player is alive after descending again');
  assert.equal(PD.alive, true, 'alive flag is true after descending again');
  assert.ok(Planet.state && Planet.state.tex && Planet.state.tex.width, 'surface texture is valid after re-descent');

  // Render and update must not throw, and player must remain playable.
  Game.input = Game.input || { keys: new Set(), pressedCodes: new Set(), pressed(c){ return this.pressedCodes && this.pressedCodes.has(c); }, mouseDown: false, mouseWorldX:0, mouseWorldY:0 };
  Game.input.keys = new Set();
  Game.input.pressedCodes = new Set();
  Planet.render();
  Planet.update(1/60);
  assert.ok(PD.playerHp > 0, 'player survives first update after re-descent');
});

test('EAT RATION button click consumes ration via mouse interaction', () => {
  const { window, document } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); return t; }, remove(){}, firstChild: null, style: {} },
    prompt: { innerHTML: '', classList: { add(){}, remove(){}, contains(){ return false; } }, style: {} }
  };
  PD.cargo = { ore: 0, wood: 0, crystal: 0, goo: 0, food: 2 };
  PD.trade = { food: 0, tech: 0, med: 0, lux: 0 };
  PD.hunger = 40;
  Game._bindInput();
  Game._renderHudDom();
  const btn = document.getElementById('eat-rations');
  btn.click();
  assert.equal(PD.cargo.food, 1, 'mouse click consumes exactly one ration');
  assert.equal(PD.hunger, 75, 'mouse click restores hunger');
  assert.equal(document.getElementById('food-count').textContent, '×1', 'HUD count updates after click');
});
