export {}

export interface BootInfo {
  wsPort: number
  settings: { logsDir: string; maxSegments: number }
  logsDirExists: boolean
}

declare global {
  interface Window {
    api?: {
      getBootInfo: () => Promise<BootInfo>
      pickLogsDir: () => Promise<string | null>
    }
  }
}
