'use client'

import { useGame } from '@/lib/game/store'
import { ITEMS, RECIPES, isBuildable } from '@/lib/game/items'
import { X, Hammer, Check, Flame, Package } from 'lucide-react'
import { ItemIcon } from './item-icon'
import { useEffect, useState } from 'react'

export default function CraftingPanel() {
  const inventory = useGame(s => s.inventory)
  const setMode = useGame(s => s.setMode)
  const removeItem = useGame(s => s.removeItem)
  const addItem = useGame(s => s.addItem)
  const addCraftedItem = useGame(s => s.addCraftedItem)
  const showToast = useGame(s => s.showToast)
  const craftingContext = useGame(s => s.craftingContext)
  const isForge = craftingContext === 'furnace'

  // Proximity to a placed furnace — exposed by game-canvas via window global.
  const [nearFurnace, setNearFurnace] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      setNearFurnace(!!(window as any).__nightfall_nearFurnace)
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  // Split recipes by context. The "C" key shows only the basic workbench
  // (wood/stone/tools — nothing iron). Right-clicking a furnace opens the
  // forge which shows ONLY smelting + iron tool recipes.
  const visibleRecipes = RECIPES.filter(r =>
    isForge ? !!r.requiresFurnace : !r.requiresFurnace
  )

  const countOf = (id: keyof typeof ITEMS) => inventory.reduce((acc, s) => (s?.id === id ? acc + s.count : acc), 0)

  const tryCraft = (recipeId: string) => {
    const r = RECIPES.find(r => r.id === recipeId)
    if (!r) return
    if (r.requiresFurnace && !nearFurnace) { showToast('Stand near a furnace to smelt'); return }
    for (const inp of r.inputs) if (countOf(inp.id) < inp.count) { showToast('Not enough materials'); return }
    for (const inp of r.inputs) removeItem(inp.id, inp.count)
    // Buildables are routed into the Build menu's inventory (not the hotbar)
    // via addCraftedItem. Weapons/ingots/tools go to the regular inventory.
    const ok = addCraftedItem(r.output.id, r.output.count)
    if (!ok) {
      // rollback on failure
      for (const inp of r.inputs) addItem(inp.id, inp.count)
      showToast('Inventory full')
      return
    }
    if (isBuildable(r.output.id)) {
      showToast(`Crafted ${ITEMS[r.output.id].name} → Build menu [B]`)
    } else {
      showToast(`Crafted ${ITEMS[r.output.id].name}`)
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm">
      <div className="w-[460px] max-w-[94vw] bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] p-4 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl font-bold flex items-center gap-2 text-white">
            {isForge ? (
              <>
                <Flame className="w-5 h-5 text-orange-400" />
                <span>Forge</span>
                <span className="text-[11px] font-mono font-normal text-orange-300/80 ml-1">
                  smelting &amp; iron tools
                </span>
              </>
            ) : (
              <>
                <Hammer className="w-5 h-5 text-emerald-400" />
                <span>Workbench</span>
                <span className="text-[11px] font-mono font-normal text-emerald-300/70 ml-1">
                  basic crafting
                </span>
              </>
            )}
          </h2>
          <button
            onClick={() => setMode('play')}
            className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context hint */}
        {isForge ? (
          <div className={`mb-3 flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11px] font-mono ${
            nearFurnace
              ? 'bg-orange-500/10 border-orange-500/40 text-orange-200'
              : 'bg-red-500/10 border-red-500/40 text-red-200'
          }`}>
            <Flame className={`w-3.5 h-3.5 ${nearFurnace ? 'text-orange-300' : 'text-red-400'}`} />
            {nearFurnace
              ? 'Forge is hot — smelt iron ore and craft iron tools'
              : 'Step closer to the furnace to keep the forge hot'}
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11px] font-mono bg-emerald-500/10 border-emerald-500/30 text-emerald-200">
            <Hammer className="w-3.5 h-3.5 text-emerald-300" />
            Craft basic tools &amp; buildables. Right-click a furnace for iron gear.
          </div>
        )}

        <div className="grid gap-2 max-h-[58vh] overflow-y-auto pr-1 nf-craft-scroll">
          {visibleRecipes.length === 0 && (
            <div className="text-center py-8 text-zinc-500 text-sm font-mono">
              {isForge
                ? 'No forge recipes unlocked yet.'
                : 'No basic recipes available.'}
            </div>
          )}
          {visibleRecipes.map((r, i) => {
            const out = ITEMS[r.output.id]
            const canCraft = r.inputs.every(inp => countOf(inp.id) >= inp.count) && (!r.requiresFurnace || nearFurnace)
            const materialsOk = r.inputs.every(inp => countOf(inp.id) >= inp.count)
            return (
              <div
                key={r.id}
                className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all ${
                  r.requiresFurnace
                    ? 'border-orange-500/20 bg-gradient-to-r from-orange-500/5 to-transparent hover:bg-orange-500/10'
                    : 'border-white/10 bg-zinc-900/60 hover:bg-zinc-900'
                }`}
                style={{ animation: `fadeUp 0.35s ${Math.min(i, 8) * 0.03}s backwards ease-out` }}
              >
                <div className="w-11 h-11 rounded-md bg-zinc-800 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <ItemIcon id={r.output.id} size={36} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-white text-sm truncate flex items-center gap-1">
                      {out.name}
                      {r.output.count > 1 && <span className="text-zinc-400 font-normal ml-1">×{r.output.count}</span>}
                      {r.requiresFurnace && (
                        <Flame className="w-3 h-3 text-orange-400 inline-block ml-1" aria-label="Requires furnace" />
                      )}
                      {isBuildable(r.output.id) && (
                        <Package className="w-3 h-3 text-amber-300 inline-block ml-1" aria-label="Goes to Build menu" />
                      )}
                    </h3>
                    {out.damage && <span className="text-[10px] font-mono text-red-400 flex-shrink-0">{out.damage} DMG</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5 items-center">
                    {r.inputs.map(inp => {
                      const have = countOf(inp.id)
                      const ok = have >= inp.count
                      return (
                        <span
                          key={inp.id}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                            ok ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10'
                          }`}
                        >
                          <ItemIcon id={inp.id} size={14} emojiSize="text-[12px]" />
                          {have}/{inp.count}
                        </span>
                      )
                    })}
                    {r.requiresFurnace && !nearFurnace && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-orange-300 flex items-center gap-1">
                        <Flame className="w-3 h-3" /> furnace
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => tryCraft(r.id)}
                  disabled={!canCraft}
                  className={`px-2.5 py-1.5 rounded-md font-semibold text-xs flex items-center gap-1 transition-all ${
                    canCraft
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_14px_-5px_rgba(16,185,129,0.6)]'
                      : 'bg-white/5 text-zinc-500 cursor-not-allowed'
                  }`}
                  title={r.requiresFurnace && !nearFurnace ? 'Stand near a placed furnace' : materialsOk ? 'Craft' : 'Missing materials'}
                >
                  <Check className="w-3.5 h-3.5" /> Craft
                </button>
              </div>
            )
          })}
        </div>

        <p className="mt-3 text-center text-[11px] text-zinc-500 font-mono">
          {isForge ? 'Press Esc to step away from the forge' : 'Press [C] or Esc to close'}
        </p>
      </div>
      <style jsx>{`
        .nf-craft-scroll::-webkit-scrollbar { width: 6px }
        .nf-craft-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); border-radius: 4px }
        .nf-craft-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px }
        .nf-craft-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2) }
      `}</style>
    </div>
  )
}
