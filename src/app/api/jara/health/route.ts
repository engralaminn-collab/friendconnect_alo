import { json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { isAIConfigured, getAIProvider, getAvailableModels } from '@/lib/ai'
import { JARA_ID } from '@/lib/jara'
import { getVoiceCapability } from '@/lib/jara-voice'
import { getRendererCapability, probeRendererHealth } from '@/lib/jara-renderer'
import { getSmsCapability } from '@/lib/jara-sms'

export async function GET() {
  try {
    let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
    if (!live) live = { version: 1, face: 'friendly', background: 'gradient-emerald', theme: 'light', voiceLanguage: 'bn', llmProvider: 'ollama', llmModel: 'llama3.2', isLive: true }

    const [jaraUser, proposalCount, smsConfig] = await Promise.all([
      (db as any).user.findUnique({ where: { id: JARA_ID } }).catch(() => null),
      (db as any).jaraProposal.count({ where: { status: 'pending' } }).catch(() => 0),
      (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null),
    ])

    const voice = getVoiceCapability()
    const renderer = getRendererCapability()
    const rendererHealth = await probeRendererHealth()
    const sms = getSmsCapability(smsConfig)

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
      voice,
      renderer: { ...renderer, health: rendererHealth },
      sms,
    })
  } catch (e: any) {
    return json({ status: 'error', error: e.message }, 500)
  }
}
