'use strict';
// Runtime smoke test: load the real Three.js runtime plus the full game script
// chain (audio, player, space3d, planet2d, game) into an isolated browser-like VM
// context, then exercise the wiring that the unit tests cannot reach without a
// WebGL context (Space methods, HUD rendering).
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
    addEventListener(){}, remove(){},
    getContext(){ return null; }
  };
}

function makeContext(){
  const els = {};
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){},
    removeEventListener(){}
  };
  const localStorage = { data: new Map(), getItem(k){ return this.data.has(k) ? this.data.get(k) : null; },
    setItem(k, v){ this.data.set(k, String(v)); }, removeItem(k){ this.data.delete(k); } };
  const window = {
    localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener(){}, devicePixelRatio: 1
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame(){},
    AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements };
}

test('full runtime script chain loads without errors and wires the system correctly', () => {
  const { window } = makeContext();
  // every subsystem registered on the shared window object
  assert.ok(window.GameAudio, 'GameAudio loaded');
  assert.ok(window.Space, 'Space loaded');
  assert.ok(window.PD, 'PD loaded');
  assert.ok(window.SYSTEMS, 'SYSTEMS loaded');
  assert.ok(window.Game, 'Game loaded');
  assert.ok(window.Planet, 'Planet loaded');

  // the 3D flight controller exposes its full surface (no missing members after
  // the Stage A edits — this is what the js/space3d.js:1578-1580 crash cluster was about)
  const S = window.Space;
  for(const m of ['init', 'enter', 'exit', 'update', 'render', 'jumpTo', 'respawn', 'saveForLanding',
                  'getScreenTargets', 'buildStations', '_buildStation', '_buildPlanets', '_buildShip',
                  '_fireEMP', '_killPirate']){
    assert.equal(typeof S[m], 'function', 'Space.' + m + ' should be a function');
  }
  assert.equal(typeof window.Game._renderGalaxy, 'function');
  assert.equal(typeof window.Game._bodyInfo, 'function');

  // authoritative table + derived map agree after a cold load
  assert.equal(window.SYSTEMS.length, 3);
  assert.deepEqual(window.Game.GALAXY.map(s => s.name), window.SYSTEMS.map(s => s.name));
});

test('runtime HUD render reflects the current system and updates with PD.systemIdx', () => {
  const { window, document, elements } = makeContext();
  const Game = window.Game;
  Game.state = 'space';
  Game.menuOpenNow = false;
  Game.els = {
    prompt: document.getElementById('hud-prompt'),
    toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null }
  };

  const sysEl = document.getElementById('sys-txt');
  // fresh context loads PD from an empty storage -> system 0 (ORION REACH)
  assert.equal(window.PD.systemIdx, 0);
  Game._renderHudDom();
  assert.equal(sysEl.textContent, '◈ SYSTEM · ORION REACH');

  // switching systems via the same path the game uses updates the HUD readout
  window.PD.systemIdx = 2;
  Game._renderHudDom();
  assert.equal(sysEl.textContent, '◈ SYSTEM · NOVARA SPUR');

  // and back
  window.PD.systemIdx = 0;
  Game._renderHudDom();
  assert.equal(sysEl.textContent, '◈ SYSTEM · ORION REACH');
});
