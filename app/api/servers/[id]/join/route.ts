import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

const HEARTBEAT_TTL_SEC = 15

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}))
    const identity = await getIdentity(req, body)
    if (!identity) {
      return NextResponse.json({ error: 'Identity required' }, { status: 401 })
    }

    if (!isDatabaseConfigured()) {
      return NextResponse.json({
        ok: true,
        offline: true,
        server: {
          id: params.id,
          slotNumber: 0,
          name: 'Offline (Local Guest Mode)',
          isPrivate: false,
          maxPlayers: 1,
        },
        identity: {
          kind: identity.kind,
          key: identity.key,
          name: identity.kind === 'user' ? identity.username : identity.guestName,
        },
      })
    }

    let server: any = null
    try {
      server = await prisma.server.findUnique({
        where: { id: params.id },
        include: {
          friends: { select: { userId: true, guestId: true, friendKey: true } },
        },
      })
    } catch (error) {
      console.warn('Nightfall join: server lookup failed, switching to offline mode', error)
      return NextResponse.json({
        ok: true,
        offline: true,
        server: {
          id: params.id,
          slotNumber: 0,
          name: 'Offline (Local Guest Mode)',
          isPrivate: false,
          maxPlayers: 1,
        },
        identity: {
          kind: identity.kind,
          key: identity.key,
          name: identity.kind === 'user' ? identity.username : identity.guestName,
        },
      })
    }

    if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    if (server.isPrivate) {
      const isOwner =
        (identity.kind === 'user' && server.ownerId === identity.userId) ||
        (identity.kind === 'guest' && server.ownerGuestId === identity.guestId)
      const isFriend = server.friends.some((f: (typeof server.friends)[number]) => f.friendKey === identity.key)
      if (!isOwner && !isFriend) {
        return NextResponse.json({ error: 'Not on friends list for this server' }, { status: 403 })
      }
    }

    try {
      const cutoff = new Date(Date.now() - HEARTBEAT_TTL_SEC * 1000)
      const currentCount = await prisma.serverMember.count({
        where: { serverId: server.id, lastSeen: { gte: cutoff } },
      })
      const alreadyIn = await prisma.serverMember.findUnique({
        where: { serverId_memberKey: { serverId: server.id, memberKey: identity.key } },
      })
      if (!alreadyIn && currentCount >= server.maxPlayers) {
        return NextResponse.json({ error: 'Server full' }, { status: 409 })
      }

      const now = new Date()
      if (identity.kind === 'user') {
        await prisma.serverMember.upsert({
          where: { serverId_memberKey: { serverId: server.id, memberKey: identity.key } },
          create: {
            serverId: server.id,
            memberKey: identity.key,
            userId: identity.userId,
            lastSeen: now,
          },
          update: { lastSeen: now, userId: identity.userId },
        })
      } else {
        await prisma.serverMember.upsert({
          where: { serverId_memberKey: { serverId: server.id, memberKey: identity.key } },
          create: {
            serverId: server.id,
            memberKey: identity.key,
            guestId: identity.guestId,
            guestName: identity.guestName,
            lastSeen: now,
          },
          update: {
            lastSeen: now,
            guestId: identity.guestId,
            guestName: identity.guestName,
          },
        })
      }
    } catch (error) {
      console.warn('Nightfall join: membership write failed, continuing in offline mode', error)
      return NextResponse.json({
        ok: true,
        offline: true,
        server: {
          id: params.id,
          slotNumber: 0,
          name: 'Offline (Local Guest Mode)',
          isPrivate: false,
          maxPlayers: 1,
        },
        identity: {
          kind: identity.kind,
          key: identity.key,
          name: identity.kind === 'user' ? identity.username : identity.guestName,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      server: {
        id: server.id,
        slotNumber: server.slotNumber,
        name: server.name,
        isPrivate: server.isPrivate,
        maxPlayers: server.maxPlayers,
      },
      identity: {
        kind: identity.kind,
        key: identity.key,
        name: identity.kind === 'user' ? identity.username : identity.guestName,
      },
    })
  } catch (e) {
    console.error('join failed', e)
    return NextResponse.json({ error: 'join_failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: true, offline: true })
    }

    let body: any = null
    try { body = await req.json() } catch {}
    const identity = await getIdentity(req, body)
    if (identity) {
      try {
        await prisma.serverMember.deleteMany({
          where: { serverId: params.id, memberKey: identity.key },
        })
      } catch (error) {
        console.warn('Nightfall leave (DELETE): database unavailable', error)
      }
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'leave_failed' }, { status: 500 })
  }
}
