import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  if (me.role !== 'admin' && me.role !== 'superadmin') return errorJson('Forbidden — Super Admin only', 403)

  const proposal: any = await (db as any).jaraProposal.findUnique({ where: { id } }).catch(() => null)
  if (!proposal) return errorJson('Proposal not found', 404)
  if (proposal.status !== 'pending') return errorJson(`Proposal already ${proposal.status}`, 409)

  const expiresAt = new Date(proposal.expiresAt).getTime()
  if (Date.now() > expiresAt) {
    try { await (db as any).jaraProposal.update({ where: { id }, data: { status: 'expired' } }) } catch {}
    return errorJson('Proposal has expired', 410)
  }

  await (db as any).jaraProposal.update({ where: { id }, data: { status: 'rejected' } })
  await (db as any).jaraAuditLog.create({
    data: {
      proposalId: id,
      version: proposal.version,
      action: 'reject',
      actorId: me.id,
      actorRole: me.role,
      detail: `Rejected v${proposal.version} by ${me.id}`,
      ip: req.headers.get('x-forwarded-for') || 'unknown',
    },
  })

  return json({ ok: true, proposal: { ...proposal, status: 'rejected' } })
}
