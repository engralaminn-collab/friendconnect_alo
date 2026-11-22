// Frontend API helpers — all return parsed JSON.

export async function apiPost(path: string, body?: any, init?: RequestInit) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  })
  return res
}

export async function apiJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return null as any
  return res.json() as Promise<T>
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d`
  return d.toLocaleDateString()
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = typeof a === "string" ? new Date(a) : a
  const dbb = typeof b === "string" ? new Date(b) : b
  return da.getFullYear() === dbb.getFullYear() && da.getMonth() === dbb.getMonth() && da.getDate() === dbb.getDate()
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return "?"
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "?"
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-cyan-500", "bg-fuchsia-500", "bg-pink-500",
  "bg-violet-500", "bg-purple-500",
]

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}


// === Missing exports used by fc/ components ===

// API error class
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number = 400) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Callable fetch wrapper — supports both api(path) and api(path, { method, body })
// Also has .get/.post/.patch/.delete methods for convenience
export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const body = await res.json(); if (body?.error) msg = body.error } catch {}
    throw new ApiError(msg, res.status)
  }
  if (res.status === 204) return null as any
  return res.json() as Promise<T>
}

// Attach method shortcuts to the api function
;(api as any).get = async <T = any>(path: string): Promise<T> => api<T>(path)
;(api as any).post = async <T = any>(path: string, body?: any): Promise<T> =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined })
;(api as any).patch = async <T = any>(path: string, body: any): Promise<T> =>
  api<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
;(api as any).delete = async <T = any>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' })

// Upload a file via multipart form — returns the file object directly
export async function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<{ url: string; filename: string; mimeType: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fd = new FormData()
    fd.append("file", file)
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener("load", () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) {
          // Handle both { file: {...} } and direct {...} response shapes
          const fileData = body.file || body
          resolve({ url: fileData.url, filename: fileData.filename || fileData.name || file.name, mimeType: fileData.mimeType, size: fileData.size })
        } else reject(new Error(body?.error || `HTTP ${xhr.status}`))
      } catch (e) { reject(new Error("Invalid response")) }
    })
    xhr.addEventListener("error", () => reject(new Error("Upload failed")))
    xhr.open("POST", "/api/files/upload")
    xhr.send(fd)
  })
}

// Clock time helper (for message timestamps)
export function clockTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// Last seen text formatter — accepts (online, lastSeen?) for FC component compatibility
export function lastSeenText(online: boolean | string | Date | null, lastSeen?: string | Date | null): string {
  if (online === true) return "online"
  const date = typeof online === 'string' || online instanceof Date ? online : lastSeen
  if (!date) return "offline"
  const d = typeof date === "string" ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "last seen just now"
  if (diff < 3600_000) return `last seen ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `last seen ${Math.floor(diff / 3600_000)}h ago`
  return `last seen ${d.toLocaleDateString()}`
}

// Precise last seen formatter — returns { label, detail } for FC component compatibility
export function formatLastSeenPrecise(date: string | Date | null | undefined): { label: string; detail: string } {
  if (!date) return { label: "offline", detail: "Never" }
  const d = typeof date === "string" ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return { label: "online", detail: "Active now" }
  if (diff < 3600_000) return { label: "recently", detail: d.toLocaleString() }
  return { label: "offline", detail: d.toLocaleString() }
}
