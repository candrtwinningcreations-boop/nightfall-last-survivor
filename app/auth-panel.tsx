'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Swords, UserPlus, User, LogOut, ShieldCheck } from 'lucide-react'

type Mode = 'menu' | 'login' | 'signup'

export function AuthPanel() {
  const { data: session, status } = useSession() || {}
  const [mode, setMode] = useState<Mode>('menu')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  // Detect whether the user already clicked "Continue as Guest" in this session.
  const [isGuest, setIsGuest] = useState(false)
  useEffect(() => {
    try { setIsGuest(window.localStorage.getItem('nightfall:guest') === '1') } catch {}
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const res = await signIn('credentials', {
        username: username.trim(),
        password,
        redirect: false,
      })
      if (res?.error) {
        setError('Wrong username or password')
      } else {
        try { window.localStorage.removeItem('nightfall:guest') } catch {}
        router.replace('/servers')
      }
    } catch {
      setError('Sign-in failed, try again')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Signup failed')
        return
      }
      // Auto-login after signup
      const login = await signIn('credentials', {
        username: username.trim(),
        password,
        redirect: false,
      })
      if (login?.error) {
        setError('Account created but sign-in failed. Try logging in.')
        setMode('login')
      } else {
        try { window.localStorage.removeItem('nightfall:guest') } catch {}
        router.replace('/servers')
      }
    } catch {
      setError('Signup failed, try again')
    } finally {
      setBusy(false)
    }
  }

  function continueAsGuest() {
    try { window.localStorage.setItem('nightfall:guest', '1') } catch {}
    setIsGuest(true)
    router.replace('/servers')
  }

  // LOGGED IN — show continue button + sign out
  if (status === 'authenticated' && session?.user) {
    const uname = (session.user as any).name || 'Survivor'
    return (
      <div className="mt-10 w-full max-w-md rounded-xl border border-red-500/30 bg-black/60 backdrop-blur-md p-6 shadow-[0_0_50px_-20px_rgba(220,38,38,0.8)]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-xs uppercase tracking-widest text-zinc-500">Signed in as</div>
              <div className="font-display font-bold text-lg text-white">{uname}</div>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
          >
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
        <button
          onClick={() => router.push('/servers')}
          className="w-full group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-md shadow-[0_0_40px_-10px_rgba(220,38,38,0.8)] transition-all hover:shadow-[0_0_60px_-10px_rgba(220,38,38,1)]"
        >
          <Swords className="w-5 h-5" />
          Choose Server
        </button>
        <p className="text-xs text-zinc-500 mt-3 text-center">
          Your progress saves automatically to your account.
        </p>
      </div>
    )
  }

  // GUEST already selected — short "continue" panel
  if (isGuest && status !== 'loading') {
    return (
      <div className="mt-10 w-full max-w-md rounded-xl border border-amber-500/30 bg-black/60 backdrop-blur-md p-6">
        <div className="text-xs uppercase tracking-widest text-amber-400/80 mb-2">Playing as Guest</div>
        <p className="text-sm text-zinc-400 mb-4">
          Your progress is saved locally in this browser only. Sign up to play on any device and save your character.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => router.push('/servers')}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-md"
          >
            <Swords className="w-4 h-4" /> Continue
          </button>
          <button
            onClick={() => { try { window.localStorage.removeItem('nightfall:guest') } catch {}; setIsGuest(false); setMode('signup') }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold uppercase tracking-widest rounded-md text-sm"
          >
            Create Account
          </button>
        </div>
      </div>
    )
  }

  // UNAUTHED MENU — 3 buttons
  if (mode === 'menu') {
    return (
      <div className="mt-10 w-full max-w-md rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-6 shadow-[0_0_60px_-20px_rgba(220,38,38,0.6)]">
        <h2 className="font-display font-bold text-xl mb-4 text-center">Begin Your Survival</h2>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => { setMode('login'); setError(null) }}
            className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-md"
          >
            <Swords className="w-5 h-5" /> Sign In
          </button>
          <button
            onClick={() => { setMode('signup'); setError(null) }}
            className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold uppercase tracking-widest rounded-md"
          >
            <UserPlus className="w-5 h-5" /> Create Account
          </button>
          <button
            onClick={continueAsGuest}
            className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-transparent border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white font-semibold uppercase tracking-widest rounded-md text-sm"
          >
            <User className="w-4 h-4" /> Continue as Guest
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-4 text-center leading-relaxed">
          Accounts sync your progress across devices.<br />Guest mode saves to this browser only.
        </p>
      </div>
    )
  }

  // LOGIN / SIGNUP FORM
  const isSignup = mode === 'signup'
  return (
    <form
      onSubmit={isSignup ? handleSignup : handleLogin}
      className="mt-10 w-full max-w-md rounded-xl border border-red-500/30 bg-black/60 backdrop-blur-md p-6 shadow-[0_0_60px_-20px_rgba(220,38,38,0.6)]"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-xl">
          {isSignup ? 'Create Survivor Account' : 'Welcome Back, Survivor'}
        </h2>
        <button
          type="button"
          onClick={() => { setMode('menu'); setError(null) }}
          className="text-xs text-zinc-400 hover:text-white"
        >
          &larr; Back
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={20}
            className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-md text-white placeholder-zinc-600 focus:outline-none focus:border-red-500/60"
            placeholder="your_name"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={6}
            className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-md text-white placeholder-zinc-600 focus:outline-none focus:border-red-500/60"
            placeholder="••••••"
          />
        </div>
        {error && (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-zinc-400 text-white font-bold uppercase tracking-widest rounded-md"
        >
          {busy ? 'Please wait…' : (isSignup ? <><UserPlus className="w-5 h-5" /> Create & Play</> : <><Swords className="w-5 h-5" /> Sign In</>)}
        </button>
        <button
          type="button"
          onClick={() => setMode(isSignup ? 'login' : 'signup')}
          className="w-full text-xs text-zinc-400 hover:text-white py-1"
        >
          {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
        </button>
      </div>
    </form>
  )
}
