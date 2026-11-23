import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { isAIConfigured, getAIProvider, getAvailableModels } from '@/lib/ai'
import { JARA_ID } from '@/lib/jara'

export async function GET() {
  try {
    let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
    if (!live) live = { version: 1, face: 'friendly', background: 'gradient-emerald', theme: 'light', voiceLanguage: 'bn', llmProvider: 'ollama', llmModel: 'llama3.2', isLive: true }

    const jaraUser = await (db as any).user.findUnique({ where: { id: JARA_ID } }).catch(() => null)
    const proposalCount = await (db as any).jaraProposal.count({ where: { status: 'pending' } }).catch(() => 0)

    return json({
      status: jaraUser ? 'healthy' : 'degraded',
      jara: {
        exists: !!jaraUser,
        id: JARA_ID,
        name: jaraUser?.name || 'Jara',
        config: {
          version: live.version,
          face: live.face,
          background: live.background,
          theme: live.theme,
          voiceLanguage: live.voiceLanguage,
          personality: live.personality,
          llmProvider: live.llmProvider,
          llmModel: live.llmModel,
        },
        pendingProposals: proposalCount,
      },
      ai: {
        configured: isAIConfigured(),
        provider: getAIProvider(),
        models: getAvailableModels(),
      },
      bangla: {
        stt: 'Web Speech API + Whisper fallback (browser)',
        tts: 'Web Speech API + Edge TTS fallback',
        tested: false,
      },
    })
  } catch (e: any) {
    return json({ status: 'error', error: e.message }, 500)
  }
}
