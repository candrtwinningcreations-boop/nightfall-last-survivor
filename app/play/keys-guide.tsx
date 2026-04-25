'use client'

import { useGame } from '@/lib/game/store'
import { Keyboard, ChevronRight } from 'lucide-react'
import { useState } from 'react'

const KEYS: { k: string; label: string; hint?: string }[] = [
  { k: 'Mouse', label: 'Look around (FPS)' },
  { k: 'WASD',  label: 'Walk / strafe' },
  { k: 'Arrow', label: 'Walk / strafe' },
  { k: 'LMB',   label: 'Attack / swing' },
  { k: 'RMB',   label: 'Swing weapon' },
  { k: 'Space', label: 'Jump' },
  { k: 'F',     label: 'Attack' },
  { k: 'Shift', label: 'Sprint' },
  { k: '1–5',   label: 'Hotbar select' },
  { k: 'Tab',   label: 'Inventory / stats / shop' },
  { k: 'I',     label: 'Inventory' },
  { k: 'C',     label: 'Crafting' },
  { k: 'B',     label: 'Build menu' },
  { k: 'E',     label: 'Pickup / interact' },
  { k: 'Q',     label: 'Drop item' },
  { k: 'Esc',   label: 'Pause' },
  { k: 'Enter', label: 'Toggle this guide', hint: 'current' },
]

export default function KeysGuide() {
  const visible = useGame(s => s.keysGuideVisible)
  const toggle = useGame(s => s.toggleKeysGuide)
  const [minimized, setMinimized] = useState(false)

  if (!visible) {
    // Compact chip when globally hidden — shows a hint to press Enter to bring it back
    return (
      <button
        onClick={toggle}
        className="pointer-events-auto absolute bottom-24 right-4 text-[11px] font-mono text-white/50 hover:text-white/90 bg-black/40 hover:bg-black/70 border border-white/10 px-2 py-1 rounded transition-colors"
        title="Show Keys Guide (Enter)"
      >
        ⌨️ Keys [Enter]
      </button>
    )
  }

  return (
    <div className="pointer-events-auto absolute bottom-24 right-4 max-w-[260px] rounded-lg bg-black/70 backdrop-blur-sm border border-white/10 text-white shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-amber-300" />
          <span className="font-display text-xs font-bold uppercase tracking-widest">Keys Guide</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(m => !m)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-zinc-300"
            title={minimized ? 'Expand' : 'Collapse'}
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${minimized ? 'rotate-180' : '-rotate-90'}`} />
          </button>
          <button
            onClick={toggle}
            className="text-[10px] font-mono text-zinc-400 hover:text-white px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30"
            title="Hide (Enter)"
          >
            Enter
          </button>
        </div>
      </div>
      {!minimized && (
        <ul className="p-2 space-y-1 font-mono text-[11px] leading-tight">
          {KEYS.map((k, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded border ${
                k.hint === 'current'
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                  : 'border-white/15 bg-white/5 text-zinc-200'
              }`}>
                {k.k}
              </span>
              <span className="text-zinc-300">{k.label}</span>
            </li>
          ))}
        </ul>
      )}
      {minimized && (
        <div className="px-3 py-2 font-mono text-[11px] text-zinc-400">[Enter] to hide · click ▸ to expand</div>
      )}
    </div>
  )
}
