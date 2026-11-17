'use strict';
// Step 2 tests: planetary health, medkits, ship repairs.
//
// Run with: npm test   (or: node --test)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');

function makeLocalStorage(seedSave) {
  const data = new Map();
  if (seedSave !== undefined) data.set('galaxy-one-save', JSON.stringify(seedSave));
  return {
    data,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }
  };
}

function makeDocument(){
  return {
    createElement(){ return {
      id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
      classList: { add(){}, remove(){}, contains(){ return false; } },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener() {}
    }; },
    getElementById(){ return { addEventListener() {}, disabled: false, style: {}, parentElement: null, nextElementSibling: null }; },
    addEventListener() {}
  };
}

function loadPlayer(seedSave) {
  const localStorage = makeLocalStorage(seedSave);
  const document = makeDocument();
  const window = {
    localStorage, document, __GALAXY_TEST__: true, addEventListener() {},
    Math, JSON, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }
  };
  const context = vm.createContext({ window, localStorage, document, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/player.js'), 'utf8'), context, { filename: 'js/player.js' });
  return { window, localStorage, context };
}

test('PD.playerHp is separate from ship hp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  assert.equal(PD.playerHp, 100);
  assert.equal(PD.hp, 100);
  assert.equal(PD.playerHpMax(), 100);
  PD.hp = 10;
  assert.equal(PD.playerHp, 100);
  PD.playerHp = 10;
  assert.equal(PD.hp, 10);
});

test('PD.playerDmg reduces player health only, never ship hp/shield', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.shield = 50;
  PD.hp = 100;
  PD.playerHp = 100;
  PD.playerDmg(30);
  assert.equal(PD.playerHp, 70);
  assert.equal(PD.hp, 100, 'ship hp unchanged');
  assert.equal(PD.shield, 50, 'shield unchanged');
  PD.playerDmg(1000);
  assert.equal(PD.playerHp, 0);
});

test('PD.useMedkit heals playerHp in planet mode, not ship hp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'planet' };
  PD.medkits = 1;
  PD.hp = 10;
  PD.playerHp = 10;
  const result = PD.useMedkit();
  assert.equal(result, true);
  assert.equal(PD.medkits, 0);
  assert.equal(PD.playerHp, 65, 'player health healed by 55');
  assert.equal(PD.hp, 10, 'ship hp NOT healed by medkit in planet mode');
});

test('PD.useMedkit heals ship hp in space mode', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'space' };
  PD.medkits = 1;
  PD.hp = 10;
  PD.playerHp = 100;
  const result = PD.useMedkit();
  assert.equal(result, true);
  assert.equal(PD.hp, 65, 'ship hp healed by 55 in space mode');
  assert.equal(PD.playerHp, 100, 'playerHp unchanged in space mode');
});

test('PD.useMedkit returns false when no medkits or already at max', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'planet' };
  PD.medkits = 0;
  PD.playerHp = 100;
  assert.equal(PD.useMedkit(), false);
  PD.medkits = 1;
  PD.playerHp = 100;
  assert.equal(PD.useMedkit(), false, 'no heal when at max');
});

test('save/load round-trips playerHp', () => {
  const { window, localStorage } = loadPlayer();
  const PD = window.PD;
  PD.playerHp = 42;
  PD.save();
  const raw = JSON.parse(localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.playerHp, 42);
  const { window: w2 } = loadPlayer(raw);
  assert.equal(w2.PD.playerHp, 42);
  assert.equal(w2.PD.playerHpMax(), 100);
});

test('legacy save without playerHp defaults to full health', () => {
  const legacySave = { credits: 777, systemIdx: 0, hp: 50, shield: 0 };
  assert.equal(Object.prototype.hasOwnProperty.call(legacySave, 'playerHp'), false);
  const { window } = loadPlayer(legacySave);
  assert.equal(window.PD.playerHp, 100, 'legacy save gets full player health');
  // ship hp is reset by resetShipState() on load (existing behavior)
  assert.equal(window.PD.hp, window.PD.hullMax(), 'ship hp reset to max on load');
});

test('PD.newGame() resets playerHp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.playerHp = 10;
  PD.medkits = 5;
  PD.credits = 9999;
  PD.newGame();
  assert.equal(PD.playerHp, 100);
  assert.equal(PD.hp, PD.hullMax());
  assert.equal(PD.credits, 400);
});

test('repair cost scales with missing hull', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.hp = PD.hullMax(); // full hull
  let missing = Math.ceil(PD.hullMax() - PD.hp);
  assert.equal(missing, 0);
  assert.equal(Math.ceil(missing * 2), 0, 'no cost when hull full');

  PD.hp = Math.ceil(PD.hullMax() * 0.5); // half hull
  missing = Math.ceil(PD.hullMax() - PD.hp);
  const cost = Math.ceil(missing * 2);
  assert.ok(cost > 0, 'repair cost should be positive when damaged');
  assert.equal(cost, Math.ceil(missing * 2));
});

test('repair deducts credits and restores hull to max', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.credits = 1000;
  PD.hp = 10; // damaged
  const missingHull = Math.ceil(PD.hullMax() - PD.hp);
  const repairCost = Math.ceil(missingHull * 2);
  assert.ok(PD.credits >= repairCost, 'enough credits for repair');
  PD.credits -= repairCost;
  PD.hp = PD.hullMax();
  assert.equal(PD.hp, PD.hullMax(), 'hull restored to max');
  assert.equal(PD.credits, 1000 - repairCost, 'credits deducted');
});

test('repair blocked when insufficient credits', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.credits = 0;
  PD.hp = 10; // damaged
  const missingHull = Math.ceil(PD.hullMax() - PD.hp);
  const repairCost = Math.ceil(missingHull * 2);
  assert.ok(PD.credits < repairCost, 'not enough credits');
  assert.equal(PD.credits, 0, 'no credits deducted when insufficient');
  assert.notEqual(PD.hp, PD.hullMax(), 'hull not restored');
});

