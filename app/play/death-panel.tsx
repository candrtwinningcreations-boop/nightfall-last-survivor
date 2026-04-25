'use client'

import { useGame } from '@/lib/game/store'
import { Skull, RotateCcw, Home } from 'lucide-react'
import Link from 'next/link'

export default function DeathPanel({ onRespawn }: { onRespawn: () => void }) {
  const level = useGame(s => s.level)
  const deaths = useGame(s => s.deaths)

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black">
      <div className="text-center animate-in fade-in duration-500">
        <Skull className="w-44 h-44 text-red-600 mx-auto mb-4 drop-shadow-[0_0_60px_rgba(220,38,38,0.95)] animate-pulse" />
        <h1 className="font-display text-7xl md:text-8xl font-extrabold text-red-500 mb-2 tracking-wider">YOU DIED</h1>
        <p className="text-zinc-400 max-w-md mx-auto mb-8">
          The night consumes you. Your body lies in the dirt, a loot bag waiting for scavengers.
        </p>
        <div className="flex items-center justify-center gap-6 text-sm font-mono text-zinc-400 mb-8">
          <span>Level reached: <span className="text-white">{level}</span></span>
          <span className="text-white/20">|</span>
          <span>Deaths: <span className="text-white">{deaths}</span></span>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onRespawn}
            className="inline-flex items-center gap-2 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-md shadow-[0_0_40px_-10px_rgba(220,38,38,0.8)] transition-all hover:scale-105"
          >
            <RotateCcw className="w-5 h-5" /> Respawn
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold uppercase tracking-widest rounded-md transition-all"
          >
            <Home className="w-5 h-5" /> Main Menu
          </Link>
        </div>
      </div>
    </div>
  )
}
