'use client'

import { useGame } from '@/lib/game/store'
import { ITEMS } from '@/lib/game/items'
import { X } from 'lucide-react'
import type { ItemId } from '@/lib/game/types'
import type { GameState } from '@/lib/game/store'
import { ItemIcon } from './item-icon'

type BuildKind = GameState['buildSelection']

const BUILD_OPTIONS: { key: BuildKind; itemId: ItemId }[] = [
  { key: 'wall',       itemId: 'wall' },
  { key: 'log_wall',   itemId: 'log_wall' },
  { key: 'stone_wall', itemId: 'stone_wall' },
  { key: 'floor',      itemId: 'floor' },
  { key: 'log_floor',  itemId: 'log_floor' },
  { key: 'spike_trap', itemId: 'spike_trap' },
  { key: 'tree_stand', itemId: 'tree_stand' },
  { key: 'furnace',    itemId: 'furnace' },
]

export default function BuildPanel() {
  const sel = useGame(s => s.buildSelection)
  const setSel = useGame(s => s.setBuildSelection)
  const setMode = useGame(s => s.setMode)
  // Build stock = dedicated buildInventory + any overflow that landed in the
  // regular inventory. The build menu is the single source of truth for
  // placeable counts.
  const countItem = useGame(s => s.countBuildItem)

  return (
    <div className="absolute bottom-36 left-1/2 -translate-x-1/2 pointer-events-auto animate-in fade-in slide-in-from-bottom duration-200">
      <div className="bg-black/80 backdrop-blur-sm border border-white/15 rounded-xl p-4 min-w-[520px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-white">Build Mode</h3>
          <button
            onClick={() => setMode('play')}
            className="w-7 h-7 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-zinc-300"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          {BUILD_OPTIONS.map(o => {
            const active = sel === o.key
            const def = ITEMS[o.itemId]
            const have = countItem(o.itemId)
            return (
              <button
                key={o.key}
                onClick={() => setSel(o.key)}
                className={`flex flex-col items-center gap-1 p-3 rounded-md border transition-all ${
                  active
                    ? 'border-amber-400 bg-amber-400/10 text-amber-200'
                    : have > 0
                      ? 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                      : 'border-white/5 bg-white/[0.02] text-zinc-500 opacity-70 hover:opacity-100'
                }`}
                title={def.description}
              >
                <ItemIcon id={o.itemId} size={36} emojiSize="text-3xl" />
                <span className="text-xs font-semibold mt-1">{def.name}</span>
                <span className="text-[10px] font-mono text-zinc-400">x{have}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] font-mono text-zinc-500 text-center">Click to place · Craft more in [C] Crafting · [B] Close</p>
      </div>
    </div>
  )
}
