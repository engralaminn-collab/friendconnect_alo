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

// Fetch wrapper with JSON parsing + auth cookie forwarding
export const api = {
  async get<T = any>(path: string): Promise<T> {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async post<T = any>(path: string, body?: any): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async patch<T = any>(path: string, body: any): Promise<T> {
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async delete<T = any>(path: string): Promise<T> {
    const res = await fetch(path, { method: "DELETE" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}

// Upload a file via multipart form
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
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else reject(new Error(body?.error || `HTTP ${xhr.status}`))
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

// Last seen text formatter
export function lastSeenText(date: string | Date | null): string {
  if (!date) return "offline"
  const d = typeof date === "string" ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "last seen just now"
  if (diff < 3600_000) return `last seen ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `last seen ${Math.floor(diff / 3600_000)}h ago`
  return `last seen ${d.toLocaleDateString()}`
}

// Precise last seen formatter
export function formatLastSeenPrecise(date: string | Date | null): string {
  if (!date) return "Never"
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleString()
}
