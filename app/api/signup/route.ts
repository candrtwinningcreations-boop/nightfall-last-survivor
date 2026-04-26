import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isDatabaseConfigured, prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: 'Account signup is temporarily unavailable because database is not configured yet.' },
        { status: 503 }
      )
    }

    const body = await req.json()
    const password = String(body?.password ?? '')
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const emailRaw = String(body?.email ?? '').trim().toLowerCase()
    let usernameRaw = String(body?.username ?? '').trim().toLowerCase()
    if (!usernameRaw && emailRaw) {
      usernameRaw = emailRaw.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20)
    }
    if (!usernameRaw) {
      return NextResponse.json({ error: 'Username or email required' }, { status: 400 })
    }
    if (usernameRaw.length < 3) usernameRaw = (usernameRaw + '_user').slice(0, 20)
    if (!/^[a-z0-9_]{3,20}$/.test(usernameRaw)) {
      return NextResponse.json({ error: 'Username must be 3–20 chars: letters, numbers, underscore' }, { status: 400 })
    }

    let existing: any = null
    try {
      existing = await prisma.user.findUnique({ where: { username: usernameRaw } })
    } catch (error) {
      console.warn('Nightfall signup: failed checking existing username', error)
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 })
    }

    if (existing) {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 })
    }

    if (emailRaw) {
      try {
        const emailTaken = await prisma.user.findFirst({ where: { email: emailRaw } })
        if (emailTaken) {
          return NextResponse.json({ error: 'That email is already in use' }, { status: 409 })
        }
      } catch (error) {
        console.warn('Nightfall signup: failed checking existing email', error)
        return NextResponse.json({ error: 'database_unavailable' }, { status: 503 })
      }
    }

    const passwordHash = await bcrypt.hash(password, 10)
    try {
      const user = await prisma.user.create({
        data: { username: usernameRaw, passwordHash, email: emailRaw || null },
      })
      return NextResponse.json({ ok: true, userId: user.id, username: user.username })
    } catch (error) {
      console.warn('Nightfall signup: failed creating user', error)
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 })
    }
  } catch (e: any) {
    console.error('signup failed', e)
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 })
  }
}
