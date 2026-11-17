'use strict';
// Start screen: Continue / New Game, save-slot reset, clean-start behavior.
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
      className: '', innerHTML: '', textContent: '', style: {}, children: [], disabled: false,
      appendChild(child) { this.children.push(child); return child; },
      addEventListener() {}
    }; },
    getElementById(){ return { addEventListener() {}, disabled: false }; },
    addEventListener() {}
  };
}

// Load player.js into an isolated browser-like context.
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

test('PD.newGame() resets all progression to starting values', () => {
  const { window } = loadPlayer();
  const PD = window.PD;

  // Mutate PD away from defaults
  PD.credits = 9999;
  PD.medkits = 5;
  PD.cargo = { ore: 99, wood: 99, crystal: 99, goo: 99 };
  PD.trade = { food: 99, tech: 99, med: 99, lux: 99 };
  PD.up = { weapon: 5, engine: 5, hull: 5, shield: 5, scanner: 5 };
  PD.installed = ['cargo', 'retrieval', 'weapon'];
  PD.modules = ['emp', 'passenger'];
  PD.missions = [{ type: 'delivery', label: 'old mission' }];
  PD.missionsDone = 42;
  PD.planetIndex = 3;
  PD.systemIdx = 2;
  PD.surfaceStates = { 0: { treeN: 1 }, 2: { rockN: 2 } };

  PD.newGame();

  assert.equal(PD.credits, 400);
  assert.equal(PD.medkits, 1);
  assert.deepEqual(PD.cargo, { ore: 0, wood: 0, crystal: 0, goo: 0 });
  assert.deepEqual(PD.trade, { food: 0, tech: 0, med: 0, lux: 0 });
  assert.deepEqual(PD.up, { weapon: 1, engine: 1, hull: 1, shield: 1, scanner: 1 });
  assert.deepEqual(PD.installed, []);
  assert.deepEqual(PD.modules, []);
  assert.deepEqual(PD.missions, []);
  assert.equal(PD.missionsDone, 0);
  assert.equal(PD.planetIndex, 0);
  assert.equal(PD.systemIdx, 0);
  assert.equal(PD.systemName(PD.systemIdx), 'ORION REACH');
  // hp/shield reset via resetShipState
  assert.equal(PD.hp, PD.hullMax());
  assert.equal(PD.alive, true);
  // surface state cleared
  assert.equal(Object.keys(PD.surfaceStates).length, 0);
});

test('PD.newGame() clears the save slot', () => {
  const { window, localStorage } = loadPlayer({ credits: 1234, systemIdx: 2 });
  assert.equal(localStorage.getItem('galaxy-one-save'), JSON.stringify({ credits: 1234, systemIdx: 2 }));

  window.PD.newGame();
  assert.equal(localStorage.getItem('galaxy-one-save'), null);
});

test('PD.hasSave() reports save-slot presence correctly', () => {
  const { window, localStorage } = loadPlayer();
  assert.equal(window.PD.hasSave(), false);

  localStorage.setItem('galaxy-one-save', JSON.stringify({ credits: 10, systemIdx: 0 }));
  // hasSave reads live localStorage
  assert.equal(window.PD.hasSave(), true);

  localStorage.removeItem('galaxy-one-save');
  assert.equal(window.PD.hasSave(), false);
});

test('save/load round-trips systemIdx for Continue', () => {
  const { window, localStorage } = loadPlayer();
  const PD = window.PD;

  PD.systemIdx = 1; // KRELL EXPANSE
  PD.credits = 555;
  PD.save();

  const raw = JSON.parse(localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.systemIdx, 1);
  assert.equal(raw.credits, 555);

  // Simulate Continue: load into a fresh context
  const { window: w2 } = loadPlayer(raw);
  assert.equal(w2.PD.systemIdx, 1);
  assert.equal(w2.PD.credits, 555);
  assert.equal(w2.PD.systemName(w2.PD.systemIdx), 'KRELL EXPANSE');
});

test('legacy save without systemIdx loads into ORION REACH on Continue', () => {
  const legacySave = { credits: 777, medkits: 2, cargo: { ore: 1 }, up: { weapon: 1, engine: 1, hull: 1, shield: 1, scanner: 1 } };
  const { window } = loadPlayer(legacySave);
  assert.equal(window.PD.systemIdx, 0);
  assert.equal(window.PD.systemName(window.PD.systemIdx), 'ORION REACH');
  assert.equal(window.PD.credits, 777);
});
