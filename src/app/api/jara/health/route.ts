import { json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'
import { db } from '@/lib/db'
import { isAIConfigured, getAIProvider, getAvailableModels } from '@/lib/ai'
import { JARA_ID } from '@/lib/jara'
import { getVoiceCapability } from '@/lib/jara-voice'
import { getRendererCapability, probeRendererHealth } from '@/lib/jara-renderer'
import { getSmsCapability } from '@/lib/jara-sms'
import { listTools } from '@/lib/jara-tools'
import { guardrailsEnabled } from '@/lib/jara-guardrails'

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
      tools: (() => {
        const tools = listTools()
        return {
          registered: tools.length,
          configured: tools.filter((t) => t.configured).length,
          egress: tools.filter((t) => t.egress).map((t) => t.name),
          consequential: [],
        }
      })(),
      guardrails: { enabled: guardrailsEnabled() },
    })
  } catch (error) {
    // Finding 15: this returned the raw exception message, which is exactly the
    // SQLite/Prisma internals leak `@/lib/api-errors` exists to prevent.
    // `handleRouteError` logs the detail server-side with a requestId and returns
    // a generic body.
    return handleRouteError(error, 'GET /api/jara/health')
  }
}
