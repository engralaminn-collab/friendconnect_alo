import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { JARA_ID } from '@/lib/jara'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { assertJaraEnabled } from '@/lib/jara-admin'

// POST /api/jara/group — Jara responds in a group (requires consent + membership)
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  try { await assertJaraEnabled('group') } catch (e: any) { return errorJson(e?.status === 503 ? 'Jara AI is currently disabled by a Super Admin.' : (e?.message || 'Jara unavailable'), e?.status || 403) }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const groupId: string = body.groupId
  const message: string = body.message || body.content || ''
  const mentionJara: boolean = body.mentionJara ?? (message.toLowerCase().includes('jara') || message.includes('@jara'))

  if (!groupId) return errorJson('groupId required', 400)
  if (!message.trim()) return errorJson('message required', 400)

  // Verify user is member
  const membership = await (db as any).groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: me.id } },
  }).catch(() => null)
  if (!membership) return errorJson('Not a member of this group', 403)

  // Check Jara consent for this group
  const consent = await (db as any).jaraGroupConsent.findUnique({ where: { groupId } }).catch(() => null)
  if (!consent || !consent.enabled) {
    return errorJson('Jara is not enabled in this group. Ask an admin to invite Jara.', 403)
  }

  // Check if Jara is member of group
  const jaraMember = await (db as any).groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: JARA_ID } },
  }).catch(() => null)
  if (!jaraMember) return errorJson('Jara is not a member of this group', 403)

  // Only respond if mentioned or group setting allows auto-response (we require mention for privacy)
  if (!mentionJara) {
    return json({ skipped: true, reason: 'Jara only responds when mentioned (@Jara) in groups' })
  }

  // Fetch recent group messages for context
  const recentMessages = await (db as any).message.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  }).catch(() => [])
  const context = recentMessages.reverse().map((m: any) => `${m.senderId === JARA_ID ? 'Jara' : m.senderId === me.id ? 'User' : 'Member'}: ${m.content}`).join('\n')

  const group = await (db as any).group.findUnique({ where: { id: groupId } }).catch(() => null)

  let reply = ''
  if (isAIConfigured()) {
    try {
      reply = await aiChat(
        [{ role: 'user', content: `Group "${group?.name || groupId}" context:\n${context}\n\nLatest message: ${message}\n\nRespond as Jara to the group. Keep it friendly, concise (2-3 sentences), and in the user's language.` }],
        `You are Jara, AI assistant in FriendConnect group "${group?.name || 'Group'}". Be helpful, friendly, and concise. You are clearly AI.`
      )
    } catch { reply = fallbackGroup(message) }
  } else {
    reply = fallbackGroup(message)
  }

  // Persist Jara group message
  const msg = await (db as any).message.create({
    data: {
      senderId: JARA_ID,
      groupId,
      content: reply.slice(0, 2000),
      type: 'text',
      status: 'SENT',
    },
  })

  return json({ reply, message: { id: msg.id, content: reply, groupId, senderId: JARA_ID, createdAt: msg.createdAt } })
}

function fallbackGroup(msg: string): string {
  if (/hello|hi/i.test(msg)) return "Hello everyone! I'm Jara — happy to be here! How can I help the group today? 😊"
  if (/summarize/i.test(msg)) return "This group has been chatting about various topics. Let me know what you'd like summarized!"
  return `Thanks for mentioning me! I'm Jara — your group AI assistant. You said: "${msg.slice(0, 80)}" — how can I help?`
}
