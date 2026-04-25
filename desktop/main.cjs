const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('path')

const APP_NAME = 'Nightfall: Last Survivor'
const DEFAULT_DEV_URL = 'http://localhost:3000'

function configuredGameUrl() {
  const envUrl = process.env.NIGHTFALL_GAME_URL || process.env.NEXT_PUBLIC_GAME_URL
  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl
  try {
    const bundled = require('./game-url.json')
    if (bundled?.url && /^https?:\/\//i.test(bundled.url)) return bundled.url
  } catch {}
  const packagedUrl = app?.isPackaged ? null : DEFAULT_DEV_URL
  return packagedUrl
}

function createWindow() {
  const icon = path.join(__dirname, '..', 'public', 'branding', process.platform === 'win32' ? 'nightfall-icon.ico' : 'nightfall-icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    icon,
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  })

  win.setMenuBarVisibility(false)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const gameUrl = configuredGameUrl()
    if (!gameUrl) return
    const allowedOrigin = new URL(gameUrl).origin
    if (/^https?:\/\//i.test(url) && new URL(url).origin !== allowedOrigin) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  const gameUrl = configuredGameUrl()
  if (gameUrl) {
    win.loadURL(gameUrl)
  } else {
    win.loadFile(path.join(__dirname, 'no-server.html'))
  }

  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setName(APP_NAME)
    createWindow()
  }).catch(err => {
    dialog.showErrorBox(APP_NAME, String(err?.stack || err || 'Failed to start'))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
