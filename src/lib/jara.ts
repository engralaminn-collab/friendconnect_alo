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
  displayName?: string
  aiDisclosure?: string
  isEnabled?: boolean
  face: string
  avatar: string
  avatarUrl?: string | null
  background: string
  backgroundUrl?: string | null
  theme: string
  colors?: string | null // JSON
  animation?: string | null
  clothing?: string | null
  defaultAppearanceProfileId?: string | null
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
  smsEnabled?: boolean
  callsEnabled?: boolean
  meetingsEnabled?: boolean
  allowGroupListening?: boolean
  humanHandoffEnabled?: boolean
  recordingConsentRequired?: boolean
  approvedKnowledgeMode?: string
  isLive: boolean
  createdBy?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
}

export const JARA_DEFAULT_CONFIG: Omit<JaraConfigData, 'version' | 'isLive'> & { version: number; isLive: boolean } = {
  version: 1,
  displayName: 'Jara AI',
  aiDisclosure: 'I am Jara AI, a digital human assistant. I am not a real human.',
  isEnabled: true,
  face: 'friendly',
  avatar: 'default',
  avatarUrl: null,
  background: 'gradient-emerald',
  backgroundUrl: null,
  theme: 'light',
  colors: JSON.stringify({ primary: '#10b981', accent: '#0ea5e9', background: '#ffffff' }),
  animation: null,
  clothing: null,
  defaultAppearanceProfileId: null,
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
  smsEnabled: false,
  callsEnabled: true,
  meetingsEnabled: false,
  allowGroupListening: false,
  humanHandoffEnabled: true,
  recordingConsentRequired: true,
  approvedKnowledgeMode: 'open',
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
export const ALLOWED_LLM_MODELS = ['llama3.2', 'qwen2.5', 'qwen3', 'mistral', 'phi3', 'gemma2', 'deepseek-r1', 'glm-4.6', 'gpt-4o-mini', 'bangla-llama', 'banglallama-7b']
export const ALLOWED_STT = ['whisper', 'whisper.cpp', 'faster-whisper', 'indicconformer', 'funasr', 'default', 'bangla-whisper']
export const ALLOWED_TTS = ['default', 'coqui', 'piper', 'edge-tts', 'openai-tts', 'orpheus', 'chatterbox', 'bangla-tts', 'openvoice']

// Parse natural language instruction into config patch
export type JaraInstructionScope = 'persistent' | 'temporary_next_call' | 'temporary'

export function parseInstructionToPatch(instruction: string): { patch: Partial<JaraConfigData>; summary: string[]; confidence: number; scope: JaraInstructionScope; restoreDefault?: boolean } {
  const lower = instruction.toLowerCase()
  const patch: Partial<JaraConfigData> = {}
  const summary: string[] = []
  let confidence = 0.5
  let scope: JaraInstructionScope = 'persistent'
  let restoreDefault = false

  // Scope / temporariness
  if (/(next call|next meeting|next video call|next audio call|for this call|for this meeting|today'?s call|আজকের .*কল|পরের .*কল|পরের .*মিটিং|পরবর্তী .*কল|পরবর্তী .*মিটিং|এই কল|এই মিটিং)/i.test(instruction)) {
    scope = 'temporary_next_call'
  }
  if (/(permanent|from now on|always|default|স্থায়ী|স্থায়ী|আজ থেকে|সবসময়|সবসময়|ডিফল্ট)/i.test(instruction) && !/(next call|next meeting|for this call|এই কল|এই মিটিং|পরের)/i.test(instruction)) {
    scope = 'persistent'
  }

  // Restore default
  if (/(restore|আগের|পূর্বের|ডিফল্ট .*ফির|default .*back|previous .*look|official default|আগের .*লুক)/i.test(instruction)) {
    restoreDefault = true
    confidence = 0.9
    summary.push('Restore approved default appearance/profile')
  }

  // Background / environment
  if (/(background|ব্যাকগ্রাউন্ড|পরিবেশ|environment)/i.test(instruction)) {
    if (/(alo labs|অফিসিয়াল|অফিসিয়াল|official office|office background|অফিস|meeting room|কনফারেন্স)/i.test(instruction)) {
      patch.background = 'alo-office'
      patch.backgroundUrl = patch.backgroundUrl || null
      summary.push('Background → ALO Labs official office environment')
      confidence = 0.95
    } else if (/(outdoor|আউটডোর|বাইরে|outside|park|garden)/i.test(instruction)) {
      patch.background = 'outdoor'
      summary.push('Background → Approved outdoor environment')
      confidence = 0.95
    } else if (/(futuristic|ফিউচারিস্টিক)/i.test(instruction)) {
      if (/(blue|নীল)/i.test(instruction)) { patch.background = 'blue-futuristic'; summary.push('Background → Blue futuristic environment') }
      else if (/(dark|ডার্ক)/i.test(instruction)) { patch.background = 'dark-futuristic'; summary.push('Background → Dark futuristic environment') }
      else { patch.background = 'futuristic'; summary.push('Background → Futuristic environment') }
      confidence = 0.9
    } else if (/(nature|প্রকৃতি)/i.test(instruction)) { patch.background = 'nature'; summary.push('Background → Nature'); confidence = 0.9 }
    else if (/(ocean|sea|সমুদ্র)/i.test(instruction)) { patch.background = 'ocean'; summary.push('Background → Ocean'); confidence = 0.9 }
    else if (/(space|galaxy|স্পেস)/i.test(instruction)) { patch.background = 'space'; summary.push('Background → Space'); confidence = 0.9 }
    else if (/(forest|বন)/i.test(instruction)) { patch.background = 'forest'; summary.push('Background → Forest'); confidence = 0.9 }
    else if (/(city|শহর)/i.test(instruction)) { patch.background = 'city'; summary.push('Background → City'); confidence = 0.9 }
    else if (/(sunset|সূর্যাস্ত)/i.test(instruction)) { patch.background = 'sunset'; summary.push('Background → Sunset'); confidence = 0.9 }
    else if (/(studio)/i.test(instruction)) { patch.background = 'studio'; summary.push('Background → Studio'); confidence = 0.9 }
    else if (/(emerald|green)/i.test(instruction)) { patch.background = 'gradient-emerald'; summary.push('Background → Emerald gradient'); confidence = 0.85 }
    else if (/(blue|নীল)/i.test(instruction)) { patch.background = 'gradient-blue'; summary.push('Background → Blue gradient'); confidence = 0.85 }
    else if (/(purple|বেগুনি)/i.test(instruction)) { patch.background = 'gradient-purple'; summary.push('Background → Purple gradient'); confidence = 0.85 }
    else { patch.background = 'alo-office'; summary.push('Background → Official office environment'); confidence = 0.7 }
  }

  // Clothing / outfit
  if (/(clothing|clothes|outfit|dress|পোশাক|স্যুট|কাপড়|কাপড়)/i.test(instruction)) {
    if (/(formal|business suit|suit|ফরমাল|বিজনেস স্যুট|অফিসিয়াল পোশাক|অফিসিয়াল পোশাক)/i.test(instruction)) {
      patch.clothing = JSON.stringify({ type: 'formal-business-suit', label: 'Formal business suit', style: 'professional' })
      summary.push('Clothing → Formal business suit')
      confidence = 0.95
    } else if (/(casual|ক্যাজুয়াল|ক্যাজুয়াল)/i.test(instruction)) {
      patch.clothing = JSON.stringify({ type: 'business-casual', label: 'Business casual', style: 'casual' })
      summary.push('Clothing → Business casual')
      confidence = 0.9
    } else if (/(traditional|ঐতিহ্যবাহী|পাঞ্জাবি|শাড়ি|শাড়ি)/i.test(instruction)) {
      patch.clothing = JSON.stringify({ type: 'traditional', label: 'Traditional attire', style: 'traditional' })
      summary.push('Clothing → Traditional attire')
      confidence = 0.9
    } else {
      patch.clothing = JSON.stringify({ type: 'formal-business-suit', label: 'Formal business suit', style: 'professional' })
      summary.push('Clothing → Updated outfit')
      confidence = 0.7
    }
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

  // Voice / language
  if (/(voice|speak|talk|language|ভাষা|কথা বল|বাংলায় কথা|ইংরেজিতে কথা)/i.test(instruction)) {
    if (/(bangla|bengali|বাংলা|বাংলায়)/i.test(instruction) && /(english|ইংরেজি)/i.test(instruction)) {
      patch.voiceLanguage = 'mixed'
      summary.push('Language → Bangla primary, English when needed (mixed)')
      confidence = 0.92
    } else if (/(bangla|bengali|বাংলা|বাংলায়)/i.test(instruction)) {
      patch.voiceLanguage = 'bn'
      if (/(natural|স্বাভাবিক)/i.test(instruction)) patch.voiceModel = 'natural-bn'
      summary.push('Language/Voice → Bangla')
      confidence = 0.9
    } else if (/(english|ইংরেজি)/i.test(instruction)) {
      patch.voiceLanguage = 'en'
      summary.push('Language/Voice → English')
      confidence = 0.9
    }
    if (/(fast|faster|দ্রুত)/i.test(instruction)) { patch.speakingSpeed = 1.2; summary.push('Speaking speed → Faster') }
    if (/(slow|slower|ধীরে)/i.test(instruction)) { patch.speakingSpeed = 0.85; summary.push('Speaking speed → Slower') }
  }

  // Personality / tone
  if (/(personality|be more|behave|tone|style|ভদ্র|বন্ধুত্বপূর্ণ|প্রফেশনাল|পেশাদার|বন্ধুসুলভ)/i.test(instruction)) {
    const friendly = /(friendly|বন্ধুত্বপূর্ণ|বন্ধুসুলভ)/i.test(instruction)
    const professional = /(professional|প্রফেশনাল|পেশাদার)/i.test(instruction)
    const polite = /(polite|ভদ্র)/i.test(instruction)
    if ((friendly || polite) && professional) { patch.personality = 'friendly'; (patch as any).communicationStyle = 'professional'; summary.push('Personality → Friendly and professional'); confidence = 0.92 }
    else if (friendly) { patch.personality = 'friendly'; summary.push('Personality → Friendly'); confidence = 0.9 }
    else if (professional) { patch.personality = 'professional'; summary.push('Personality → Professional'); confidence = 0.9 }
    else if (/(playful|মজার)/i.test(instruction)) { patch.personality = 'playful'; summary.push('Personality → Playful'); confidence = 0.9 }
    else if (/(formal|আনুষ্ঠানিক)/i.test(instruction)) { patch.personality = 'formal'; summary.push('Personality → Formal'); confidence = 0.9 }
    else if (/(helpful|সহায়ক|সহায়ক)/i.test(instruction)) { patch.personality = 'helpful'; summary.push('Personality → Helpful'); confidence = 0.9 }
  }

  // AI Model
  if (lower.includes('model') || lower.includes('llm') || lower.includes('switch to')) {
    if (lower.includes('llama')) {
      if (lower.includes('3.2')) patch.llmModel = 'llama3.2'
      else patch.llmModel = 'llama3.2'
      patch.llmProvider = 'ollama'
      summary.push(`AI Model → ${patch.llmModel} (Ollama)`); confidence = 0.9
    } else if (lower.includes('qwen3') || lower.includes('qwen 3')) { patch.llmModel = 'qwen3'; patch.llmProvider = 'ollama'; summary.push('AI Model → Qwen3'); confidence = 0.9 }
    else if (lower.includes('qwen')) { patch.llmModel = 'qwen2.5'; patch.llmProvider = 'ollama'; summary.push('AI Model → Qwen 2.5'); confidence = 0.9 }
    else if (lower.includes('banglallama') || lower.includes('bangla llama') || lower.includes('bangla-llama')) { patch.llmModel = 'bangla-llama'; patch.llmProvider = 'ollama'; summary.push('AI Model → BanglaLlama'); confidence = 0.9 }
    else if (lower.includes('mistral')) { patch.llmModel = 'mistral'; patch.llmProvider = 'ollama'; summary.push('AI Model → Mistral'); confidence = 0.9 }
    else if (lower.includes('deepseek')) { patch.llmModel = 'deepseek-r1'; patch.llmProvider = 'ollama'; summary.push('AI Model → DeepSeek R1'); confidence = 0.9 }
    else if (lower.includes('gpt')) { patch.llmModel = 'gpt-4o-mini'; patch.llmProvider = 'openai-compatible'; summary.push('AI Model → GPT-4o mini'); confidence = 0.9 }
  }

  if (restoreDefault) {
    patch.face = JARA_DEFAULT_CONFIG.face
    patch.avatar = JARA_DEFAULT_CONFIG.avatar
    patch.background = JARA_DEFAULT_CONFIG.background
    patch.backgroundUrl = JARA_DEFAULT_CONFIG.backgroundUrl as any
    patch.theme = JARA_DEFAULT_CONFIG.theme
    patch.clothing = JARA_DEFAULT_CONFIG.clothing as any
    patch.voiceLanguage = JARA_DEFAULT_CONFIG.voiceLanguage
    patch.personality = JARA_DEFAULT_CONFIG.personality
    patch.communicationStyle = JARA_DEFAULT_CONFIG.communicationStyle
    patch.defaultAppearanceProfileId = null as any
  }

  if (summary.length === 0) {
    // Generic fallback: try to detect any keyword
    if (lower.includes('change') || lower.includes('update') || lower.includes('make')) {
      summary.push('General appearance update')
      confidence = 0.4
    }
  }

  return { patch, summary, confidence, scope, restoreDefault }
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
