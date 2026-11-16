(function(){
  'use strict';
  const A = {
    ctx: null, master: null, muted: false, engineOsc: null, engineGain: null,
    init(){
      if(this.ctx) return;
      try{
        const AC = window.AudioContext || window.webkitAudioContext;
        if(!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        // engine hum
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 42;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 220;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.master);
        this.engineOsc.start();
      }catch(e){}
    },
    resume(){ if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{}); },
    toggleMute(){
      this.muted = !this.muted;
      if(this.master) this.master.gain.value = this.muted ? 0 : 0.32;
      return this.muted;
    },
    engine(level){
      if(!this.engineGain) return;
      const t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(Math.max(0, Math.min(0.14, level * 0.14)), t, 0.08);
      if(this.engineOsc) this.engineOsc.frequency.setTargetAtTime(38 + level * 55, t, 0.1);
    },
    tone(freq, dur, type, vol, slideTo, delay){
      if(!this.ctx || this.muted) return;
      try{
        const t0 = this.ctx.currentTime + (delay || 0);
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t0);
        if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
        g.gain.setValueAtTime(vol || 0.2, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g); g.connect(this.master);
        o.start(t0); o.stop(t0 + dur + 0.02);
      }catch(e){}
    },
    noise(dur, vol, freq, slideTo, delay){
      if(!this.ctx || this.muted) return;
      try{
        const t0 = this.ctx.currentTime + (delay || 0);
        const n = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(freq || 900, t0);
        if(slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol || 0.3, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start(t0);
      }catch(e){}
    },
    laser(){ this.tone(880, 0.12, 'sawtooth', 0.14, 160); },
    laserHit(){ this.tone(220, 0.08, 'square', 0.12, 90); },
    boom(){ this.noise(0.5, 0.45, 800, 60); this.tone(70, 0.4, 'triangle', 0.3, 30); },
    bigBoom(){ this.noise(0.9, 0.55, 500, 40); this.tone(50, 0.7, 'sine', 0.4, 25); },
    pickup(){ this.tone(660, 0.09, 'sine', 0.2, 990); this.tone(990, 0.1, 'sine', 0.16, 1320, 0.07); },
    coin(){ this.tone(1100, 0.07, 'square', 0.12); this.tone(1500, 0.09, 'square', 0.1, 1500, 0.06); },
    hurt(){ this.tone(180, 0.18, 'sawtooth', 0.25, 60); this.noise(0.15, 0.2, 400); },
    uiClick(){ this.tone(520, 0.05, 'square', 0.08, 620); },
    uiBuy(){ this.tone(700, 0.08, 'square', 0.12); this.tone(1050, 0.12, 'square', 0.12, 1050, 0.07); },
    chop(){ this.noise(0.12, 0.25, 600, 150); },
    mineHit(){ this.tone(1400, 0.06, 'square', 0.1, 900); },
    alienHiss(){ this.noise(0.3, 0.2, 2400, 500); },
    alienDie(){ this.tone(300, 0.25, 'sawtooth', 0.2, 40); this.noise(0.2, 0.15, 1200, 200); },
    shoot2d(){ this.tone(700, 0.08, 'square', 0.1, 240); },
    takeoff(){ this.noise(1.1, 0.4, 300, 2200); this.tone(90, 1.0, 'sawtooth', 0.2, 400); },
    land(){ this.noise(0.8, 0.35, 2200, 200); this.tone(300, 0.7, 'sawtooth', 0.18, 70); },
    warp(){ this.tone(200, 0.7, 'sine', 0.2, 1400); this.noise(0.7, 0.2, 1200, 3000); },
    alarm(){ this.tone(440, 0.25, 'square', 0.15, 220); this.tone(440, 0.25, 'square', 0.15, 220, 0.3); },
    // scanner lock acquired
    lock(){ this.tone(600, 0.08, 'square', 0.1); this.tone(900, 0.1, 'square', 0.12, 1200, 0.08); this.tone(1200, 0.14, 'sine', 0.12, 1600, 0.18); }
  };
  window.GameAudio = A;
})();
