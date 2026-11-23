import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, getLiveJaraConfig } from '@/lib/jara-admin'

export async function GET(_req: NextRequest) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  const cfg = await getLiveJaraConfig()
  const [profiles, donors, smsMessages, consents, meetings, knowledge, proposals, audits] = await Promise.all([
    (db as any).jaraAppearanceProfile.count().catch(() => 0),
    (db as any).jaraDonorContribution.count().catch(() => 0),
    (db as any).jaraSmsMessage.count().catch(() => 0),
    (db as any).jaraConsentRecord.count().catch(() => 0),
    (db as any).jaraMeetingIntegration.count().catch(() => 0),
    (db as any).jaraKnowledgeSource.count().catch(() => 0),
    (db as any).jaraProposal.count({ where: { status: 'pending' } }).catch(() => 0),
    (db as any).jaraAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }).catch(() => []),
  ])

  return json({
    config: cfg,
    modules: {
      identity: { status: 'active' },
      appearanceProfiles: { status: 'active', count: profiles },
      voiceLanguage: { status: 'active' },
      sms: { status: cfg?.smsEnabled ? 'configured' : 'disabled', count: smsMessages },
      calls: { status: cfg?.callsEnabled ? 'active' : 'disabled' },
      meetings: { status: cfg?.meetingsEnabled ? 'configured' : 'disabled', count: meetings },
      knowledge: { status: 'active', count: knowledge },
      donors: { status: 'active', count: donors },
      consent: { status: 'active', count: consents },
      audit: { status: 'active' },
      emergency: { status: cfg?.isEnabled === false ? 'disabled' : 'enabled' },
    },
    pendingProposals: proposals,
    recentAudit: audits,
  })
}