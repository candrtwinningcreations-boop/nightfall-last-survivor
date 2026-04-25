'use client'

import { useGame } from '@/lib/game/store'
import { ITEMS, xpForNextLevel } from '@/lib/game/items'
import { Heart, Sun, Moon, Hand, Skull, Flame } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ItemIcon } from './item-icon'

export default function Hud() {
  const health = useGame(s => s.health)
  const level = useGame(s => s.level)
  const xp = useGame(s => s.xp)
  const timeOfDay = useGame(s => s.timeOfDay)
  const inventory = useGame(s => s.inventory)
  const hotbarIndex = useGame(s => s.hotbarIndex)
  const equippedItem = useGame(s => s.equippedItem)
  const offhandItem = useGame(s => s.offhandItem)
  const torchDurability = useGame(s => s.torchDurability)
  const torchMaxDurability = useGame(s => s.torchMaxDurability)
  const damageFlash = useGame(s => s.damageFlash)
  const toast = useGame(s => s.toast)

  const xpNeeded = xpForNextLevel(level)
  const xpPct = Math.min(100, (xp / xpNeeded) * 100)

  const isNight = timeOfDay < 0.2 || timeOfDay > 0.8

  // Animated toast
  const [toastVisible, setToastVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setToastVisible(true)
    const t = setTimeout(() => setToastVisible(false), 2400)
    return () => clearTimeout(t)
  }, [toast])

  // Day/night countdown + nearest-enemy health bar, polled from the game loop.
  const [phaseInfo, setPhaseInfo] = useState<{ phase: 'day' | 'night'; secondsLeft: number } | null>(null)
  const [nearestEnemy, setNearestEnemy] = useState<{ name: string; hp: number; maxHp: number; dist: number; kind: string } | null>(null)
  const [boss, setBoss] = useState<{ name: string; hp: number; maxHp: number; dist: number; kind: string; state?: string; grabCooldown?: number } | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = (window as any).__nightfall_phase
      if (p) setPhaseInfo({ phase: p.phase, secondsLeft: p.secondsLeft })
      const ne = (window as any).__nightfall_nearestEnemy
      setNearestEnemy(ne ?? null)
      const b = (window as any).__nightfall_boss
      setBoss(b ?? null)
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const fmtCountdown = (secs: number) => {
    const s = Math.max(0, Math.round(secs))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  }
  const torchPct = torchMaxDurability > 0 ? Math.max(0, Math.min(100, (torchDurability / torchMaxDurability) * 100)) : 0
  const torchTime = fmtCountdown(torchDurability)
  const visibleBoss = boss && boss.dist <= 75 ? boss : null

  // Health-based vignette: strong when low health
  const lowHealth = health / 100
  const vignetteOpacity = Math.max(damageFlash * 0.85, (1 - lowHealth) * 0.5)

  // Crosshair only visible during active play / build (not in menus).
  const gameMode = useGame(s => s.mode)
  const showCrosshair = gameMode === 'play' || gameMode === 'build'

  return (
    <>
      {/* Center-screen aim reticle so players know where their attacks land */}
      {showCrosshair && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="relative w-6 h-6">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[3px] h-[3px] rounded-full bg-white/80 shadow-[0_0_4px_rgba(0,0,0,0.9)]" />
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-[1px] h-2 bg-white/55" />
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[1px] h-2 bg-white/55" />
            <div className="absolute top-1/2 left-0 -translate-y-1/2 h-[1px] w-2 bg-white/55" />
            <div className="absolute top-1/2 right-0 -translate-y-1/2 h-[1px] w-2 bg-white/55" />
          </div>
        </div>
      )}

      {/* Damage / low-health vignette */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity"
        style={{
          opacity: vignetteOpacity,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(140,10,10,0.9) 100%)',
          mixBlendMode: 'multiply',
        }}
      />

      {/* Top bar: single countdown to the next phase */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        {phaseInfo ? (
          <div
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg bg-black/65 backdrop-blur-sm border text-sm font-mono tracking-wide shadow-lg ${
              phaseInfo.phase === 'day'
                ? 'border-amber-400/30 text-amber-100'
                : 'border-indigo-400/30 text-indigo-100'
            }`}
          >
            {phaseInfo.phase === 'day' ? (
              <>
                <Sun className="w-4 h-4 text-amber-300" />
                <span className="uppercase tracking-widest text-[11px] text-amber-300/90">Day · night in</span>
                <span className="text-base font-semibold text-white">{fmtCountdown(phaseInfo.secondsLeft)}</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-indigo-300" />
                <span className="uppercase tracking-widest text-[11px] text-indigo-300/90">Night · dawn in</span>
                <span className="text-base font-semibold text-white">{fmtCountdown(phaseInfo.secondsLeft)}</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white">
            {isNight ? <Moon className="w-4 h-4 text-indigo-300" /> : <Sun className="w-4 h-4 text-amber-300" />}
            <span className={`text-xs uppercase tracking-widest ${isNight ? 'text-indigo-300' : 'text-amber-300'}`}>
              {isNight ? 'Night' : 'Day'}
            </span>
          </div>
        )}
      </div>

      {/* Huge boss bars — persistent while a boss exists */}
      {visibleBoss && visibleBoss.kind === 'worm' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none w-[min(720px,86vw)]">
          <div className="px-5 py-3 rounded-xl bg-black/75 backdrop-blur-sm border border-cyan-300/35 shadow-[0_0_46px_-12px_rgba(103,232,249,0.85)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-white">
                <Skull className="w-5 h-5 text-cyan-200" />
                <span className="font-display text-lg font-extrabold uppercase tracking-widest text-cyan-100">{visibleBoss.name}</span>
                {visibleBoss.state && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 border border-red-400/25 text-red-200 uppercase tracking-widest">{visibleBoss.state}</span>}
              </div>
              <div className="text-right text-[10px] font-mono text-zinc-300">{Math.round(visibleBoss.dist)}m</div>
            </div>
            <div className="relative h-5 rounded-full bg-slate-950/80 border border-white/10 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-700 via-cyan-300 to-white transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, (visibleBoss.hp / visibleBoss.maxHp) * 100))}%` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.20)_1px,transparent_1px)] bg-[length:20%_100%]" />
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
              <span className="text-cyan-100">Red circle = move. Hit mouth to expose it. Fists 5 hits · pickaxe 3 · axe/sword 2.</span>
              <span className="text-cyan-50">{Math.max(0, Math.ceil(visibleBoss.hp))}/{Math.round(visibleBoss.maxHp)} HP</span>
            </div>
          </div>
        </div>
      )}

      {visibleBoss && visibleBoss.kind === 'orc' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none w-[min(720px,86vw)]">
          <div className="px-5 py-3 rounded-xl bg-black/75 backdrop-blur-sm border border-lime-400/35 shadow-[0_0_42px_-12px_rgba(132,204,22,0.75)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-white">
                <Skull className="w-5 h-5 text-lime-300" />
                <span className="font-display text-lg font-extrabold uppercase tracking-widest text-lime-100">{visibleBoss.name}</span>
                {visibleBoss.state && <span className="text-[10px] px-2 py-0.5 rounded-full bg-lime-400/15 border border-lime-400/25 text-lime-200 uppercase tracking-widest">{visibleBoss.state}</span>}
              </div>
              <div className="text-right text-[10px] font-mono text-zinc-300">
                <div>{Math.round(visibleBoss.dist)}m</div>
                {typeof visibleBoss.grabCooldown === 'number' && visibleBoss.grabCooldown > 0 && <div className="text-amber-300">Throw CD {Math.ceil(visibleBoss.grabCooldown)}s</div>}
              </div>
            </div>
            <div className="relative h-5 rounded-full bg-red-950/80 border border-white/10 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-lime-700 via-lime-500 to-yellow-300 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, (visibleBoss.hp / visibleBoss.maxHp) * 100))}%` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[length:10%_100%]" />
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
              <span className="text-lime-200">Hit glowing weak spots to knock the orc down</span>
              <span className="text-lime-100">{Math.max(0, Math.ceil(visibleBoss.hp))}/{Math.round(visibleBoss.maxHp)} HP</span>
            </div>
          </div>
        </div>
      )}

      {/* Enemy focus bar — only shown while a hostile is within range */}
      {nearestEnemy && (!visibleBoss || nearestEnemy.kind !== visibleBoss.kind) && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="min-w-[280px] max-w-[360px] px-4 py-2 rounded-lg bg-black/70 backdrop-blur-sm border border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.5)]">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-white">
                <Skull className="w-4 h-4 text-red-400" />
                <span className="font-semibold text-sm">{nearestEnemy.name}</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">{Math.round(nearestEnemy.dist)}m</span>
            </div>
            <div className="relative h-2 rounded bg-white/10 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-600 to-red-400 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, (nearestEnemy.hp / nearestEnemy.maxHp) * 100))}%` }}
              />
            </div>
            <div className="flex items-center justify-end mt-0.5">
              <span className="text-[10px] font-mono text-red-300">
                {Math.max(0, Math.ceil(nearestEnemy.hp))}/{Math.round(nearestEnemy.maxHp)} HP
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Top-right: level + xp */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="min-w-[220px] rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 p-3 text-white">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="uppercase tracking-widest text-amber-300 font-semibold">Level {level}</span>
            <span className="font-mono text-zinc-300">{xp}/{xpNeeded}</span>
          </div>
          <div className="h-2 rounded bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
              style={{ width: `${xpPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom-left: Health */}
      <div className="absolute bottom-4 left-4 pointer-events-auto">
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white"
          style={{ boxShadow: health < 40 ? '0 0 30px -5px rgba(220,38,38,0.6)' : undefined }}
        >
          <Heart className={`w-5 h-5 ${health < 40 ? 'text-red-500 animate-pulse' : 'text-red-400'}`} />
          <div className="flex flex-col">
            <span className="font-mono text-2xl font-bold leading-none">{health}</span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-400">Health</span>
          </div>
        </div>
      </div>

      {/* Bottom-center: Hotbar (first 5 inventory slots) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="flex gap-2 p-2 rounded-xl bg-black/60 backdrop-blur-sm border border-white/10">
          {inventory.slice(0, 5).map((slot, i) => {
            const active = i === hotbarIndex
            const def = slot?.id ? ITEMS[slot.id] : null
            return (
              <div
                key={i}
                className={`relative w-14 h-14 rounded-md border flex items-center justify-center transition-all ${
                  active ? 'border-amber-400 bg-amber-400/10 scale-105' : 'border-white/15 bg-white/5'
                }`}
              >
                {def && slot.id && (
                  <>
                    <ItemIcon id={slot.id} size={40} />
                    {slot.id === 'torch' && (
                      <>
                        <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-orange-100 drop-shadow">{torchTime}</span>
                        <div className="absolute bottom-0 left-1 right-1 h-1 bg-black/60 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-lime-400" style={{ width: `${torchPct}%` }} />
                        </div>
                      </>
                    )}
                    {slot.count > 1 && (
                      <span className="absolute bottom-0 right-1 font-mono text-[11px] text-white drop-shadow">
                        {slot.count}
                      </span>
                    )}
                  </>
                )}
                <span className="absolute top-0 left-1 text-[10px] font-mono text-zinc-400">{i + 1}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom-right: Equipped */}
      <div className="absolute bottom-4 right-4 pointer-events-auto flex items-end gap-2">
        <div className="relative flex items-center gap-2 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm border border-orange-500/20 text-white overflow-hidden">
          {offhandItem ? <ItemIcon id={offhandItem} size={30} /> : <Flame className="w-4 h-4 text-zinc-500" />}
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Offhand</span>
            <span className="text-xs font-semibold leading-none">{offhandItem ? `${ITEMS[offhandItem]?.name} · ${torchTime}` : 'Empty'}</span>
          </div>
          {offhandItem === 'torch' && <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-red-500 via-amber-400 to-lime-400" style={{ width: `${torchPct}%` }} />}
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white">
          {equippedItem ? (
            <>
              <ItemIcon id={equippedItem} size={36} />
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-none">{ITEMS[equippedItem]?.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                  {equippedItem === 'torch' ? `${ITEMS[equippedItem]?.damage} damage · ${torchTime}` : ITEMS[equippedItem]?.damage ? `${ITEMS[equippedItem]?.damage} damage` : 'utility item'}
                </span>
              </div>
            </>
          ) : (
            <>
              <Hand className="w-5 h-5 text-zinc-300" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-none">Fists</span>
                <span className="text-[10px] uppercase tracking-widest text-zinc-400">5 damage</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 px-5 py-2 rounded-lg bg-black/80 border border-white/15 text-white text-sm font-semibold transition-all ${
            toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Key hint bottom center (small) — full guide is in bottom-right KeysGuide */}
      <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 text-[11px] font-mono text-white/40 bg-black/30 px-3 py-1 rounded">
        [Tab] Inventory &middot; [Enter] Toggle keys guide
      </div>
    </>
  )
}
