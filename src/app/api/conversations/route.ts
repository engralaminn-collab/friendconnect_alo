import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { z } from "zod"

// List conversations for the current user, with last message preview + unread counts
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const memberships = await db.conversationMember.findMany({
    where: { userId: me.id },
    include: {
      conversation: {
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true, name: true, avatarUrl: true, status: true, lastSeenAt: true } },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true, content: true, createdAt: true, senderId: true,
              deletedForAll: true, attachments: { select: { id: true, filename: true, mimeType: true, url: true } },
            },
          },
        },
      },
    },
    orderBy: { pinned: "desc" },
  })

  const conversations = memberships
    .map((m) => {
      const conv = m.conversation
      const other = conv.type === "direct"
        ? conv.members.find((mm) => mm.userId !== me.id)?.user
        : null
      const lastMsg = conv.messages[0] || null
      const unread = lastMsg && m.lastReadAt && lastMsg.createdAt > m.lastReadAt && lastMsg.senderId !== me.id ? 1 : 0
      return {
        id: conv.id,
        type: conv.type,
        title: conv.title || (other ? other.name : conv.title || "Untitled"),
        avatarUrl: conv.type === "direct" ? other?.avatarUrl : conv.avatarUrl,
        description: conv.description,
        ownerId: conv.ownerId,
        otherUser: other,
        members: conv.members.map((mm) => ({
          userId: mm.userId,
          role: mm.role,
          user: mm.user,
        })),
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.deletedForAll ? "🗑️ message deleted" : lastMsg.content || "📎 attachment",
              createdAt: lastMsg.createdAt,
              senderId: lastMsg.senderId,
              attachments: lastMsg.attachments,
            }
          : null,
        unreadCount: unread,
        pinned: m.pinned,
        muted: m.muted,
        lastReadAt: m.lastReadAt,
      }
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const at = a.lastMessage?.createdAt?.getTime() || 0
      const bt = b.lastMessage?.createdAt?.getTime() || 0
      return bt - at
    })

  return NextResponse.json({ conversations })
}

const CreateConvSchema = z.object({
  type: z.enum(["direct", "group"]),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  memberIds: z.array(z.string()).min(1).max(50),
})

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = CreateConvSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 })

  const { type, title, description, memberIds } = parsed.data
  const uniqueMembers = Array.from(new Set([me.id, ...memberIds]))

  if (type === "direct") {
    // For direct, exactly 2 members; reuse existing if any
    const otherId = memberIds[0]
    if (!otherId) return NextResponse.json({ error: "Missing member" }, { status: 400 })
    const existing = await db.conversation.findFirst({
      where: {
        type: "direct",
        AND: [
          { members: { some: { userId: me.id } } },
          { members: { some: { userId: otherId } } },
        ],
      },
    })
    if (existing) return NextResponse.json({ conversation: existing, existed: true })
  }

  const conv = await db.conversation.create({
    data: {
      type,
      title: type === "group" ? title || "New group" : null,
      description,
      ownerId: type === "group" ? me.id : null,
      members: {
        create: uniqueMembers.map((uid) => ({
          userId: uid,
          role: uid === me.id && type === "group" ? "owner" : "member",
        })),
      },
    },
    include: { members: true },
  })
  return NextResponse.json({ conversation: conv }, { status: 201 })
}
