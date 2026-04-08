import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { getSettings, setSetting, type WindowBounds } from './settings.js'
import { Backend } from './backend.js'

// FORCE_PROD=1 lets you smoke-test the production load path against
// client/dist without spinning up the Vite dev server.
const isDev = !app.isPackaged && process.env.FORCE_PROD !== '1'

// Single-instance lock — second launch focuses the existing window
// instead of spawning a duplicate watcher on the same log file.
// `app.quit()` is async, so we MUST short-circuit module evaluation here
// or the duplicate process keeps going and grabs a second WS port + watcher
// before exiting.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
const backend = new Backend()

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Require ~50px of horizontal overlap with a real display work area, plus
// the title bar fully on-screen. Catches the cases where the saved window
// has its top-left technically inside a display but its body off-screen
// (e.g. unplugged second monitor, or window dragged mostly off the right edge).
function pickInitialBounds(saved: WindowBounds): WindowBounds {
  const { width, height, x, y } = saved
  if (x === undefined || y === undefined) return { width, height }

  const TITLE_BAR_GRAB_PX = 50
  const TITLE_BAR_HEIGHT = 24
  const onscreen = screen.getAllDisplays().some(d => {
    const wa = d.workArea
    const xOverlap = Math.min(x + width, wa.x + wa.width) - Math.max(x, wa.x)
    return xOverlap >= TITLE_BAR_GRAB_PX
        && y >= wa.y
        && y <= wa.y + wa.height - TITLE_BAR_HEIGHT
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
    title: 'APEMeters',
    icon: path.join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (settings.windowMaximized) mainWindow.maximize()

  // Disable pinch-to-zoom AND Ctrl+/Ctrl-/Ctrl+0 keyboard zoom.
  // setVisualZoomLevelLimits only handles pinch — keyboard shortcuts need
  // a before-input-event interceptor.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.control || input.meta)) return
    // Plus, equal (= unshifted), minus, and zero — covers all keyboard layouts
    // where Ctrl+= acts as Ctrl++.
    if (input.key === '+' || input.key === '=' || input.key === '-' || input.key === '0') {
      event.preventDefault()
    }
  })

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

  // Persist window bounds on close. Use getNormalBounds() so a maximized
  // window doesn't restore at full-screen-but-not-maximized next launch.
  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setSetting('windowBounds', mainWindow.getNormalBounds())
    setSetting('windowMaximized', mainWindow.isMaximized())
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
  try {
    await backend.start()
  } catch (err) {
    dialog.showErrorBox(
      'APEMeters failed to start',
      err instanceof Error ? err.message : String(err),
    )
    app.quit()
    return
  }
  await createWindow()
})

app.on('window-all-closed', () => {
  backend.stop()
  app.quit()
})
