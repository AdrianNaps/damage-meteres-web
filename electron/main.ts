import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { getSettings, setSetting, type WindowBounds } from './settings.js'
import { Backend } from './backend.js'

// FORCE_PROD=1 lets you smoke-test the production load path against
// client/dist without spinning up the Vite dev server.
const isDev = !app.isPackaged && process.env.FORCE_PROD !== '1'

let mainWindow: BrowserWindow | null = null
const backend = new Backend()

// Single-instance lock — second launch focuses the existing window
// instead of spawning a duplicate watcher on the same log file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function pickInitialBounds(saved: WindowBounds): WindowBounds {
  const { width, height, x, y } = saved
  if (x === undefined || y === undefined) return { width, height }

  // Drop saved x/y if they fall outside any current display work area
  // (handles unplugged second monitors).
  const onscreen = screen.getAllDisplays().some(d => {
    const wa = d.workArea
    return x >= wa.x && y >= wa.y && x < wa.x + wa.width && y < wa.y + wa.height
  })
  return onscreen ? { width, height, x, y } : { width, height }
}

async function createWindow() {
  const settings = getSettings()
  const bounds = pickInitialBounds(settings.windowBounds)

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0a0b0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Disable Ctrl+Plus/Minus/0 zoom — leaves users no visible recovery path.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // After build: dist-electron/electron/main.js  →  ../../client/dist/index.html
    await mainWindow.loadFile(path.join(__dirname, '../../client/dist/index.html'))
  }

  // External links open in the user's browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Persist window bounds on close
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      setSetting('windowBounds', mainWindow.getBounds())
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC: renderer asks for the ws port + current settings + logsDir health on startup
ipcMain.handle('app:getBootInfo', () => {
  const settings = getSettings()
  return {
    wsPort: backend.wsPort,
    settings: { logsDir: settings.logsDir, maxSegments: settings.maxSegments },
    logsDirExists: fs.existsSync(settings.logsDir),
  }
})

ipcMain.handle('app:pickLogsDir', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your WoW Logs folder',
    properties: ['openDirectory'],
    defaultPath: 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs',
  })
  if (result.canceled || !result.filePaths[0]) return null
  const dir = result.filePaths[0]
  setSetting('logsDir', dir)
  backend.setLogsDir(dir)   // hot-swap the watcher, no restart needed
  return dir
})

app.whenReady().then(async () => {
  await backend.start()
  await createWindow()
})

app.on('window-all-closed', () => {
  backend.stop()
  app.quit()
})
