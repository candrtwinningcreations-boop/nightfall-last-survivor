import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

const DAY_LENGTH_SEC = 10 * 60
const NIGHT_LENGTH_SEC = 15 * 60
const AUTHORITY_TTL_MS = 5_000
const MAX_EVENTS = 800

type StoredWorldEvent = { revision: number; id: string; type: string; payload: any; at: number }
type StoredWorld = {
  revision: number
  createdAt: number
  authorityId: string | null
  authorityUntil: number
  events: StoredWorldEvent[]
  snapshot: { entities: any[] } | null
}

function defaultWorld(): StoredWorld {
  return {
    revision: 0,
    createdAt: Date.now(),
    authorityId: null,
    authorityUntil: 0,
    events: [],
    snapshot: { entities: [] },
  }
}

function parseWorld(raw: string | null | undefined): StoredWorld {
  if (!raw) return defaultWorld()
  try {
    const parsed = JSON.parse(raw)
    return {
      ...defaultWorld(),
      ...parsed,
      events: Array.isArray(parsed?.events) ? parsed.events : [],
      snapshot: parsed?.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : { entities: [] },
    }
  } catch {
    return defaultWorld()
  }
}

function timeOfDayFor(createdAt: number, now = Date.now()) {
  const daySpan = 0.6
  const nightSpan = 0.4
  const dayMs = DAY_LENGTH_SEC * 1000
  const nightMs = NIGHT_LENGTH_SEC * 1000
  const cycleMs = dayMs + nightMs
  const age = ((now - createdAt) % cycleMs + cycleMs) % cycleMs
  if (age < dayMs) return 0.2 + (age / dayMs) * daySpan
  return (0.8 + ((age - dayMs) / nightMs) * nightSpan) % 1
}

async function assertAllowed(req: Request, body: any, serverId: string) {
  const identity = await getIdentity(req, body)
  if (!identity) return { error: NextResponse.json({ error: 'Identity required' }, { status: 401 }) }

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { friends: { select: { friendKey: true } } },
  })
  if (!server) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  if (server.isPrivate) {
    const isOwner =
      (identity.kind === 'user' && server.ownerId === identity.userId) ||
      (identity.kind === 'guest' && server.ownerGuestId === identity.guestId)
    const isFriend = server.friends.some((f: (typeof server.friends)[number]) => f.friendKey === identity.key)
    if (!isOwner && !isFriend) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { identity }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}))
    const allowed = await assertAllowed(req, body, params.id)
    if ('error' in allowed) return allowed.error

    const clientId = String(body?.clientId || allowed.identity.key)
    const sinceRevision = Number(body?.sinceRevision || 0)
    const slot = `world_server_${params.id}`
    const now = Date.now()

    const save = await prisma.playerSave.upsert({
      where: { slot },
      create: {
        slot,
        serverId: params.id,
        inventoryJson: JSON.stringify(defaultWorld()),
        timeOfDay: 0.25,
      },
      update: {},
    })

    const world = parseWorld(save.inventoryJson)
    if (!world.createdAt) world.createdAt = now

    if (!world.authorityId || world.authorityUntil < now || world.authorityId === clientId) {
      world.authorityId = clientId
      world.authorityUntil = now + AUTHORITY_TTL_MS
    }
    const isAuthority = world.authorityId === clientId

    const incomingEvents = Array.isArray(body?.events) ? body.events : []
    const knownIds = new Set(world.events.map((e) => e.id))
    for (const evt of incomingEvents) {
      if (!evt || typeof evt.id !== 'string' || knownIds.has(evt.id)) continue
      if (typeof evt.type !== 'string') continue
      world.revision += 1
      world.events.push({ revision: world.revision, id: evt.id, type: evt.type, payload: evt.payload ?? {}, at: now })
      knownIds.add(evt.id)
    }

    if (isAuthority && body?.snapshot && typeof body.snapshot === 'object') {
      world.snapshot = {
        entities: Array.isArray(body.snapshot.entities) ? body.snapshot.entities.slice(0, 80) : [],
      }
    }

    if (world.events.length > MAX_EVENTS) world.events = world.events.slice(world.events.length - MAX_EVENTS)
    const timeOfDay = timeOfDayFor(world.createdAt, now)

    await prisma.playerSave.update({
      where: { slot },
      data: {
        inventoryJson: JSON.stringify(world),
        timeOfDay,
      },
    })

    return NextResponse.json({
      ok: true,
      revision: world.revision,
      authorityId: world.authorityId,
      authorityUntil: world.authorityUntil,
      timeOfDay,
      events: world.events.filter((e) => e.revision > sinceRevision),
      snapshot: world.snapshot ?? { entities: [] },
    })
  } catch (e) {
    console.error('world sync failed', e)
    return NextResponse.json({ error: 'world_sync_failed' }, { status: 500 })
  }
}
