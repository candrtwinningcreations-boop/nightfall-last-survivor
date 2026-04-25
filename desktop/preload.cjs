const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('nightfallDesktop', {
  platform: process.platform,
  appName: 'Nightfall: Last Survivor',
})
