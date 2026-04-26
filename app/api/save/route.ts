import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

function slotFor(identity: Awaited<ReturnType<typeof getIdentity>>, serverId: string | null): string {
  if (!serverId) return 'default'
  if (!identity) return `default_server_${serverId}`
  if (identity.kind === 'user') return `user_${identity.userId}_server_${serverId}`
  return `guest_${identity.guestId}_server_${serverId}`
}

async function parseBody(req: Request): Promise<any> {
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await req.json()
    const t = await req.text()
    if (!t) return {}
    return JSON.parse(t)
  } catch {
    return {}
  }
}

function getServerIdFrom(req: Request, body?: any): string | null {
  const fromBody = body?.serverId
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim()
  try {
    const url = new URL(req.url)
    const s = url.searchParams.get('serverId')
    if (s && s.trim()) return s.trim()
  } catch {}
  return null
}

export async function GET(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(null)
    }

    const identity = await getIdentity(req)
    const serverId = getServerIdFrom(req)
    const slot = slotFor(identity, serverId)

    let save: any = null
    try {
      save = await prisma.playerSave.findUnique({ where: { slot } })
    } catch (error) {
      console.warn('Nightfall save GET: database unavailable, falling back to null', error)
      return NextResponse.json(null)
    }

    if (!save) return NextResponse.json(null)
    return NextResponse.json({
      health: save.health,
      level: save.level,
      xp: save.xp,
      posX: save.posX,
      posY: save.posY,
      posZ: save.posZ,
      timeOfDay: save.timeOfDay,
      equippedItem: save.equippedItem,
      offhandItem: save.offhandItem,
      torchDurability: save.torchDurability,
      hasReceivedStarterTorch: save.hasReceivedStarterTorch,
      inventoryJson: save.inventoryJson,
      structuresJson: save.structuresJson,
      deaths: save.deaths,
      zombiesKilled: save.zombiesKilled,
    })
  } catch {
    return NextResponse.json(null)
  }
}

export async function POST(req: Request) {
  try {
    const body = await parseBody(req)
    const identity = await getIdentity(req, body)
    const serverId = getServerIdFrom(req, body)

    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: true, persisted: false, reason: 'database_unavailable' })
    }

    const slot = slotFor(identity, serverId)
    const userId = identity?.kind === 'user' ? identity.userId : null
    const data = {
      health: Math.max(0, Math.min(100, Math.floor(body?.health ?? 100))),
      level: Math.max(1, Math.floor(body?.level ?? 1)),
      xp: Math.max(0, Math.floor(body?.xp ?? 0)),
      posX: Number(body?.posX ?? 0),
      posY: Number(body?.posY ?? 2),
      posZ: Number(body?.posZ ?? 0),
      timeOfDay: Number(body?.timeOfDay ?? 0.25),
      equippedItem: typeof body?.equippedItem === 'string' ? body.equippedItem : null,
      offhandItem: typeof body?.offhandItem === 'string' ? body.offhandItem : null,
      torchDurability: Math.max(0, Number(body?.torchDurability ?? 0)),
      hasReceivedStarterTorch: Boolean(body?.hasReceivedStarterTorch),
      inventoryJson: JSON.stringify(body?.inventory ?? []),
      structuresJson: JSON.stringify(body?.structures ?? []),
      deaths: Math.max(0, Math.floor(body?.deaths ?? 0)),
      zombiesKilled: Math.max(0, Math.floor(body?.zombiesKilled ?? 0)),
      serverId,
    }

    try {
      const save = await prisma.playerSave.upsert({
        where: { slot },
        create: { slot, userId, ...data },
        update: { ...data, userId },
      })
      return NextResponse.json({ ok: true, id: save.id, persisted: true })
    } catch (error) {
      console.warn('Nightfall save POST: database write failed, keeping gameplay running', error)
      return NextResponse.json({ ok: true, persisted: false, reason: 'database_unavailable' })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: true, deleted: false, reason: 'database_unavailable' })
    }

    const identity = await getIdentity(req)
    const serverId = getServerIdFrom(req)
    const slot = slotFor(identity, serverId)

    try {
      await prisma.playerSave.deleteMany({ where: { slot } })
      return NextResponse.json({ ok: true, deleted: true })
    } catch (error) {
      console.warn('Nightfall save DELETE: database unavailable', error)
      return NextResponse.json({ ok: true, deleted: false, reason: 'database_unavailable' })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 400 })
  }
}
