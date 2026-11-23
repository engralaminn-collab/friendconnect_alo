/**
 * Jara Avatar Renderer adapter boundary.
 *
 * IMPORTANT: The default implementation is a BROWSER FALLBACK (canvas/avatar UI).
 * It does NOT produce real audio-driven lip-synced video frames or publish a
 * WebRTC video track from a GPU renderer. Real renderers (MuseTalk/LivePortrait/
 * LiveKit avatar worker) must implement this interface behind an authenticated
 * internal service boundary.
 */

export type JaraRendererMode = 'browser_fallback' | 'gpu_worker' | 'livekit_avatar' | 'unconfigured'

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

export function createJaraRenderer(): JaraAvatarRenderer {
  const cap = getRendererCapability()
  if (cap.mode === 'browser_fallback') return new BrowserFallbackRenderer()
  return new UnconfiguredGpuAvatarRenderer()
}

export function getRendererCapability() {
  // Real GPU/LiveKit avatar renderer not wired in this build.
  return {
    mode: 'browser_fallback' as JaraRendererMode,
    realVideoTrack: false,
    audioDrivenLipSync: false,
    gpuWorkerConfigured: false,
    livekitAvatarConfigured: false,
    label: 'Browser fallback renderer (canvas/avatar preview only)',
  }
}