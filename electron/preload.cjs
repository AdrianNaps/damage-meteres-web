// Preload script. Must be CommonJS because the renderer is sandboxed
// (sandbox: true in webPreferences). Sandboxed preloads cannot use ESM.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getBootInfo: () => ipcRenderer.invoke('app:getBootInfo'),
  pickLogsDir: () => ipcRenderer.invoke('app:pickLogsDir'),
})
