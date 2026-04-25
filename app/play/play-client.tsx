'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useGame } from '@/lib/game/store'
import Hud from './hud'
import InventoryPanel from './inventory-panel'
import CraftingPanel from './crafting-panel'
import BuildPanel from './build-panel'
import PausePanel from './pause-panel'
import DeathPanel from './death-panel'
import KeysGuide from './keys-guide'
import type { SaveData } from '@/lib/game/types'
import { Loader2, Users, LogOut } from 'lucide-react'

const GameCanvas = dynamic(() => import('./game-canvas'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-black text-white">
      <Loader2 className="w-6 h-6 animate-spin mr-3" /> Loading world...
    </div>
  ),
})

type GhostPlayer = {
  id: string
  name: string
  posX: number
  posY: number
  posZ: number
  yaw: number
}

export default function PlayClient() {
  const router = useRouter()
  const { data: session, status } = useSession() || {}
  const mode = useGame(s => s.mode)
  const respawn = useGame(s => s.respawn)
  const setInventory = useGame(s => s.setInventory)
  const setLevel = useGame(s => s.setLevel)
  const setHealth = useGame(s => s.setHealth)
  const setTime = useGame(s => s.setTime)
  const setStructures = useGame(s => s.setStructures)
  const showToast = useGame(s => s.showToast)

  const [loaded, setLoaded] = useState(false)
  const [showIntro, setShowIntro] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [serverName, setServerName] = useState<string>('')
  const [playerCount, setPlayerCount] = useState(1)
  const serverIdRef = useRef<string | null>(null)
  const guestIdRef = useRef<string | null>(null)
  const guestNameRef = useRef<string | null>(null)

  // Auth/server gate. Must run before anything else.
  useEffect(() => {
    if (status === 'loading') return
    const isGuest = typeof window !== 'undefined' && localStorage.getItem('nightfall:guest') === '1'
    if (!session && !isGuest) {
      router.replace('/')
      return
    }
    const sid = typeof window !== 'undefined' ? localStorage.getItem('nightfall:serverId') : null
    const sname = typeof window !== 'undefined' ? localStorage.getItem('nightfall:serverName') : null
    if (!sid) {
      router.replace('/servers')
      return
    }
    serverIdRef.current = sid
    setServerName(sname || 'Unknown Server')
    if (isGuest) {
      // Get or make a stable guest id + display name
      let gid = localStorage.getItem('nightfall:guestId')
      if (!gid) {
        gid = 'guest_' + Math.random().toString(36).slice(2, 10)
        localStorage.setItem('nightfall:guestId', gid)
      }
      let gname = localStorage.getItem('nightfall:guestName')
      if (!gname) {
        gname = 'Wanderer' + Math.floor(Math.random() * 1000)
        localStorage.setItem('nightfall:guestName', gname)
      }
      guestIdRef.current = gid
      guestNameRef.current = gname
    }
    // Announce join to the server so our slot is reserved and we show up in presence
    fetch(`/api/servers/${encodeURIComponent(sid)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: guestIdRef.current || undefined,
        guestName: guestNameRef.current || undefined,
      }),
    }).then(async r => {
      if (!r.ok) {
        const msg = await r.text().catch(() => '')
        // eslint-disable-next-line no-console
        console.warn('Nightfall: failed to join server', r.status, msg)
        router.replace('/servers')
        return
      }
      const data = await r.json().catch(() => null)
      if (data?.identity?.key) {
        try { (window as any).__nightfallMemberKey = data.identity.key } catch {}
      }
      setAuthed(true)
    }).catch(() => setAuthed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Load save on mount (only after auth is resolved)
  useEffect(() => {
    if (!authed) return
    const sid = serverIdRef.current
    let cancelled = false
    // Saves are scoped per-identity per-server. Pass serverId (and guestId for guests).
    const qs = new URLSearchParams()
    if (sid) qs.set('serverId', sid)
    if (guestIdRef.current) {
      qs.set('guestId', guestIdRef.current)
      if (guestNameRef.current) qs.set('guestName', guestNameRef.current)
    }
    const url = `/api/save${qs.toString() ? `?${qs.toString()}` : ''}`
    fetch(url).then(r => r.ok ? r.json() : null).then((data: SaveData | null) => {
      if (cancelled) return
      if (data) {
        setHealth(data.health)
        setLevel(data.level, data.xp)
        setTime(data.timeOfDay)
        const savedOffhand = data.offhandItem === 'torch' ? 'torch' : (() => {
          try { return localStorage.getItem(`nightfall:offhand:${sid || 'default'}`) === 'torch' ? 'torch' : null } catch { return null }
        })()
        useGame.getState().setOffhand(savedOffhand)
        try {
          const inv = JSON.parse(data.inventoryJson || '[]')
          if (Array.isArray(inv) && inv.length > 0) {
            // Only overwrite starter inventory if the save actually has items in it
            const hasAnyItem = inv.some((slot: any) => slot && slot.id && slot.count > 0)
            if (hasAnyItem) setInventory(inv)
          }
        } catch {}
        try {
          const structs = JSON.parse(data.structuresJson || '[]')
          if (Array.isArray(structs)) setStructures(structs)
        } catch {}
        // teleport after canvas mounts
        setTimeout(() => {
          const t = (window as any).__nightfallTeleport
          if (t && data.posX !== undefined) t(data.posX, data.posZ)
        }, 500)
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [authed, setHealth, setInventory, setLevel, setStructures, setTime])

  // Auto-save every 30 sec
  useEffect(() => {
    if (!authed) return
    const interval = setInterval(() => { saveGame().catch(() => {}) }, 30_000)
    return () => clearInterval(interval)
  }, [authed])

  // Presence heartbeat loop: every 3s, send our position and receive ghosts
  useEffect(() => {
    if (!authed) return
    const sid = serverIdRef.current
    if (!sid) return

    let cancelled = false
    async function beat() {
      if (cancelled) return
      try {
        const getPos = (window as any).__nightfallGetPos as
          | (() => { x: number; y: number; z: number; yaw: number })
          | undefined
        const pos = getPos?.()
        if (!pos) return
        const body: any = {
          posX: pos.x,
          posY: pos.y,
          posZ: pos.z,
          yaw: pos.yaw,
        }
        if (guestIdRef.current) {
          body.guestId = guestIdRef.current
          body.guestName = guestNameRef.current
        }
        const r = await fetch(`/api/servers/${encodeURIComponent(sid!)}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) return
        const data = await r.json().catch(() => null) as
          | { players: GhostPlayer[]; total: number }
          | null
        if (!data) return
        const update = (window as any).__nightfallUpdateGhosts as
          | ((players: GhostPlayer[]) => void)
          | undefined
        if (update) update(data.players || [])
        setPlayerCount(typeof data.total === 'number' ? data.total : 1)
      } catch {
        // silent — presence is best-effort
      }
    }
    beat()
    const interval = setInterval(beat, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [authed])

  // Multiplayer world-state synchronization loop.  This is separate from the
  // slower presence heartbeat: it streams day/night time, authoritative enemy
  // snapshots, and discrete world events (trees/resources/structures/drops).
  useEffect(() => {
    if (!authed) return
    const sid = serverIdRef.current
    if (!sid) return
    let cancelled = false
    let busy = false

    async function syncWorld() {
      if (cancelled || busy) return
      const makePayload = (window as any).__nightfallWorldSyncPayload as undefined | (() => any)
      const applySync = (window as any).__nightfallApplyWorldSync as undefined | ((data: any) => void)
      if (!makePayload || !applySync) return
      busy = true
      try {
        const payload: any = makePayload()
        if (guestIdRef.current) {
          payload.guestId = guestIdRef.current
          payload.guestName = guestNameRef.current
        }
        const r = await fetch(`/api/servers/${encodeURIComponent(sid!)}/world`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (r.ok) applySync(await r.json().catch(() => null))
      } catch {
        // Best-effort.  The next tick will retry and the event queue will refill.
      } finally {
        busy = false
      }
    }

    syncWorld()
    const interval = setInterval(syncWorld, 900)
    return () => { cancelled = true; clearInterval(interval) }
  }, [authed])

  // Save + leave on page unload
  useEffect(() => {
    if (!authed) return
    const onUnload = () => {
      try {
        const state = useGame.getState()
        const save = (window as any).__nightfallSave?.() ?? {
          health: state.health, level: state.level, xp: state.xp, posX: 0, posY: 2, posZ: 0,
          timeOfDay: state.timeOfDay, equippedItem: state.equippedItem, offhandItem: state.offhandItem,
          inventory: state.inventory, structures: state.structures, deaths: state.deaths, zombiesKilled: state.zombiesKilled,
        }
        const sid = serverIdRef.current
        try { localStorage.setItem(`nightfall:offhand:${sid || 'default'}`, state.offhandItem || '') } catch {}
        const saveBody = { ...save, serverId: sid || undefined, guestId: guestIdRef.current || undefined, guestName: guestNameRef.current || undefined }
        navigator.sendBeacon?.('/api/save', new Blob([JSON.stringify(saveBody)], { type: 'application/json' }))
        if (sid) {
          const body: any = {}
          if (guestIdRef.current) {
            body.guestId = guestIdRef.current
            body.guestName = guestNameRef.current
          }
          navigator.sendBeacon?.(
            `/api/servers/${encodeURIComponent(sid)}/leave`,
            new Blob([JSON.stringify(body)], { type: 'application/json' })
          )
        }
      } catch {}
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [authed])

  async function saveGame() {
    const save = (window as any).__nightfallSave?.()
    if (!save) return
    const sid = serverIdRef.current
    try { localStorage.setItem(`nightfall:offhand:${sid || 'default'}`, save.offhandItem || '') } catch {}
    const body = {
      ...save,
      serverId: sid || undefined,
      guestId: guestIdRef.current || undefined,
      guestName: guestNameRef.current || undefined,
    }
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function leaveServer() {
    try { await saveGame() } catch {}
    const sid = serverIdRef.current
    if (sid) {
      try {
        const body: any = {}
        if (guestIdRef.current) {
          body.guestId = guestIdRef.current
          body.guestName = guestNameRef.current
        }
        await fetch(`/api/servers/${encodeURIComponent(sid)}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {}
    }
    try {
      localStorage.removeItem('nightfall:serverId')
      localStorage.removeItem('nightfall:serverName')
    } catch {}
    router.replace('/servers')
  }

  // Hide cursor during active gameplay, show it for menus / paused / dead.
  // Also keep it visible while the intro overlay is up so the user can click.
  const hideCursor = !showIntro && (mode === 'play' || mode === 'build')

  if (!authed) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-white">
        <Loader2 className="w-6 h-6 animate-spin mr-3" /> Entering server...
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 bg-black overflow-hidden select-none ${
        hideCursor ? 'cursor-none' : 'cursor-default'
      }`}
    >
      <GameCanvas />
      {loaded && <Hud />}
      {loaded && mode === 'play' && <KeysGuide />}
      {mode === 'inventory' && <InventoryPanel />}
      {mode === 'crafting' && <CraftingPanel />}
      {mode === 'build' && <BuildPanel />}
      {mode === 'paused' && <PausePanel onSave={saveGame} onLeaveServer={leaveServer} />}
      {mode === 'dead' && (
        <DeathPanel onRespawn={() => {
          const usedBed = typeof window !== 'undefined' ? (window as any).__nightfallRespawn?.() : false
          respawn()
          showToast(usedBed ? 'You wake at your bed.' : 'You rise again at the original camp.')
        }} />
      )}

      {/* Server/player indicator (top-left, opposite the level bar) */}
      {loaded && (mode === 'play' || mode === 'build') && (
        <div className="absolute top-3 left-3 z-40 flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/60 text-white backdrop-blur-sm border border-white/10 font-mono">
            <Users className="w-3.5 h-3.5 text-amber-400" />
            <span className="truncate max-w-[160px]">{serverName}</span>
            <span className="text-zinc-400">·</span>
            <span className="text-amber-300">{playerCount}</span>
          </div>
        </div>
      )}

      {/* Click-to-play initial overlay */}
      {showIntro && loaded && mode === 'play' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-pointer z-50"
          onClick={() => {
            setShowIntro(false)
            // Request pointer lock right now — this click is a user gesture.
            try { (window as any).__nightfallRequestLock?.() } catch {}
          }}
        >
          <div className="text-center text-white max-w-md px-6">
            <h2 className="font-display text-4xl font-extrabold mb-3">Click to Begin</h2>
            <p className="text-zinc-400 text-sm mb-4">
              Survive the night. Press <kbd className="kbd">Esc</kbd> to pause at any time.
            </p>
            <div className="text-xs font-mono text-zinc-500 space-y-1">
              <div>WASD / Arrows to walk &middot; Mouse to look &middot; Space to jump</div>
              <div>LMB / RMB / F to attack &middot; Shift to sprint &middot; E to pick up</div>
              <div>I = Inventory &middot; C = Crafting &middot; B = Build</div>
            </div>
            <div className="mt-5 text-[11px] text-zinc-500 font-mono">
              Server: <span className="text-amber-300">{serverName}</span>
            </div>
          </div>
          <style jsx>{`
            .kbd { display: inline-block; padding: 1px 6px; border: 1px solid rgba(255,255,255,0.2); border-bottom-width: 2px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #fff; font-size: 11px; }
          `}</style>
        </div>
      )}
    </div>
  )
}
