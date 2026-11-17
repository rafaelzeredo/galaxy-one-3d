'use strict';
// Step 3D tests: UI refinements (repair confirmation, mouse cursor visibility)
// and enemy spaceship health through the existing scanner.
//
// Run with: npm test   (or: node --test)
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
  return {
    id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, cb){ if(type === 'click') this._click = cb; },
    remove(){},
    click(){ if(this._click) this._click(); },
    getContext(){ return null; }
  };
}

function makeContext(){
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const data = new Map();
  const localStorage = { data,
    getItem(k){ return data.has(k) ? data.get(k) : null; },
    setItem(k, v){ data.set(k, String(v)); },
    removeItem(k){ data.delete(k); } };
  const window = {
    localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener(){}, devicePixelRatio: 1
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame(){}, setTimeout, clearTimeout,
    AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements, localStorage };
}

function collectButtons(node, out){
  if(!node) return;
  for(const c of (node.children || [])){
    if(typeof c._click === 'function') out.push(c);
    collectButtons(c, out);
  }
  return out;
}

test('repair confirmation: no leftover empty button; CONFIRM restores hull, CANCEL cancels', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  PD.credits = 1000;
  PD.hp = 10; // damaged -> missingHull > 0 -> repair flow available
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); }, firstChild: null } };
  Game.menuTab = 'equipment';
  Game._pendingRepair = null;
  const origRenderStation = Game._renderStation;
  Game._renderStation = function(){ /* keep test focused on the repair flow */ };

  const render = () => {
    Game._pendingRepair = { cost: Math.ceil(Math.ceil(PD.hullMax() - PD.hp) * 2) };
    Game._renderEquipment(Game.els.menuInner);
  };

  // --- open repair confirmation ---
  render();
  let buttons = [];
  collectButtons(Game.els.menuInner, buttons);
  const texts = buttons.map(b => b.textContent);
  assert.ok(texts.includes('CONFIRM'), 'CONFIRM button rendered in repair confirmation');
  assert.ok(texts.includes('CANCEL'), 'CANCEL button rendered in repair confirmation');
  assert.ok(!texts.includes(''), 'no empty leftover action button in repair confirmation');

  // --- confirm: restores hull to max and clears pending state ---
  const confirmBtn = buttons.find(b => b.textContent === 'CONFIRM');
  confirmBtn._click();
  assert.equal(Game._pendingRepair, null, 'pending repair cleared after CONFIRM');
  assert.equal(PD.hp, PD.hullMax(), 'hull restored to max after CONFIRM');
  assert.equal(PD.credits, 1000 - Math.ceil(Math.ceil(PD.hullMax() - 10) * 2), 'credits deducted for repair');

  // --- cancel: pending state cleared, hull untouched ---
  PD.credits = 1000;
  PD.hp = 10;
  Game._pendingRepair = { cost: Math.ceil(Math.ceil(PD.hullMax() - PD.hp) * 2) };
  render();
  buttons = [];
  collectButtons(Game.els.menuInner, buttons);
  const cancelBtn = buttons.find(b => b.textContent === 'CANCEL');
  assert.ok(cancelBtn, 'CANCEL button rendered');
  cancelBtn._click();
  assert.equal(Game._pendingRepair, null, 'pending repair cleared after CANCEL');
  assert.equal(PD.hp, 10, 'hull NOT repaired when cancelled');
  assert.equal(PD.credits, 1000, 'credits NOT deducted when cancelled');

  Game._renderStation = origRenderStation;
});

test('mouse cursor: hidden over gameplay viewport elements, visible on start screen, no pointer lock', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const jsSrc = ['js/game.js', 'js/player.js', 'js/space3d.js', 'js/planet2d.js', 'js/audio.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for(const sel of ['#space3d', '#hud2d', '#hud', '#crosshair']){
    const re = new RegExp(sel.replace('#', '\\#') + '[^{]*\\{[^}]*cursor\\s*:\\s*none');
    assert.ok(re.test(css), 'game element ' + sel + ' hides the cursor during gameplay');
  }
  const menuRe = new RegExp('#menu\\{[^}]*cursor\\s*:\\s*none');
  assert.ok(menuRe.test(css), 'game menu hides the cursor during normal gameplay');
  const menuOpenRe = new RegExp('#menu\\.open\\{[^}]*cursor\\s*:\\s*(auto|default|visible|pointer)');
  assert.ok(menuOpenRe.test(css), 'interactive menu (#menu.open) shows the cursor across the game viewport');
  assert.ok(!/#screen-start[^{]*\{[^}]*cursor\s*:\s*none/.test(css), 'start screen keeps the default cursor');
  assert.ok(!/pointerlock|requestPointerLock|exitPointerLock/i.test(css + jsSrc + idx),
    'no pointer lock / pointer trapping introduced');
});

test('interactive menu open state toggles cursor visibility (Step 3E)', () => {
  const jsSrc = ['js/game.js', 'js/player.js', 'js/space3d.js', 'js/planet2d.js', 'js/audio.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(/classList\.add\('open'\)/.test(jsSrc), 'opening an interactive menu adds the #menu.open state');
  assert.ok(/classList\.remove\('open'\)/.test(jsSrc), 'closing an interactive menu removes the #menu.open state');
});

test('scanner: locked enemy shows hull health bar and numeric hull values', () => {
  const { window } = makeContext();
  const Game = window.Game;
  const S = window.Space;
  const gameJs = ['js/game.js', 'js/player.js', 'js/space3d.js', 'js/planet2d.js', 'js/audio.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(/HULL [^\n]*rgba\(255,95,122,0\.9\)/.test(gameJs), 'locked enemy hull health (bar + value) rendered in red (Step 3E)');
  assert.ok(!/HULL [^\n]*rgba\(95,240,255/.test(gameJs), 'locked enemy hull health no longer uses the light-blue HUD colour');
  Game.state = 'space';
  Game.menuOpenNow = false;
  Game.hudCtx = {
    canvas: { width: 800, height: 600 },
    clearRect(){}, fillRect(){}, strokeRect(){}, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', beginPath(){}, arc(){}, stroke(){}, fill(){}, moveTo(){}, lineTo(){},
    measureText(){ return { width: 30 }; }, fillText(t){ this._lastText = t; },
    save(){}, restore(){}
  };
  Game.els = { prompt: { classList: { add(){}, remove(){}, contains(){ return false; } } } };

  const texts = [];
  const ctxMock = {
    canvas: { width: 800, height: 600 },
    clearRect(){}, fillRect(){}, strokeRect(){}, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', beginPath(){}, arc(){}, stroke(){}, fill(){}, moveTo(){}, lineTo(){},
    measureText(){ return { width: 30 }; },
    fillText(t){ texts.push(String(t)); },
    save(){}, restore(){}
  };
  Game.hudCtx = ctxMock;

  S.warp = null;
  S.locked = true;
  S.lockT = 3;
  S.lockNeed = 3;
  S.hoverId = 'p0';
  S._targets = [];
  S.hover = { id: 'p0', x: 0.5, y: 0.5, type: 'pirate', name: 'VOID RAIDER', kind: 'HOSTILE', value: 'BOUNTY 10-40 CR', hp: 23, maxHp: 44, dist: 500, size: 12 };

  Game._renderHudCanvas();
  assert.ok(texts.some(t => t.includes('HULL 23 / 44')), 'locked enemy shows current hull (23 / 44): ' + texts.join(' | '));

  // damage the target -> values update without re-locking
  S.hover.hp = 8;
  S.hover.maxHp = 44;
  texts.length = 0;
  Game._renderHudCanvas();
  assert.ok(texts.some(t => t.includes('HULL 8 / 44')), 'hull values update as the enemy takes damage: ' + texts.join(' | '));

  // switching targets -> health belongs to the newly selected enemy
  S.hover = { id: 'p1', x: 0.4, y: 0.6, type: 'pirate', name: 'VOID STALKER', kind: 'HOSTILE', value: 'BOUNTY 5-20 CR', hp: 12, maxHp: 26, dist: 300, size: 10 };
  texts.length = 0;
  Game._renderHudCanvas();
  assert.ok(texts.some(t => t.includes('HULL 12 / 26')), 'health bar/text follows the newly selected enemy: ' + texts.join(' | '));

  // losing the lock -> health hidden
  S.locked = false;
  texts.length = 0;
  Game._renderHudCanvas();
  assert.ok(!texts.some(t => t.includes('HULL ')), 'hull health hidden when lock is lost: ' + texts.join(' | '));
});
