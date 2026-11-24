/**
 * Jara Avatar Renderer adapter boundary.
 *
 * IMPORTANT: The default implementation is a BROWSER FALLBACK (canvas/avatar UI).
 * It does NOT produce real audio-driven lip-synced video frames or publish a
 * WebRTC video track from a GPU renderer unless an external worker (InfiniteTalk /
 * MuseTalk / LivePortrait / ComfyUI / RunningHub / LiveKit avatar agent) is
 * explicitly configured via environment variables.
 */

export type JaraRendererMode =
  | 'browser_fallback'
  | 'gpu_worker'
  | 'comfyui'
  | 'runninghub'
  | 'livekit_avatar'
  | 'unconfigured'

export interface JaraResolvedAppearance {
  face: string
  avatar: string
  avatarUrl?: string | null
  background: string
  backgroundUrl?: string | null
  theme: string
  colors?: string | null
  clothing?: string | null
  animation?: string | null
}

export interface JaraRendererSession {
  sessionId: string
  sessionType: string
  appearance: JaraResolvedAppearance
}

export interface JaraAvatarRenderer {
  mode: JaraRendererMode
  initialize(session: JaraRendererSession): Promise<void>
  loadAppearance(appearance: JaraResolvedAppearance): Promise<void>
  applyPresentation(session: JaraRendererSession): Promise<void>
  processAudio?(audioChunk: ArrayBuffer | Uint8Array): Promise<void>
  renderFrame?(): Promise<unknown>
  publishVideoTrack?(): Promise<unknown>
  stop(): Promise<void>
  dispose(): Promise<void>
}

export class BrowserFallbackRenderer implements JaraAvatarRenderer {
  mode: JaraRendererMode = 'browser_fallback'
  private session: JaraRendererSession | null = null

  async initialize(session: JaraRendererSession) { this.session = session }
  async loadAppearance(appearance: JaraResolvedAppearance) {
    if (this.session) this.session = { ...this.session, appearance }
  }
  async applyPresentation(session: JaraRendererSession) { this.session = session }
  async stop() { /* no-op */ }
  async dispose() { this.session = null }
}

export class UnconfiguredGpuAvatarRenderer implements JaraAvatarRenderer {
  mode: JaraRendererMode = 'unconfigured'
  async initialize() { throw new Error('GPU avatar renderer not configured. Set GPU worker/LiveKit avatar integration before use.') }
  async loadAppearance() { throw new Error('GPU avatar renderer not configured.') }
  async applyPresentation() { throw new Error('GPU avatar renderer not configured.') }
  async processAudio() { throw new Error('GPU avatar renderer not configured.') }
  async renderFrame() { throw new Error('GPU avatar renderer not configured.') }
  async publishVideoTrack() { throw new Error('GPU avatar renderer not configured.') }
  async stop() { /* no-op */ }
  async dispose() { /* no-op */ }
}

export function getRendererCapability() {
  const gpuWorkerUrl = (process.env.JARA_GPU_WORKER_URL || '').trim()
  const comfyuiUrl = (process.env.COMFYUI_API_URL || '').trim()
  const runninghubConfigured = Boolean(process.env.RUNNINGHUB_API_KEY && process.env.RUNNINGHUB_WORKFLOW_ID)
  const livekitAvatarConfigured = Boolean(
    process.env.JARA_LIVEKIT_AVATAR_URL &&
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET,
  )

  const gpuWorkerConfigured = Boolean(gpuWorkerUrl)
  const comfyuiConfigured = Boolean(comfyuiUrl)

  let mode: JaraRendererMode = 'browser_fallback'
  let label = 'Browser fallback renderer (canvas/avatar preview only)'

  if (livekitAvatarConfigured) {
    mode = 'livekit_avatar'
    label = 'LiveKit avatar agent worker configured'
  } else if (gpuWorkerConfigured) {
    mode = 'gpu_worker'
    label = 'External GPU avatar worker configured (InfiniteTalk/LivePortrait/MuseTalk HTTP)'
  } else if (comfyuiConfigured) {
    mode = 'comfyui'
    label = 'ComfyUI API workflow renderer configured'
  } else if (runninghubConfigured) {
    mode = 'runninghub'
    label = 'RunningHub cloud ComfyUI API configured'
  }

  return {
    mode,
    realVideoTrack: livekitAvatarConfigured,
    audioDrivenLipSync: gpuWorkerConfigured || comfyuiConfigured || runninghubConfigured || livekitAvatarConfigured,
    gpuWorkerConfigured,
    comfyuiConfigured,
    runninghubConfigured,
    livekitAvatarConfigured,
    label,
  }
}

export function createJaraRenderer(): JaraAvatarRenderer {
  const cap = getRendererCapability()
  if (cap.mode === 'browser_fallback') return new BrowserFallbackRenderer()
  return new UnconfiguredGpuAvatarRenderer()
}

export async function probeRendererHealth(): Promise<{
  mode: JaraRendererMode
  reachable: boolean
  detail: string
}> {
  const cap = getRendererCapability()
  if (cap.mode === 'browser_fallback') {
    return { mode: cap.mode, reachable: true, detail: 'Browser fallback only — no external GPU worker configured.' }
  }

  const gpuUrl = (process.env.JARA_GPU_WORKER_URL || process.env.JARA_LIVEKIT_AVATAR_URL || '').trim().replace(/\/+$/, '')
  if (gpuUrl) {
    try {
      const headers: Record<string, string> = {}
      if (process.env.JARA_GPU_WORKER_TOKEN) headers.Authorization = `Bearer ${process.env.JARA_GPU_WORKER_TOKEN}`
      const res = await fetch(`${gpuUrl}/health`, { headers, signal: AbortSignal.timeout(3000) })
      return { mode: cap.mode, reachable: res.ok, detail: res.ok ? `Worker reachable (HTTP ${res.status})` : `Worker returned HTTP ${res.status}` }
    } catch (e: any) {
      return { mode: cap.mode, reachable: false, detail: `Worker unreachable: ${e?.message || 'network error'}` }
    }
  }

  const comfyUrl = (process.env.COMFYUI_API_URL || '').trim().replace(/\/+$/, '')
  if (comfyUrl) {
    try {
      const res = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) })
      return { mode: 'comfyui', reachable: res.ok, detail: res.ok ? 'ComfyUI API reachable' : `ComfyUI HTTP ${res.status}` }
    } catch (e: any) {
      return { mode: 'comfyui', reachable: false, detail: `ComfyUI unreachable: ${e?.message || 'network error'}` }
    }
  }

  if (cap.runninghubConfigured) {
    return { mode: 'runninghub', reachable: true, detail: 'RunningHub API key and workflow ID configured (dispatched on render).' }
  }

  return { mode: cap.mode, reachable: false, detail: 'No renderer probe available.' }
}

export interface AvatarRenderJobInput {
  title?: string
  script?: string
  referenceImageUrl?: string | null
  referenceVideoUrl?: string | null
  voiceSampleUrl?: string | null
  voiceLanguage?: string
  background?: string
  clothing?: string
  workflowPayload?: Record<string, unknown>
}

export async function submitAvatarRenderJob(input: AvatarRenderJobInput): Promise<{
  ok: boolean
  backend: JaraRendererMode
  jobId?: string
  status?: string
  raw?: unknown
  error?: string
  httpStatus?: number
}> {
  const gpuUrl = (process.env.JARA_GPU_WORKER_URL || '').trim().replace(/\/+$/, '')
  if (gpuUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (process.env.JARA_GPU_WORKER_TOKEN) headers.Authorization = `Bearer ${process.env.JARA_GPU_WORKER_TOKEN}`
      const res = await fetch(`${gpuUrl}/v1/render`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(20_000),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, backend: 'gpu_worker', error: data?.error || `Worker HTTP ${res.status}`, httpStatus: 502 }
      return { ok: true, backend: 'gpu_worker', jobId: data?.jobId || data?.id, status: data?.status || 'queued', raw: data }
    } catch (e: any) {
      return { ok: false, backend: 'gpu_worker', error: e?.message || 'GPU worker request failed', httpStatus: 502 }
    }
  }

  const comfyUrl = (process.env.COMFYUI_API_URL || '').trim().replace(/\/+$/, '')
  if (comfyUrl) {
    if (!input.workflowPayload) {
      return { ok: false, backend: 'comfyui', error: 'ComfyUI backend requires workflowPayload prompt graph JSON.', httpStatus: 400 }
    }
    try {
      const res = await fetch(`${comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input.workflowPayload }),
        signal: AbortSignal.timeout(20_000),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, backend: 'comfyui', error: data?.error || `ComfyUI HTTP ${res.status}`, httpStatus: 502 }
      return { ok: true, backend: 'comfyui', jobId: data?.prompt_id, status: 'queued', raw: data }
    } catch (e: any) {
      return { ok: false, backend: 'comfyui', error: e?.message || 'ComfyUI request failed', httpStatus: 502 }
    }
  }

  const rhKey = (process.env.RUNNINGHUB_API_KEY || '').trim()
  const rhWorkflow = (process.env.RUNNINGHUB_WORKFLOW_ID || '').trim()
  if (rhKey && rhWorkflow) {
    const rhBase = (process.env.RUNNINGHUB_API_URL || 'https://www.runninghub.cn').replace(/\/+$/, '')
    try {
      const nodeInfoList = Array.isArray((input.workflowPayload as any)?.nodeInfoList)
        ? (input.workflowPayload as any).nodeInfoList
        : []
      const res = await fetch(`${rhBase}/task/openapi/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: new URL(rhBase).host },
        body: JSON.stringify({ apiKey: rhKey, workflowId: rhWorkflow, nodeInfoList }),
        signal: AbortSignal.timeout(20_000),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok || data?.code !== 0) {
        return { ok: false, backend: 'runninghub', error: data?.msg || `RunningHub HTTP ${res.status}`, httpStatus: 502 }
      }
      return { ok: true, backend: 'runninghub', jobId: data?.data?.taskId, status: data?.data?.taskStatus || 'queued', raw: data.data }
    } catch (e: any) {
      return { ok: false, backend: 'runninghub', error: e?.message || 'RunningHub request failed', httpStatus: 502 }
    }
  }

  return {
    ok: false,
    backend: 'browser_fallback',
    error: 'No GPU avatar / ComfyUI / RunningHub renderer configured. Set JARA_GPU_WORKER_URL, COMFYUI_API_URL, or RUNNINGHUB_API_KEY + RUNNINGHUB_WORKFLOW_ID.',
    httpStatus: 503,
  }
}

export async function getAvatarRenderJobStatus(jobId: string): Promise<{
  ok: boolean
  backend: JaraRendererMode
  jobId: string
  status?: string
  outputs?: unknown
  error?: string
  httpStatus?: number
}> {
  const cleanId = encodeURIComponent(jobId)
  const gpuUrl = (process.env.JARA_GPU_WORKER_URL || '').trim().replace(/\/+$/, '')
  if (gpuUrl) {
    try {
      const headers: Record<string, string> = {}
      if (process.env.JARA_GPU_WORKER_TOKEN) headers.Authorization = `Bearer ${process.env.JARA_GPU_WORKER_TOKEN}`
      const res = await fetch(`${gpuUrl}/v1/render/${cleanId}`, { headers, signal: AbortSignal.timeout(15_000) })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, backend: 'gpu_worker', jobId, error: data?.error || `Worker HTTP ${res.status}`, httpStatus: 502 }
      return { ok: true, backend: 'gpu_worker', jobId, status: data?.status || 'unknown', outputs: data?.outputs || data }
    } catch (e: any) {
      return { ok: false, backend: 'gpu_worker', jobId, error: e?.message || 'Worker status check failed', httpStatus: 502 }
    }
  }

  const comfyUrl = (process.env.COMFYUI_API_URL || '').trim().replace(/\/+$/, '')
  if (comfyUrl) {
    try {
      const res = await fetch(`${comfyUrl}/history/${cleanId}`, { signal: AbortSignal.timeout(15_000) })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, backend: 'comfyui', jobId, error: `ComfyUI HTTP ${res.status}`, httpStatus: 502 }
      const entry = data?.[jobId]
      return { ok: true, backend: 'comfyui', jobId, status: entry ? 'completed' : 'running', outputs: entry?.outputs || null }
    } catch (e: any) {
      return { ok: false, backend: 'comfyui', jobId, error: e?.message || 'ComfyUI status check failed', httpStatus: 502 }
    }
  }

  const rhKey = (process.env.RUNNINGHUB_API_KEY || '').trim()
  if (rhKey) {
    const rhBase = (process.env.RUNNINGHUB_API_URL || 'https://www.runninghub.cn').replace(/\/+$/, '')
    try {
      const res = await fetch(`${rhBase}/task/openapi/outputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: rhKey, taskId: jobId }),
        signal: AbortSignal.timeout(15_000),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, backend: 'runninghub', jobId, error: `RunningHub HTTP ${res.status}`, httpStatus: 502 }
      return { ok: true, backend: 'runninghub', jobId, status: data?.code === 0 ? 'completed' : (data?.msg || 'pending'), outputs: data?.data || null }
    } catch (e: any) {
      return { ok: false, backend: 'runninghub', jobId, error: e?.message || 'RunningHub status check failed', httpStatus: 502 }
    }
  }

  return { ok: false, backend: 'browser_fallback', jobId, error: 'No external renderer configured', httpStatus: 503 }
}
