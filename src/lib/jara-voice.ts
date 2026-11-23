export type VoiceProviderMode = 'browser_fallback' | 'server_asr_tts' | 'unconfigured'

export function getVoiceCapability() {
  const hasServerAsr = Boolean(process.env.JARA_ASR_URL || process.env.WHISPER_URL || process.env.FASTER_WHISPER_URL)
  const hasServerTts = Boolean(process.env.JARA_TTS_URL || process.env.PIPER_URL || process.env.ORPHEUS_URL)
  return {
    mode: (hasServerAsr || hasServerTts ? 'server_asr_tts' : 'browser_fallback') as VoiceProviderMode,
    stt: {
      provider: hasServerAsr ? 'server_configured' : 'browser_web_speech_fallback',
      configured: hasServerAsr,
      bengali: hasServerAsr ? 'requires_benchmark' : 'browser_dependent',
    },
    tts: {
      provider: hasServerTts ? 'server_configured' : 'browser_speech_synthesis_fallback',
      configured: hasServerTts,
      bengali: hasServerTts ? 'requires_benchmark' : 'browser_dependent',
    },
    realtime: {
      streamingAsr: false,
      streamingTts: false,
      bargeIn: false,
    },
    note: 'Server-side Bangla ASR/TTS not integrated in this build. Browser fallback is for preview only and must not be reported as production Bengali voice quality.',
  }
}