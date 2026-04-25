import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const password = String(body?.password ?? '')
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Accept either a username or an email. If only email is provided we
    // derive a username from the local-part so the account still has a
    // valid in-game handle.
    const emailRaw = String(body?.email ?? '').trim().toLowerCase()
    let usernameRaw = String(body?.username ?? '').trim().toLowerCase()
    if (!usernameRaw && emailRaw) {
      usernameRaw = emailRaw.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20)
    }
    if (!usernameRaw) {
      return NextResponse.json({ error: 'Username or email required' }, { status: 400 })
    }
    // Pad short derived usernames so they pass the length rule.
    if (usernameRaw.length < 3) usernameRaw = (usernameRaw + '_user').slice(0, 20)
    if (!/^[a-z0-9_]{3,20}$/.test(usernameRaw)) {
      return NextResponse.json({ error: 'Username must be 3–20 chars: letters, numbers, underscore' }, { status: 400 })
    }

    // Uniqueness checks
    const existing = await prisma.user.findUnique({ where: { username: usernameRaw } })
    if (existing) {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 })
    }
    if (emailRaw) {
      const emailTaken = await prisma.user.findFirst({ where: { email: emailRaw } })
      if (emailTaken) {
        return NextResponse.json({ error: 'That email is already in use' }, { status: 409 })
      }
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { username: usernameRaw, passwordHash, email: emailRaw || null },
    })
    return NextResponse.json({ ok: true, userId: user.id, username: user.username })
  } catch (e: any) {
    console.error('signup failed', e)
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 })
  }
}
