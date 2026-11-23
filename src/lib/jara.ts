import { createHash } from 'crypto'

// JARA — Permanent AI Assistant
// Single source of truth for Jara identity, config, hashing, and authorization

export const JARA_ID = 'jara-ai-system-001'
export const JARA_USERNAME = 'jara'
export const JARA_EMAIL = 'jara@friendconnect.local'

export type JaraFace = 'friendly' | 'realistic' | 'illustrated' | 'anime' | 'professional' | 'casual'
export type JaraBackground =
  | 'gradient-emerald'
  | 'gradient-blue'
  | 'gradient-purple'
  | 'futuristic'
  | 'nature'
  | 'city'
  | 'space'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'minimal'
  | 'dark-futuristic'
  | 'blue-futuristic'
  | 'custom'
export type JaraTheme = 'light' | 'dark' | 'futuristic' | 'midnight' | 'ocean' | 'sunset'
export type JaraPersonality = 'friendly' | 'professional' | 'conversational' | 'helpful' | 'playful' | 'formal' | 'empathetic'
export type JaraVoiceLanguage = 'bn' | 'en' | 'mixed'

export interface JaraConfigData {
  id?: string
  version: number
  face: string
  avatar: string
  avatarUrl?: string | null
  background: string
  backgroundUrl?: string | null
  theme: string
  colors?: string | null // JSON
  animation?: string | null
  clothing?: string | null
  voiceModel: string
  voiceLanguage: string
  voiceAccent?: string | null
  speakingSpeed: number
  pitch: number
  personality: string
  responseLength: string
  communicationStyle: string
  llmProvider: string
  llmModel: string
  sttModel: string
  ttsModel: string
  memoryEnabled: boolean
  isLive: boolean
  createdBy?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
}

export const JARA_DEFAULT_CONFIG: Omit<JaraConfigData, 'version' | 'isLive'> & { version: number; isLive: boolean } = {
  version: 1,
  face: 'friendly',
  avatar: 'default',
  avatarUrl: null,
  background: 'gradient-emerald',
  backgroundUrl: null,
  theme: 'light',
  colors: JSON.stringify({ primary: '#10b981', accent: '#0ea5e9', background: '#ffffff' }),
  animation: null,
  clothing: null,
  voiceModel: 'default',
  voiceLanguage: 'bn',
  voiceAccent: null,
  speakingSpeed: 1.0,
  pitch: 1.0,
  personality: 'friendly',
  responseLength: 'medium',
  communicationStyle: 'conversational',
  llmProvider: 'ollama',
  llmModel: 'llama3.2',
  sttModel: 'whisper',
  ttsModel: 'default',
  memoryEnabled: true,
  isLive: true,
}

// Deterministic config hash (SHA-256 of canonical JSON)
export function hashConfig(config: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeys(config))
  return createHash('sha256').update(canonical).digest('hex')
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    out[k] = sortKeys((obj as Record<string, unknown>)[k])
  }
  return out
}

// Allowed values for validation
export const ALLOWED_FACES = ['friendly', 'realistic', 'illustrated', 'anime', 'professional', 'casual', '3d', '2d']
export const ALLOWED_BACKGROUNDS = [
  'gradient-emerald', 'gradient-blue', 'gradient-purple', 'futuristic', 'nature', 'city', 'space', 'ocean', 'sunset', 'forest', 'minimal',
  'dark-futuristic', 'blue-futuristic', 'beautiful-futuristic', 'custom'
]
export const ALLOWED_THEMES = ['light', 'dark', 'futuristic', 'midnight', 'ocean', 'sunset', 'emerald', 'blue']
export const ALLOWED_PERSONALITIES = ['friendly', 'professional', 'conversational', 'helpful', 'playful', 'formal', 'empathetic', 'friendly-professional', 'friendly and professional']
export const ALLOWED_VOICES = ['default', 'natural-bn', 'natural-en', 'warm', 'energetic', 'calm', 'friendly-voice']
export const ALLOWED_LANGUAGES = ['bn', 'en', 'mixed', 'bangla', 'english', 'banglish']
export const ALLOWED_LLM_PROVIDERS = ['ollama', 'zai', 'openrouter', 'huggingface', 'openai-compatible', 'localai']
export const ALLOWED_LLM_MODELS = ['llama3.2', 'qwen2.5', 'mistral', 'phi3', 'gemma2', 'deepseek-r1', 'glm-4.6', 'gpt-4o-mini']
export const ALLOWED_STT = ['whisper', 'whisper.cpp', 'default', 'bangla-whisper']
export const ALLOWED_TTS = ['default', 'coqui', 'piper', 'edge-tts', 'openai-tts']

// Parse natural language instruction into config patch
export function parseInstructionToPatch(instruction: string): { patch: Partial<JaraConfigData>; summary: string[]; confidence: number } {
  const lower = instruction.toLowerCase()
  const patch: Partial<JaraConfigData> = {}
  const summary: string[] = []
  let confidence = 0.5

  // Background
  if (lower.includes('background')) {
    if (lower.includes('futuristic')) {
      if (lower.includes('blue')) { patch.background = 'blue-futuristic'; summary.push('Background → Blue futuristic environment'); }
      else if (lower.includes('dark')) { patch.background = 'dark-futuristic'; summary.push('Background → Dark futuristic environment'); }
      else { patch.background = 'futuristic'; summary.push('Background → Beautiful futuristic environment'); }
      confidence = 0.9
    } else if (lower.includes('nature')) { patch.background = 'nature'; summary.push('Background → Nature'); confidence = 0.9 }
    else if (lower.includes('ocean') || lower.includes('sea')) { patch.background = 'ocean'; summary.push('Background → Ocean'); confidence = 0.9 }
    else if (lower.includes('space') || lower.includes('galaxy')) { patch.background = 'space'; summary.push('Background → Space'); confidence = 0.9 }
    else if (lower.includes('forest')) { patch.background = 'forest'; summary.push('Background → Forest'); confidence = 0.9 }
    else if (lower.includes('city')) { patch.background = 'city'; summary.push('Background → City'); confidence = 0.9 }
    else if (lower.includes('sunset')) { patch.background = 'sunset'; summary.push('Background → Sunset'); confidence = 0.9 }
    else if (lower.includes('emerald') || lower.includes('green')) { patch.background = 'gradient-emerald'; summary.push('Background → Emerald gradient'); confidence = 0.85 }
    else if (lower.includes('blue')) { patch.background = 'gradient-blue'; summary.push('Background → Blue gradient'); confidence = 0.85 }
    else if (lower.includes('purple')) { patch.background = 'gradient-purple'; summary.push('Background → Purple gradient'); confidence = 0.85 }
  }

  // Face / Avatar
  if (lower.includes('face') || lower.includes('avatar') || lower.includes('appearance')) {
    if (lower.includes('realistic')) { patch.face = 'realistic'; summary.push('Face → Realistic friendly avatar'); confidence = 0.9 }
    else if (lower.includes('anime')) { patch.face = 'anime'; summary.push('Face → Anime style'); confidence = 0.9 }
    else if (lower.includes('illustrated') || lower.includes('cartoon')) { patch.face = 'illustrated'; summary.push('Face → Illustrated'); confidence = 0.9 }
    else if (lower.includes('professional')) { patch.face = 'professional'; summary.push('Face → Professional'); confidence = 0.85 }
    else if (lower.includes('friendly')) { patch.face = 'friendly'; summary.push('Face → Friendly'); confidence = 0.85 }
    else if (lower.includes('3d')) { patch.avatar = '3d'; summary.push('Avatar → 3D'); confidence = 0.85 }
    else if (lower.includes('2d')) { patch.avatar = '2d'; summary.push('Avatar → 2D'); confidence = 0.85 }
  }

  // Theme / Colors
  if (lower.includes('theme')) {
    if (lower.includes('dark')) { patch.theme = 'dark'; summary.push('Theme → Dark'); confidence = 0.9 }
    else if (lower.includes('light')) { patch.theme = 'light'; summary.push('Theme → Light'); confidence = 0.9 }
    else if (lower.includes('futuristic')) { patch.theme = 'futuristic'; summary.push('Theme → Futuristic'); confidence = 0.9 }
    else if (lower.includes('midnight')) { patch.theme = 'midnight'; summary.push('Theme → Midnight'); confidence = 0.9 }
    else if (lower.includes('ocean')) { patch.theme = 'ocean'; summary.push('Theme → Ocean'); confidence = 0.9 }
  }
  if (lower.includes('color') || lower.includes('colour')) {
    if (lower.includes('blue')) { patch.colors = JSON.stringify({ primary: '#2563eb', accent: '#0ea5e9' }); summary.push('Colors → Blue palette'); confidence = 0.8 }
    else if (lower.includes('emerald') || lower.includes('green')) { patch.colors = JSON.stringify({ primary: '#10b981', accent: '#06b6d4' }); summary.push('Colors → Emerald palette'); confidence = 0.8 }
    else if (lower.includes('purple')) { patch.colors = JSON.stringify({ primary: '#8b5cf6', accent: '#ec4899' }); summary.push('Colors → Purple palette'); confidence = 0.8 }
  }

  // Voice
  if (lower.includes('voice')) {
    if (lower.includes('bangla') || lower.includes('bengali') || lower.includes('bn')) {
      patch.voiceLanguage = 'bn'
      if (lower.includes('natural')) patch.voiceModel = 'natural-bn'
      summary.push('Voice → Natural Bangla voice'); confidence = 0.9
    } else if (lower.includes('english') || lower.includes('en ')) {
      patch.voiceLanguage = 'en'
      summary.push('Voice → English voice'); confidence = 0.9
    }
    if (lower.includes('fast') || lower.includes('faster')) { patch.speakingSpeed = 1.2; summary.push('Speaking speed → Faster'); }
    if (lower.includes('slow') || lower.includes('slower')) { patch.speakingSpeed = 0.85; summary.push('Speaking speed → Slower'); }
  }

  // Personality
  if (lower.includes('personality') || lower.includes('be more') || lower.includes('behave')) {
    if (lower.includes('friendly') && lower.includes('professional')) { patch.personality = 'friendly'; (patch as any).communicationStyle = 'professional'; summary.push('Personality → Friendly and professional'); confidence = 0.9 }
    else if (lower.includes('friendly')) { patch.personality = 'friendly'; summary.push('Personality → Friendly'); confidence = 0.9 }
    else if (lower.includes('professional')) { patch.personality = 'professional'; summary.push('Personality → Professional'); confidence = 0.9 }
    else if (lower.includes('playful')) { patch.personality = 'playful'; summary.push('Personality → Playful'); confidence = 0.9 }
    else if (lower.includes('formal')) { patch.personality = 'formal'; summary.push('Personality → Formal'); confidence = 0.9 }
    else if (lower.includes('helpful')) { patch.personality = 'helpful'; summary.push('Personality → Helpful'); confidence = 0.9 }
  }

  // AI Model
  if (lower.includes('model') || lower.includes('llm') || lower.includes('switch to')) {
    if (lower.includes('llama')) {
      if (lower.includes('3.2')) patch.llmModel = 'llama3.2'
      else patch.llmModel = 'llama3.2'
      patch.llmProvider = 'ollama'
      summary.push(`AI Model → ${patch.llmModel} (Ollama)`); confidence = 0.9
    } else if (lower.includes('qwen')) { patch.llmModel = 'qwen2.5'; patch.llmProvider = 'ollama'; summary.push('AI Model → Qwen 2.5'); confidence = 0.9 }
    else if (lower.includes('mistral')) { patch.llmModel = 'mistral'; patch.llmProvider = 'ollama'; summary.push('AI Model → Mistral'); confidence = 0.9 }
    else if (lower.includes('deepseek')) { patch.llmModel = 'deepseek-r1'; patch.llmProvider = 'ollama'; summary.push('AI Model → DeepSeek R1'); confidence = 0.9 }
    else if (lower.includes('gpt')) { patch.llmModel = 'gpt-4o-mini'; patch.llmProvider = 'openai-compatible'; summary.push('AI Model → GPT-4o mini'); confidence = 0.9 }
  }

  if (summary.length === 0) {
    // Generic fallback: try to detect any keyword
    if (lower.includes('change') || lower.includes('update') || lower.includes('make')) {
      summary.push('General appearance update')
      confidence = 0.4
    }
  }

  return { patch, summary, confidence }
}

export function buildChangeSummary(current: JaraConfigData, proposed: JaraConfigData): string[] {
  const changes: string[] = []
  const keys: (keyof JaraConfigData)[] = ['face', 'avatar', 'background', 'theme', 'voiceModel', 'voiceLanguage', 'personality', 'communicationStyle', 'llmModel', 'llmProvider', 'speakingSpeed', 'pitch']
  for (const k of keys) {
    const a = String((current as any)[k] ?? '')
    const b = String((proposed as any)[k] ?? '')
    if (a !== b) changes.push(`${k}: ${a || '(empty)'} → ${b || '(empty)'}`)
  }
  return changes
}

export function isJaraId(id: string): boolean {
  return id === JARA_ID || id === 'jara' || id?.toLowerCase() === JARA_USERNAME
}

// Proposal expiry: 24 hours by default
export function proposalExpiresAt(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
}

export function isProposalExpired(p: { expiresAt: Date | string; status: string }): boolean {
  if (p.status !== 'pending') return false
  const exp = new Date(p.expiresAt).getTime()
  return Date.now() > exp
}
