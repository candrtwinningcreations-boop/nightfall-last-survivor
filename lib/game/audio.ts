'use client'

// Procedural game audio: day/night ambience only.
// All sounds are synthesized live via the Web Audio API — no external audio
// files are required, so nothing needs to ship with the app.

class GameAudio {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  ambientGain: GainNode | null = null
  private dayInterval: ReturnType<typeof setInterval> | null = null
  private nightInterval: ReturnType<typeof setInterval> | null = null
  // Sentinel value so the first update() always triggers refreshAmbience
  private isNight: boolean | null = null
  private started = false

  // Create the audio context on the first user interaction.
  init() {
    if (this.ctx) return
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      this.ctx = new AC() as AudioContext
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.6
      this.master.connect(this.ctx.destination)

      this.ambientGain = this.ctx.createGain()
      this.ambientGain.gain.value = 0.5
      this.ambientGain.connect(this.master)

      this.started = true
    } catch {
      this.ctx = null
    }
  }

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v))
  }

  // Call from the render loop. `isNight` drives ambience.  Vampire whispers
  // and drones were intentionally removed so vampires are visually scary
  // without adding repetitive noise.
  update(isNight: boolean, _vampireDist: number | null) {
    if (!this.started || !this.ctx) return
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    if (isNight !== this.isNight) {
      this.isNight = isNight
      this.refreshAmbience()
    }
  }

  private refreshAmbience() {
    if (this.dayInterval) { clearInterval(this.dayInterval); this.dayInterval = null }
    if (this.nightInterval) { clearInterval(this.nightInterval); this.nightInterval = null }

    if (!this.ctx) return

    if (this.isNight) {
      // Occasional owl hoots
      this.playOwl()
      this.nightInterval = setInterval(() => {
        if (Math.random() < 0.6) this.playOwl()
        if (Math.random() < 0.7) this.playCrickets()
      }, 4500)
    } else {
      // Bird chirps during the day
      this.playBirdChirp()
      this.dayInterval = setInterval(() => {
        if (Math.random() < 0.85) this.playBirdChirp()
      }, 1800)
    }
  }

  // --- Synthesized sounds ---

  private playBirdChirp() {
    if (!this.ctx || !this.ambientGain) return
    const ctx = this.ctx
    const now = ctx.currentTime + Math.random() * 0.3
    // 2-3 quick chirps
    const pulses = 2 + Math.floor(Math.random() * 3)
    const baseFreq = 1800 + Math.random() * 1600
    for (let i = 0; i < pulses; i++) {
      const t = now + i * 0.09
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const f1 = baseFreq + Math.random() * 600
      const f2 = baseFreq * (0.5 + Math.random() * 0.6)
      osc.frequency.setValueAtTime(f1, t)
      osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 400), t + 0.08)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      osc.connect(g)
      g.connect(this.ambientGain!)
      osc.start(t)
      osc.stop(t + 0.12)
    }
  }

  private playOwl() {
    if (!this.ctx || !this.ambientGain) return
    const ctx = this.ctx
    const now = ctx.currentTime + 0.05 + Math.random() * 0.2
    // "hoo-hoooo" pattern
    const makeHoot = (t: number, dur: number, freq: number, vol = 0.18) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      osc.frequency.linearRampToValueAtTime(freq * 0.85, t + dur)
      // vibrato via a second oscillator modulating frequency slightly
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = 6
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 6
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(g)
      g.connect(this.ambientGain!)
      osc.start(t)
      osc.stop(t + dur + 0.05)
      lfo.start(t)
      lfo.stop(t + dur + 0.05)
    }
    const base = 260 + Math.random() * 60
    makeHoot(now, 0.22, base, 0.16)
    makeHoot(now + 0.35, 0.45, base * 0.95, 0.2)
  }

  private playCrickets() {
    if (!this.ctx || !this.ambientGain) return
    const ctx = this.ctx
    const now = ctx.currentTime
    // Short high chirps
    const n = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) {
      const t = now + i * (0.14 + Math.random() * 0.06)
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = 3800 + Math.random() * 1200
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
      // High-pass it a bit
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 4500
      bp.Q.value = 8
      osc.connect(bp)
      bp.connect(g)
      g.connect(this.ambientGain!)
      osc.start(t)
      osc.stop(t + 0.06)
    }
  }


  stop() {
    if (this.dayInterval) { clearInterval(this.dayInterval); this.dayInterval = null }
    if (this.nightInterval) { clearInterval(this.nightInterval); this.nightInterval = null }
    try { this.ctx?.close() } catch {}
    this.ctx = null
    this.master = null
    this.ambientGain = null
    this.started = false
  }
}

let _audio: GameAudio | null = null
export function getGameAudio(): GameAudio {
  if (!_audio) _audio = new GameAudio()
  return _audio
}
