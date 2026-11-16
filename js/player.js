(function(){
  'use strict';
  // Shared persistent player state: credits, cargo, upgrades, hull, shield.
  const SAVE_KEY = 'galaxy-one-save';

  const COMMS = {
    ore:     { name: 'Iron Ore',      base: 12 },
    wood:    { name: 'Hardwood',      base: 9  },
    crystal: { name: 'Krell Crystal', base: 34 },
    goo:     { name: 'Alien Goo',     base: 18 }
  };

  const PLANETS = [
    { name: 'TERRA PRIME', type: 'peaceful', color: 0x4d8fe0, size: 110,
      x: 420,  y: 60,  z: -900,  seed: 11, alienRate: 0.25, treeN: 90, crystalN: 8,
      rockN: 30, trader: true, desc: 'Trade hub · wood' },
    { name: 'VERDANT', type: 'mixed', color: 0x3fae72, size: 90,
      x: -1400, y: -120, z: 500, seed: 23, alienRate: 0.7, treeN: 110, crystalN: 22,
      rockN: 46, trader: true, desc: 'Wood + crystals · some aliens' },
    { name: 'KRELL PRIME', type: 'hostile', color: 0x8a3fd0, size: 120,
      x: 1500, y: 200, z: 1400, seed: 37, alienRate: 1.6, treeN: 40, crystalN: 46,
      rockN: 30, trader: false, desc: 'Crystal-rich · swarms' },
    { name: 'ASHFALL', type: 'hostile', color: 0xd0613f, size: 100,
      x: -900, y: 320, z: -1700, seed: 51, alienRate: 1.9, treeN: 14, crystalN: 24,
      rockN: 70, trader: false, desc: 'Rich ore · spitters' }
  ];

  const P = {
    hp: 100, shield: 0, credits: 400, medkits: 1,
    cargo: { ore: 0, wood: 0, crystal: 0, goo: 0 },
    up: { weapon: 1, engine: 1, hull: 1, shield: 1 },
    spaceSaved: null,           // ship pos/quat while landed
    planetIndex: 0,
    alive: true,

    hullMax(){ return 60 + this.up.hull * 40; },
    shieldMax(){ return this.up.shield >= 2 ? (this.up.shield - 1) * 35 : 0; },
    laserDmg(){ return 8 + this.up.weapon * 6; },
    fireDelay(){ return Math.max(0.09, 0.3 - this.up.weapon * 0.04); },
    thrust(){ return 34 + this.up.engine * 16; },
    maxSpeed(){ return 70 + this.up.engine * 26; },
    cargoMax(){ return 40 + this.up.hull * 10; },
    cargoUsed(){
      let n = 0;
      for(const k in this.cargo) n += this.cargo[k];
      return n;
    },
    addItem(type, n){
      n = n || 1;
      const free = this.cargoMax() - this.cargoUsed();
      const take = Math.min(n, free);
      if(take > 0) this.cargo[type] = (this.cargo[type] || 0) + take;
      return take;
    },
    priceSell(type, planetType){
      let mult = 1;
      if(planetType === 'hostile') mult = 1.25;
      return Math.round(COMMS[type].base * mult);
    },
    dmg(n){
      if(!this.alive) return;
      if(this.shield > 0){
        const absorbed = Math.min(this.shield, n);
        this.shield -= absorbed;
        n -= absorbed;
      }
      if(n > 0) this.hp -= n;
      if(this.hp <= 0){
        this.hp = 0;
        this.alive = false;
      }
    },
    healFull(){
      this.hp = this.hullMax();
      this.shield = this.shieldMax();
      this.alive = true;
    },
    useMedkit(){
      if(this.medkits <= 0 || this.hp >= this.hullMax()) return false;
      this.medkits--;
      this.hp = Math.min(this.hullMax(), this.hp + 55);
      return true;
    },
    resetShipState(){
      this.hp = this.hullMax();
      this.shield = this.shieldMax();
      this.alive = true;
    },
    save(){
      try{
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          credits: this.credits, medkits: this.medkits, cargo: this.cargo, up: this.up
        }));
      }catch(e){}
    },
    load(){
      try{
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if(!s) return;
        this.credits = s.credits != null ? s.credits : this.credits;
        this.medkits = s.medkits != null ? s.medkits : this.medkits;
        if(s.cargo) for(const k in this.cargo) this.cargo[k] = s.cargo[k] | 0;
        if(s.up) for(const k in this.up) this.up[k] = s.up[k] || 1;
      }catch(e){}
    }
  };
  P.resetShipState();
  P.load();
  window.PD = P;
  window.COMMS = COMMS;
  window.PLANETS = PLANETS;
})();
