import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { getAvatarRenderJobStatus, getRendererCapability, submitAvatarRenderJob } from '@/lib/jara-renderer'
import { enqueueJob } from '@/lib/jara-jobs'

export async function GET(req: NextRequest) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const jobId = req.nextUrl.searchParams.get('jobId')?.trim()
  if (!jobId) return errorJson('jobId required', 400)
  const res = await getAvatarRenderJobStatus(jobId)
  if (!res.ok) return errorJson(res.error || 'Status check failed', res.httpStatus || 502)
  return json(res)
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  let meeting: any = null
  if (typeof body.meetingProfileId === 'string' && body.meetingProfileId.trim()) {
    meeting = await (db as any).jaraMeetingProfile.findUnique({ where: { id: body.meetingProfileId.trim() } }).catch(() => null)
    if (!meeting) return errorJson('Meeting profile not found', 404)
  }

  const cap = getRendererCapability()
  if (cap.mode === 'browser_fallback') {
    return errorJson(
      'External GPU avatar / ComfyUI / RunningHub renderer is not configured. Browser fallback cannot render video jobs.',
      503,
    )
  }

  const res = await submitAvatarRenderJob({
    title: body.title ?? meeting?.title ?? undefined,
    script: body.script ?? meeting?.script ?? undefined,
    referenceImageUrl: body.referenceImageUrl ?? meeting?.referenceImageUrl ?? null,
    referenceVideoUrl: body.referenceVideoUrl ?? meeting?.referenceVideoUrl ?? null,
    voiceSampleUrl: body.voiceSampleUrl ?? meeting?.voiceSampleUrl ?? null,
    voiceLanguage: body.voiceLanguage ?? meeting?.voiceLanguage ?? undefined,
    background: body.background ?? meeting?.background ?? undefined,
    clothing: body.clothing ?? meeting?.clothing ?? undefined,
    workflowPayload: body.workflowPayload && typeof body.workflowPayload === 'object' ? body.workflowPayload : undefined,
  })

  // Durable job record (Temporal-inspired registry) so Super Admins can see and cancel
  // external render dispatches even if the worker's own job id is lost. Best effort —
  // never blocks the render path.
  if (res.ok && res.jobId) {
    try {
      await enqueueJob({
        type: 'avatar_render',
        idempotencyKey: `avatar_render:${res.backend}:${res.jobId}`,
        payload: { backend: res.backend, workerJobId: res.jobId, meetingProfileId: meeting?.id ?? null, createdBy: me.id },
        createdBy: me.id,
        maxAttempts: 1,
      })
    } catch (e: any) {
      console.warn(`[jara-jobs] enqueue avatar_render failed: ${e?.message || e}`)
    }
  }

  if (meeting?.id) {
    await (db as any).jaraMeetingProfile.update({
      where: { id: meeting.id },
      data: { rendererStatus: res.ok ? `${res.backend}:${res.status || 'queued'}` : `${res.backend}:failed` },
    }).catch(() => {})
  }

  await writeJaraAudit({
    action: 'config_change',
    actorId: me.id,
    actorRole: me.role,
    detail: res.ok
      ? `Submitted avatar render job ${res.jobId || ''} via ${res.backend}`
      : `Avatar render dispatch failed (${res.backend}): ${res.error}`,
    newValue: { backend: res.backend, jobId: res.jobId || null, ok: res.ok },
    authorizationResult: res.ok ? 'allowed' : 'error',
    ...requestMeta(req),
  })

  if (!res.ok) return errorJson(res.error || 'Render dispatch failed', res.httpStatus || 502)
  return json(res, 202)
}
