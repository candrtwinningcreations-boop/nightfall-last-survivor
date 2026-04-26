#!/usr/bin/env node

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')

const PORT = Number(process.env.SMOKE_PORT || 3110)
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

const REQUIRED_ROUTES = [
  { path: '/', expectedStatus: 200 },
  { path: '/play', expectedStatus: 200 },
  { path: '/servers', expectedStatus: 200 },
  { path: '/download', expectedStatus: 200 },
  { path: '/__route_smoke_not_found__', expectedStatus: 404 },
]

function requestStatus(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${pathname}`,
      { method: 'HEAD' },
      (res) => {
        resolve(res.statusCode || 0)
      }
    )

    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout requesting ${pathname}`))
    })
    req.end()
  })
}

async function waitUntilReady(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await requestStatus('/')
      if (status >= 200 && status < 500) return
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timed out waiting for Next server at ${BASE}`)
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 1500)

    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })

    try { child.kill('SIGTERM') } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

async function run() {
  const env = { ...process.env }

  const hasDefaultBuild = fs.existsSync(path.join(process.cwd(), '.next', 'BUILD_ID'))
  const hasCustomBuild = fs.existsSync(path.join(process.cwd(), '.build', 'BUILD_ID'))
  if (!env.NEXT_DIST_DIR && !hasDefaultBuild && hasCustomBuild) {
    env.NEXT_DIST_DIR = '.build'
  }

  const child = spawn('npm', ['start', '--', '-p', String(PORT)], {
    stdio: 'pipe',
    env,
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const childExit = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code))
  })

  try {
    await Promise.race([
      waitUntilReady(),
      childExit.then((code) => {
        throw new Error(`next start exited before becoming ready (code=${code})`)
      }),
    ])

    for (const route of REQUIRED_ROUTES) {
      const status = await requestStatus(route.path)
      if (status !== route.expectedStatus) {
        throw new Error(`Route ${route.path} returned ${status}, expected ${route.expectedStatus}`)
      }
      console.log(`✓ ${route.path} -> ${status}`)
    }

    console.log('\nRoute smoke test passed.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n\nServer output:\n${output}`)
  } finally {
    await stopChild(child)
  }

  return output
}

run().catch((error) => {
  console.error('\nRoute smoke test failed:', error.message)
  process.exitCode = 1
})
