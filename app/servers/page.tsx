'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  Skull, Swords, Lock, Globe, Users, Plus, X, UserPlus, Trash2, LogOut,
  User, RefreshCw, Copy, Check, Info,
} from 'lucide-react'

type PublicServer = {
  id: string
  slotNumber: number | null
  name: string
  isPrivate: false
  maxPlayers: number
  playerCount: number
}
type FriendChip = { kind: 'user' | 'guest'; name: string; id: string }
type PrivateServer = {
  id: string
  slotNumber: number | null
  name: string
  isPrivate: true
  maxPlayers: number
  playerCount: number
  isOwner: boolean
  ownerUsername: string | null
  ownerGuest?: boolean
  friends: FriendChip[]
}
type ServerList = { public: PublicServer[]; private: PrivateServer[] }

// Helper: read or create the stable guest identity stored in localStorage.
function readOrCreateGuest(): { guestId: string; guestName: string } | null {
  if (typeof window === 'undefined') return null
  try {
    let guestId = window.localStorage.getItem('nightfall:guestId')
    if (!guestId || !/^g_[A-Za-z0-9_-]{4,30}$/.test(guestId)) {
      guestId = 'g_' + Math.random().toString(36).slice(2, 12)
      window.localStorage.setItem('nightfall:guestId', guestId)
    }
    let guestName = window.localStorage.getItem('nightfall:guestName')
    if (!guestName) {
      guestName = 'Guest_' + Math.floor(1000 + Math.random() * 9000)
      window.localStorage.setItem('nightfall:guestName', guestName)
    }
    return { guestId, guestName }
  } catch {
    return null
  }
}

export default function ServersPage() {
  const { data: session, status } = useSession() || {}
  const router = useRouter()
  const [isGuest, setIsGuest] = useState(false)
  const [guestId, setGuestId] = useState<string | null>(null)
  const [guestName, setGuestName] = useState<string | null>(null)
  const [list, setList] = useState<ServerList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingServer, setEditingServer] = useState<PrivateServer | null>(null)
  const [copied, setCopied] = useState(false)

  // Auth gate
  useEffect(() => {
    if (status === 'loading') return
    try {
      const g = window.localStorage.getItem('nightfall:guest') === '1'
      setIsGuest(g)
      if (!session && !g) {
        router.replace('/')
        return
      }
      if (!session && g) {
        // Ensure guest has a stable identity
        const ident = readOrCreateGuest()
        if (ident) {
          setGuestId(ident.guestId)
          setGuestName(ident.guestName)
        }
      }
    } catch {}
  }, [status, session, router])

  // Helper to attach guest identity to a fetch URL / body.
  const withGuestQuery = useCallback((url: string) => {
    if (session || !guestId) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}guestId=${encodeURIComponent(guestId)}`
  }, [session, guestId])

  const guestBody = useCallback(<T extends object>(body: T): T & { guestId?: string; guestName?: string } => {
    if (session || !guestId) return body
    return { ...body, guestId, guestName: guestName ?? undefined }
  }, [session, guestId, guestName])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(withGuestQuery('/api/servers'))
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load servers')
      setList(data)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }, [withGuestQuery])

  useEffect(() => {
    // Only start polling once we know if this is a guest (so guestId is set)
    if (status === 'loading') return
    if (!session && !isGuest) return
    if (!session && isGuest && !guestId) return
    refresh()
    const iv = setInterval(refresh, 5000)
    return () => clearInterval(iv)
  }, [refresh, status, session, isGuest, guestId])

  async function join(serverId: string) {
    setError(null)
    try {
      let identPayload: { guestId?: string; guestName?: string } = {}
      if (!session) {
        const ident = readOrCreateGuest()
        if (ident) identPayload = ident
      }
      const res = await fetch(`/api/servers/${serverId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identPayload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Could not join server')
        return
      }
      try {
        window.localStorage.setItem('nightfall:serverId', serverId)
        window.localStorage.setItem('nightfall:serverName', data?.server?.name ?? 'Server')
      } catch {}
      router.push('/play')
    } catch (e: any) {
      setError(e?.message ?? 'Could not join')
    }
  }

  async function deleteServer(s: PrivateServer) {
    if (!confirm(`Delete "${s.name}"? This kicks everyone.`)) return
    // DELETE with body so guests can include their identity
    const res = await fetch(`/api/servers/${s.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestBody({})),
    })
    if (res.ok) refresh()
    else {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Delete failed')
    }
  }

  function logoutGuest() {
    try { window.localStorage.removeItem('nightfall:guest') } catch {}
    router.replace('/')
  }

  async function copyInviteCode() {
    if (!guestId) return
    try {
      await navigator.clipboard.writeText(guestId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback
      const el = document.createElement('textarea')
      el.value = guestId
      document.body.appendChild(el); el.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
      document.body.removeChild(el)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-zinc-300">
        <div className="flex items-center gap-3">
          <Skull className="w-6 h-6 text-red-500 animate-pulse" />
          Loading servers...
        </div>
      </main>
    )
  }

  const displayName = session?.user?.name || guestName || 'Guest'

  return (
    <main className="min-h-screen relative bg-[#0a0a0f] text-white">
      <div
        className="absolute inset-0 opacity-50 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120, 20, 30, 0.35), transparent 60%)',
        }}
      />
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Skull className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="font-display font-extrabold text-2xl md:text-3xl">Server Browser</h1>
              <p className="text-xs text-zinc-500">Choose a world to survive in</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                {session ? 'Signed in' : 'Guest'}
              </div>
              <div className="flex items-center gap-1.5 font-semibold text-sm">
                {session ? <Swords className="w-3 h-3 text-emerald-400" /> : <User className="w-3 h-3 text-amber-400" />}
                {displayName}
              </div>
            </div>
            <button
              onClick={() => refresh()}
              className="p-2 rounded-md border border-white/10 bg-white/5 hover:bg-white/10"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => session ? signOut({ callbackUrl: '/' }) : logoutGuest()}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
            >
              <LogOut className="w-3 h-3" /> {session ? 'Sign out' : 'Exit'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-400 bg-red-950/30 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Guest invite-code banner — shown to guests so they can share their code. */}
        {!session && guestId && (
          <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-950/10 p-4 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-300 mb-1">Your Invite Code</div>
              <p className="text-xs text-zinc-400 mb-2">
                Share this code with friends so they can add you to their private servers. You can also host your own.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-black/60 border border-amber-500/30 rounded-md font-mono text-amber-200 text-sm break-all">
                  {guestId}
                </code>
                <button
                  onClick={copyInviteCode}
                  className="inline-flex items-center gap-1 px-3 py-2 bg-amber-600/80 hover:bg-amber-500 rounded-md text-sm font-semibold"
                >
                  {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Private servers */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              Private Servers
              <span className="text-xs text-zinc-500 font-normal">(friends only — free)</span>
            </h2>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600/80 hover:bg-emerald-500 rounded-md text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> Create Private Server
            </button>
          </div>
          {!list?.private.length ? (
            <div className="rounded-lg border border-white/10 bg-black/40 p-6 text-sm text-zinc-500 text-center">
              No private servers yet. Click <b>Create Private Server</b> to host one and invite friends.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {list.private.map((s) => (
                <PrivateServerCard
                  key={s.id}
                  s={s}
                  onJoin={() => join(s.id)}
                  onEdit={() => setEditingServer(s)}
                  onDelete={() => deleteServer(s)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Public servers */}
        <section>
          <h2 className="font-display font-bold text-lg flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-sky-400" />
            Public Servers
            <span className="text-xs text-zinc-500 font-normal">(50 slots · 100 players each)</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {list?.public.map((s) => <PublicServerCard key={s.id} s={s} onJoin={() => join(s.id)} />)}
          </div>
        </section>
      </div>

      {showCreate && (
        <CreateServerModal
          identBody={guestBody({})}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh() }}
        />
      )}
      {editingServer && (
        <EditFriendsModal
          server={editingServer}
          identBody={guestBody({})}
          onClose={() => setEditingServer(null)}
          onSaved={() => { setEditingServer(null); refresh() }}
        />
      )}
    </main>
  )
}

function PublicServerCard({ s, onJoin }: { s: PublicServer; onJoin: () => void }) {
  const full = s.playerCount >= s.maxPlayers
  const pct = Math.min(100, Math.round((s.playerCount / s.maxPlayers) * 100))
  return (
    <button
      onClick={onJoin}
      disabled={full}
      className="text-left rounded-md border border-white/10 bg-black/40 hover:border-red-500/40 hover:bg-red-950/20 disabled:opacity-40 disabled:cursor-not-allowed p-3 transition-all"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs text-zinc-500 font-mono">#{String(s.slotNumber ?? '?').padStart(2, '0')}</div>
        <div className={`flex items-center gap-1 text-xs ${full ? 'text-red-400' : 'text-emerald-400'}`}>
          <Users className="w-3 h-3" /> {s.playerCount}/{s.maxPlayers}
        </div>
      </div>
      <div className="font-semibold text-sm truncate">{s.name}</div>
      <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${full ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  )
}

function PrivateServerCard({
  s, onJoin, onEdit, onDelete,
}: {
  s: PrivateServer
  onJoin: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const full = s.playerCount >= s.maxPlayers
  return (
    <div className="rounded-lg border border-amber-500/20 bg-black/40 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <div className="font-semibold truncate">{s.name}</div>
          </div>
          <div className="text-xs text-zinc-500">
            {s.isOwner
              ? 'You own this server'
              : `Hosted by ${s.ownerUsername ?? 'unknown'}${s.ownerGuest ? ' (guest)' : ''}`}
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs ${full ? 'text-red-400' : 'text-emerald-400'}`}>
          <Users className="w-3 h-3" /> {s.playerCount}/{s.maxPlayers}
        </div>
      </div>
      {s.isOwner && s.friends.length > 0 && (
        <div className="text-xs text-zinc-400">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Friends allowed</div>
          <div className="flex flex-wrap gap-1">
            {s.friends.map((f) => (
              <span
                key={f.id + ':' + f.kind}
                title={f.kind === 'guest' ? `Guest invite code: ${f.id}` : `Username: ${f.name}`}
                className={
                  f.kind === 'guest'
                    ? 'px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-mono'
                    : 'px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs'
                }
              >
                {f.kind === 'guest' ? `👤 ${f.id.slice(0, 14)}${f.id.length > 14 ? '…' : ''}` : f.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={onJoin}
          disabled={full}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:opacity-50 text-white font-semibold rounded-md text-sm"
        >
          <Swords className="w-3.5 h-3.5" /> Join
        </button>
        {s.isOwner && (
          <>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 px-3 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-xs rounded-md"
            >
              <UserPlus className="w-3 h-3" /> Friends
            </button>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-3 py-2 bg-red-950/50 border border-red-900/50 hover:bg-red-900/50 text-xs rounded-md text-red-300"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CreateServerModal({
  identBody, onClose, onCreated,
}: {
  identBody: Record<string, any>
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [friendsInput, setFriendsInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const friends = friendsInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identBody, name: name.trim(), friends }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? 'Create failed'); return }
      if (data?.missing?.length) {
        setNotice(`Created! These entries were skipped (not found or invalid): ${data.missing.join(', ')}`)
        setTimeout(onCreated, 2500)
      } else {
        onCreated()
      }
    } catch (e: any) {
      setError(e?.message ?? 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-[#0f0f14] border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-xl flex items-center gap-2">
            <Lock className="w-5 h-5 text-amber-400" /> Create Private Server
          </h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-white/10 rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-1">Server Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
              className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-md text-white focus:outline-none focus:border-amber-500/60"
              placeholder="e.g. My Squad's World"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-1">
              Friends <span className="text-[10px] normal-case tracking-normal">(usernames OR guest invite codes, comma/space separated — optional)</span>
            </label>
            <textarea
              value={friendsInput}
              onChange={(e) => setFriendsInput(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-md text-white text-sm font-mono focus:outline-none focus:border-amber-500/60"
              placeholder="alice bob g_abc123xyz"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Paste friends’ usernames or their guest invite codes (begin with <code className="font-mono">g_</code>). Only listed friends (and you) can join.</p>
          </div>
          {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-500/30 rounded-md px-3 py-2">{error}</div>}
          {notice && <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-md px-3 py-2">{notice}</div>}
          <div className="flex items-center gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 rounded-md font-semibold text-sm">
              {busy ? 'Creating...' : 'Create Server'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function EditFriendsModal({
  server, identBody, onClose, onSaved,
}: {
  server: PrivateServer
  identBody: Record<string, any>
  onClose: () => void
  onSaved: () => void
}) {
  // Prefill with a mix of usernames and guest codes
  const initialValue = useMemo(() => server.friends.map((f) => f.kind === 'guest' ? f.id : f.name).join(', '), [server.friends])
  const [friendsInput, setFriendsInput] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const friends = friendsInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      const res = await fetch(`/api/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identBody, friends }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? 'Update failed'); return }
      if (data?.missing?.length) {
        setNotice(`Saved. Skipped entries: ${data.missing.join(', ')}`)
        setTimeout(onSaved, 2500)
      } else {
        onSaved()
      }
    } catch (e: any) {
      setError(e?.message ?? 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-[#0f0f14] border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-xl flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-amber-400" /> Manage Friends — {server.name}
          </h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-white/10 rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-1">Friends (usernames or guest codes)</label>
            <textarea
              value={friendsInput}
              onChange={(e) => setFriendsInput(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-md text-white text-sm font-mono focus:outline-none focus:border-amber-500/60"
              placeholder="alice bob g_abc123xyz"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Replaces the current list. Unknown usernames are skipped.</p>
          </div>
          {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-500/30 rounded-md px-3 py-2">{error}</div>}
          {notice && <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-md px-3 py-2">{notice}</div>}
          <div className="flex items-center gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 rounded-md font-semibold text-sm">
              {busy ? 'Saving...' : 'Save Friends'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
