import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prisma, isDatabaseConfigured } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const REQUIRED_TABLES = ['User', 'PlayerSave', 'Server', 'ServerMember', 'ServerFriend'] as const

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  return null
}

function isAllowedIp(request: NextRequest) {
  const allowedIpsRaw = process.env.SETUP_DB_ALLOWED_IPS?.trim()

  // Basic IP-based protection: if allowlist is provided, caller must match it.
  if (!allowedIpsRaw) {
    // No allowlist configured:
    // - in production, require a detectable client IP
    // - in non-production, allow local testing even when proxy IP headers are absent
    if (process.env.NODE_ENV !== 'production') return true
    return getClientIp(request) !== null
  }

  const clientIp = getClientIp(request)
  if (!clientIp) return false

  const allowedIps = allowedIpsRaw
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean)

  return allowedIps.includes(clientIp)
}

async function hasAnyAppTables() {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${REQUIRED_TABLES})
    LIMIT 1
  `

  return rows.length > 0
}

async function runPrismaDbPush() {
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'

  return execFileAsync(npxBin, ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 90_000,
    maxBuffer: 1024 * 1024 * 8,
  })
}

export async function GET(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'DATABASE_URL is missing or invalid in runtime environment.',
        },
        { status: 500 },
      )
    }

    if (!isAllowedIp(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Forbidden: IP check failed for setup endpoint.',
        },
        { status: 403 },
      )
    }

    const alreadyInitialized = await hasAnyAppTables()
    if (alreadyInitialized) {
      return NextResponse.json(
        {
          ok: true,
          alreadyInitialized: true,
          message: 'Database schema is already initialized. This endpoint only needs to run once.',
        },
        { status: 200 },
      )
    }

    const result = await runPrismaDbPush()

    const initialized = await hasAnyAppTables()
    if (!initialized) {
      return NextResponse.json(
        {
          ok: false,
          error: 'prisma db push completed, but expected tables were not detected.',
          output: result.stdout?.slice(0, 2000) ?? '',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      alreadyInitialized: false,
      message: 'Database schema initialized successfully via prisma db push.',
      output: result.stdout?.slice(0, 2000) ?? '',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown setup-db error'
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to initialize database schema.',
        details: message.slice(0, 3000),
      },
      { status: 500 },
    )
  }
}
