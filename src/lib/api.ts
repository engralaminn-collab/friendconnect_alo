export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers || {}),
    },
    credentials: 'include',
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  }
  return data as T
}

export async function uploadFile(file: File): Promise<{ file: { id: string; url: string; name: string; mimeType: string; size: number } }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/files/upload', { method: 'POST', body: form, credentials: 'include' })
  const data = await res.json()
  if (!res.ok) throw new ApiError(data?.error || 'Upload failed', res.status)
  return data
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function lastSeenText(online: boolean, lastSeen: string | null | undefined): string {
  if (online) return 'online'
  if (!lastSeen) return 'offline'
  return `last seen ${timeAgo(lastSeen)} ago`
}
