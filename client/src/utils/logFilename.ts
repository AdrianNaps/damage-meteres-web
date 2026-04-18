// Parse the timestamp out of a WoW combat-log filename like
// `WoWCombatLog-041526_213812.txt`. Format is MMDDYY_HHMMSS — 2-digit year is
// assumed 20XX. Returns null for filenames that don't match the pattern.
const PATTERN = /^WoWCombatLog-(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.txt$/

export interface ParsedLogFilename {
  date: Date
}

export function parseLogFilename(name: string): ParsedLogFilename | null {
  const m = name.match(PATTERN)
  if (!m) return null
  const month = parseInt(m[1], 10)
  const day = parseInt(m[2], 10)
  const year = 2000 + parseInt(m[3], 10)
  const hour = parseInt(m[4], 10)
  const minute = parseInt(m[5], 10)
  const second = parseInt(m[6], 10)
  // Local time — WoW writes filenames in the user's local timezone, and we
  // render them in the same local time below. No timezone normalization.
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (isNaN(date.getTime())) return null
  return { date }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Apr 15 · 9:38 PM" — compact, eye-scannable. Year omitted; logs older than
// the current year are rare and the picker can grow a year suffix later if
// needed.
export function formatLogLabel(date: Date): string {
  const month = MONTHS[date.getMonth()]
  const day = date.getDate()
  let hour = date.getHours()
  const minute = date.getMinutes()
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12
  if (hour === 0) hour = 12
  return `${month} ${day} · ${hour}:${String(minute).padStart(2, '0')} ${ampm}`
}

// Format a byte count as KB/MB/GB. Used for size column in the LogPicker.
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
