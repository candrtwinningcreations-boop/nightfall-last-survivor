import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

const HEARTBEAT_TTL_SEC = 15

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      posX?: number; posY?: number; posZ?: number; yaw?: number;
      guestId?: string; guestName?: string
    }

    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: true, offline: true, total: 1, players: [] })
    }

    const posX = Number(body?.posX ?? 0)
    const posY = Number(body?.posY ?? 2)
    const posZ = Number(body?.posZ ?? 0)
    const yaw = Number(body?.yaw ?? 0)

    const identity = await getIdentity(req, body)
    const cutoff = new Date(Date.now() - HEARTBEAT_TTL_SEC * 1000)

    if (Math.random() < 0.1) {
      try {
        await prisma.serverMember.deleteMany({
          where: { lastSeen: { lt: cutoff } },
        })
      } catch (error) {
        console.warn('Nightfall presence: stale membership cleanup failed', error)
      }
    }

    if (identity) {
      let server: any = null
      try {
        server = await prisma.server.findUnique({
          where: { id: params.id },
          include: { friends: { select: { friendKey: true } } },
        })
      } catch (error) {
        console.warn('Nightfall presence: failed to read server authorization data', error)
        return NextResponse.json({ ok: true, offline: true, total: 1, players: [] })
      }

      if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      if (server.isPrivate) {
        const isOwner =
          (identity.kind === 'user' && server.ownerId === identity.userId) ||
          (identity.kind === 'guest' && server.ownerGuestId === identity.guestId)
        const isFriend = server.friends.some((f: (typeof server.friends)[number]) => f.friendKey === identity.key)
        if (!isOwner && !isFriend) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 })
        }
      }

      const now = new Date()
      try {
        if (identity.kind === 'user') {
          await prisma.serverMember.upsert({
            where: { serverId_memberKey: { serverId: params.id, memberKey: identity.key } },
            create: {
              serverId: params.id,
              memberKey: identity.key,
              userId: identity.userId,
              lastSeen: now,
              posX, posY, posZ, yaw,
            },
            update: {
              lastSeen: now,
              userId: identity.userId,
              posX, posY, posZ, yaw,
            },
          })
        } else {
          await prisma.serverMember.upsert({
            where: { serverId_memberKey: { serverId: params.id, memberKey: identity.key } },
            create: {
              serverId: params.id,
              memberKey: identity.key,
              guestId: identity.guestId,
              guestName: identity.guestName,
              lastSeen: now,
              posX, posY, posZ, yaw,
            },
            update: {
              lastSeen: now,
              guestId: identity.guestId,
              guestName: identity.guestName,
              posX, posY, posZ, yaw,
            },
          })
        }
      } catch (error) {
        console.warn('Nightfall presence: heartbeat write failed', error)
        return NextResponse.json({ ok: true, offline: true, total: 1, players: [] })
      }
    }

    try {
      const others = await prisma.serverMember.findMany({
        where: {
          serverId: params.id,
          lastSeen: { gte: cutoff },
          ...(identity ? { NOT: { memberKey: identity.key } } : {}),
        },
        include: { user: { select: { username: true } } },
        take: 100,
      })

      const total = await prisma.serverMember.count({
        where: { serverId: params.id, lastSeen: { gte: cutoff } },
      })

      return NextResponse.json({
        ok: true,
        total: total + (identity ? 0 : 1),
        players: others.map((m: (typeof others)[number]) => ({
          id: m.memberKey,
          name: m.user?.username ?? m.guestName ?? 'Guest',
          posX: m.posX,
          posY: m.posY,
          posZ: m.posZ,
          yaw: m.yaw,
        })),
      })
    } catch (error) {
      console.warn('Nightfall presence: failed to fetch active players', error)
      return NextResponse.json({ ok: true, offline: true, total: 1, players: [] })
    }
  } catch (e) {
    console.error('presence failed', e)
    return NextResponse.json({ error: 'presence_failed' }, { status: 500 })
  }
}
