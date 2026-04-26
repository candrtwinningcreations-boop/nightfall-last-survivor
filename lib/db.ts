import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaInitPromise: Promise<void> | null | undefined
  prismaInitCompleted: boolean | undefined
}

const MISSING_DB_ERROR =
  'Prisma client is not available because DATABASE_URL is missing. Add DATABASE_URL in your runtime environment.'

const REQUIRED_TABLES = ['User', 'PlayerSave', 'Server', 'ServerMember', 'ServerFriend']

function hasUsableDatabaseUrl() {
  const value = process.env.DATABASE_URL
  if (!value) return false

  const normalized = value.trim()
  if (!normalized) return false

  // Common placeholder values that should be treated as "not configured".
  if (
    normalized.includes('username:password') ||
    normalized.includes('user:password') ||
    normalized.includes('<') ||
    normalized.includes('YOUR_')
  ) {
    return false
  }

  return true
}

function createUnavailablePrismaProxy(path = 'prisma'): any {
  const throwMissingDbError = () => {
    throw new Error(MISSING_DB_ERROR)
  }

  return new Proxy(throwMissingDbError, {
    get(_target, property) {
      // Avoid Promise-like behavior checks from some libraries.
      if (property === 'then') return undefined
      if (property === Symbol.toStringTag) return 'PrismaClientUnavailableProxy'

      return createUnavailablePrismaProxy(`${path}.${String(property)}`)
    },
    apply() {
      throw new Error(`${MISSING_DB_ERROR} Attempted to call ${path}().`)
    },
    construct() {
      throw new Error(`${MISSING_DB_ERROR} Attempted to construct ${path}.`)
    },
  })
}

function getOrCreatePrismaClient(): PrismaClient {
  if (!hasUsableDatabaseUrl()) {
    throw new Error(MISSING_DB_ERROR)
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient()
  }

  return globalForPrisma.prisma
}

async function hasRequiredTables(client: PrismaClient): Promise<boolean> {
  try {
    const rows = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
    `

    const existing = new Set(rows.map((row) => row.table_name))
    return REQUIRED_TABLES.every((table) => existing.has(table))
  } catch (error) {
    throw new Error(
      `Failed while checking database tables: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

function runPrismaDbPush() {
  const result = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    const message = stderr || `prisma db push failed with exit code ${result.status ?? 'unknown'}`
    throw new Error(`Automatic database initialization failed: ${message}`)
  }
}

async function initializeDatabaseOnce(client: PrismaClient): Promise<void> {
  if (globalForPrisma.prismaInitCompleted) {
    return
  }

  if (!globalForPrisma.prismaInitPromise) {
    globalForPrisma.prismaInitPromise = (async () => {
      const tablesExist = await hasRequiredTables(client)
      if (!tablesExist) {
        runPrismaDbPush()

        const tablesAfterPush = await hasRequiredTables(client)
        if (!tablesAfterPush) {
          throw new Error('Automatic database initialization did not create required tables.')
        }
      }

      globalForPrisma.prismaInitCompleted = true
    })().catch((error) => {
      // Allow retries on the next access if initialization fails.
      globalForPrisma.prismaInitPromise = null
      throw error
    })
  }

  await globalForPrisma.prismaInitPromise
}

function shouldSkipInitForMethod(methodName: string) {
  return methodName === '$on' || methodName === '$use' || methodName === '$extends'
}

function wrapDelegateWithInit(delegate: any, client: PrismaClient) {
  return new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') {
        return value
      }

      return async (...args: unknown[]) => {
        await initializeDatabaseOnce(client)
        return value.apply(target, args)
      }
    },
  })
}

export function isDatabaseConfigured() {
  return hasUsableDatabaseUrl()
}

export function getPrismaClient(): PrismaClient {
  return getOrCreatePrismaClient()
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    if (!hasUsableDatabaseUrl()) {
      return (createUnavailablePrismaProxy() as any)[property]
    }

    const client = getOrCreatePrismaClient() as any
    const value = Reflect.get(client, property, client)

    if (typeof property === 'string' && property.startsWith('$') && typeof value === 'function') {
      if (shouldSkipInitForMethod(property)) {
        return value.bind(client)
      }

      return async (...args: unknown[]) => {
        await initializeDatabaseOnce(client)
        return value.apply(client, args)
      }
    }

    if (value && typeof value === 'object') {
      return wrapDelegateWithInit(value, client)
    }

    if (typeof value === 'function') {
      return async (...args: unknown[]) => {
        await initializeDatabaseOnce(client)
        return value.apply(client, args)
      }
    }

    return value
  },
}) as PrismaClient
