export type VoiceProviderMode = 'browser_fallback' | 'server_asr_tts' | 'unconfigured'

export function getVoiceCapability() {
  const asrUrl = process.env.JARA_ASR_URL || process.env.WHISPER_URL || process.env.FASTER_WHISPER_URL || ''
  const ttsUrl = process.env.JARA_TTS_URL || process.env.PIPER_URL || process.env.PIPER_TTS_URL || process.env.ORPHEUS_URL || ''
  const openaiAudio = process.env.JARA_VOICE_USE_OPENAI === 'true' && Boolean(process.env.OPENAI_API_KEY)
  const hasServerAsr = Boolean(asrUrl || openaiAudio)
  const hasServerTts = Boolean(ttsUrl || openaiAudio)

  return {
    mode: (hasServerAsr || hasServerTts ? 'server_asr_tts' : 'browser_fallback') as VoiceProviderMode,
    stt: {
      provider: asrUrl
        ? 'whisper_server'
        : openaiAudio
          ? 'openai_whisper'
          : 'browser_web_speech_fallback',
      configured: hasServerAsr,
      bengali: hasServerAsr ? 'supported_via_whisper' : 'browser_dependent',
    },
    tts: {
      provider: ttsUrl
        ? ((process.env.PIPER_URL || process.env.PIPER_TTS_URL) ? 'piper_server' : 'tts_server')
        : openaiAudio
          ? 'openai_tts'
          : 'browser_speech_synthesis_fallback',
      configured: hasServerTts,
      bengali: hasServerTts ? 'requires_model_check' : 'browser_dependent',
    },
    realtime: {
      streamingAsr: false,
      streamingTts: false,
      bargeIn: false,
    },
    note: hasServerAsr || hasServerTts
      ? 'Server-side speech endpoint configured for voice requests.'
      : 'Server-side Bangla ASR/TTS not configured in this environment. Browser Web Speech API fallback is preview-only.',
  }
}

export interface TranscribeResult {
  ok: boolean
  text?: string
  provider?: string
  error?: string
  httpStatus?: number
}

export async function transcribeAudioServer(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  language?: string,
): Promise<TranscribeResult> {
  const asrUrl = (process.env.JARA_ASR_URL || process.env.WHISPER_URL || process.env.FASTER_WHISPER_URL || '').trim()
  const openaiKey = process.env.OPENAI_API_KEY || ''
  const useOpenAi = !asrUrl && process.env.JARA_VOICE_USE_OPENAI === 'true' && Boolean(openaiKey)

  if (!asrUrl && !useOpenAi) {
    return {
      ok: false,
      error: 'No server-side ASR configured. Set JARA_ASR_URL / FASTER_WHISPER_URL (e.g. faster-whisper-server) or JARA_VOICE_USE_OPENAI=true.',
      httpStatus: 503,
    }
  }

  const endpoint = asrUrl
    ? (asrUrl.endsWith('/transcriptions') || asrUrl.endsWith('/asr') ? asrUrl : `${asrUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`)
    : 'https://api.openai.com/v1/audio/transcriptions'

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType || 'audio/webm' }), filename || 'audio.webm')
  form.append('model', process.env.JARA_ASR_MODEL || (useOpenAi ? 'whisper-1' : 'Systran/faster-whisper-small'))
  if (language) form.append('language', language)

  const headers: Record<string, string> = {}
  if (useOpenAi) headers.Authorization = `Bearer ${openaiKey}`
  else if (process.env.JARA_ASR_API_KEY) headers.Authorization = `Bearer ${process.env.JARA_ASR_API_KEY}`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      return { ok: false, error: `ASR upstream HTTP ${res.status}`, httpStatus: 502 }
    }
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data: any = await res.json()
      const text = String(data?.text || data?.transcript || '').trim()
      if (!text) return { ok: false, error: 'ASR returned empty transcript', httpStatus: 502 }
      return { ok: true, text, provider: asrUrl ? 'whisper_server' : 'openai_whisper' }
    }
    const text = (await res.text()).trim()
    if (!text) return { ok: false, error: 'ASR returned empty transcript', httpStatus: 502 }
    return { ok: true, text, provider: asrUrl ? 'whisper_server' : 'openai_whisper' }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'ASR request failed', httpStatus: 502 }
  }
}

export interface SynthesizeResult {
  ok: boolean
  audioBase64?: string
  mimeType?: string
  provider?: string
  error?: string
  httpStatus?: number
}

export async function synthesizeSpeechServer(
  text: string,
  opts: { language?: string; voice?: string; speed?: number } = {},
): Promise<SynthesizeResult> {
  const piperUrl = (process.env.PIPER_URL || process.env.PIPER_TTS_URL || '').trim()
  const ttsUrl = (process.env.JARA_TTS_URL || piperUrl || process.env.ORPHEUS_URL || '').trim()
  const openaiKey = process.env.OPENAI_API_KEY || ''
  const useOpenAi = !ttsUrl && process.env.JARA_VOICE_USE_OPENAI === 'true' && Boolean(openaiKey)

  if (!ttsUrl && !useOpenAi) {
    return { ok: false, error: 'No server TTS configured', httpStatus: 503 }
  }

  try {
    // Support Piper HTTP server (`PIPER_URL` / `PIPER_TTS_URL`) or OpenAI-compatible `/v1/audio/speech`
    if (piperUrl && !process.env.JARA_TTS_URL) {
      const res = await fetch(piperUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          length_scale: opts.speed ? 1 / Math.max(0.5, Math.min(2, opts.speed)) : 1.0,
        }),
        signal: AbortSignal.timeout(25_000),
      })
      if (!res.ok) return { ok: false, error: `Piper HTTP ${res.status}`, httpStatus: 502 }
      const buf = Buffer.from(await res.arrayBuffer())
      return {
        ok: true,
        audioBase64: buf.toString('base64'),
        mimeType: res.headers.get('content-type') || 'audio/wav',
        provider: 'piper_server',
      }
    }

    const endpoint = ttsUrl
      ? (ttsUrl.endsWith('/speech') ? ttsUrl : `${ttsUrl.replace(/\/+$/, '')}/v1/audio/speech`)
      : 'https://api.openai.com/v1/audio/speech'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (useOpenAi) headers.Authorization = `Bearer ${openaiKey}`
    else if (process.env.JARA_TTS_API_KEY) headers.Authorization = `Bearer ${process.env.JARA_TTS_API_KEY}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.JARA_TTS_MODEL || (useOpenAi ? 'gpt-4o-mini-tts' : 'piper'),
        voice: opts.voice || process.env.JARA_TTS_VOICE || 'alloy',
        input: text.slice(0, 2000),
        speed: opts.speed || 1.0,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) return { ok: false, error: `TTS upstream HTTP ${res.status}`, httpStatus: 502 }
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      ok: true,
      audioBase64: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'audio/mpeg',
      provider: ttsUrl ? 'tts_server' : 'openai_tts',
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'TTS request failed', httpStatus: 502 }
  }
}
