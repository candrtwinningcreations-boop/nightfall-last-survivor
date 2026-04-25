'use client'

import { useGame } from '@/lib/game/store'
import { Play, DoorOpen, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export default function PausePanel({ onSave, onLeaveServer }: { onSave: () => Promise<void>; onLeaveServer: () => Promise<void> }) {
  const setMode = useGame(s => s.setMode)
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/70 backdrop-blur-sm">
      <div className="w-[360px] max-w-[92vw] bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] p-6 text-center animate-in fade-in zoom-in duration-200">
        <h2 className="font-display text-3xl font-bold text-white mb-6">Paused</h2>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setMode('play')}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold transition-all"
          >
            <Play className="w-4 h-4" /> Resume
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try { await onSave(); toast.success('Game saved') } catch { toast.error('Save failed') }
              setSaving(false)
            }}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Game'}
          </button>
          <button
            disabled={leaving}
            onClick={async () => {
              setLeaving(true)
              try { await onLeaveServer() } catch { toast.error('Failed to leave server') }
              setLeaving(false)
            }}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all"
          >
            <DoorOpen className="w-4 h-4" /> {leaving ? 'Leaving...' : 'Leave Server'}
          </button>
        </div>
      </div>
    </div>
  )
}
