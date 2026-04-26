import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const MISSING_DB_ERROR =
  'Prisma client is not available because DATABASE_URL is missing. Add DATABASE_URL in your runtime environment.'

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

export function isDatabaseConfigured() {
  return hasUsableDatabaseUrl()
}

export function getPrismaClient(): PrismaClient {
  if (!hasUsableDatabaseUrl()) {
    throw new Error(MISSING_DB_ERROR)
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient()
  }

  return globalForPrisma.prisma
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    if (!hasUsableDatabaseUrl()) {
      return (createUnavailablePrismaProxy() as any)[property]
    }

    const client = getPrismaClient() as any
    const value = Reflect.get(client, property, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
}) as PrismaClient
