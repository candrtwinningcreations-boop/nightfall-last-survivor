import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db'
import { getIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

async function parseBody(req: Request): Promise<any> {
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) return await req.json()
    const text = await req.text()
    if (!text) return {}
    try { return JSON.parse(text) } catch { return {} }
  } catch {
    return {}
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: true, offline: true })
    }

    const body = await parseBody(req)
    const identity = await getIdentity(req, body)
    if (identity) {
      try {
        await prisma.serverMember.deleteMany({
          where: { serverId: params.id, memberKey: identity.key },
        })
      } catch (error) {
        console.warn('Nightfall leave: membership delete failed', error)
      }
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'leave_failed' }, { status: 500 })
  }
}
