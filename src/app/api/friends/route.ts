import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [sent, received] = await Promise.all([
    db.friendRequest.findMany({
      where: { fromId: me.id, status: "pending" },
      include: { to: { select: { id: true, username: true, name: true, avatarUrl: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.friendRequest.findMany({
      where: { toId: me.id, status: "pending" },
      include: { from: { select: { id: true, username: true, name: true, avatarUrl: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const friendships = await db.friendship.findMany({
    where: { OR: [{ requesterId: me.id, status: 'ACCEPTED' }, { receiverId: me.id, status: 'ACCEPTED' }] },
    include: {
      requester: { select: { id: true, username: true, name: true, avatarUrl: true, status: true, lastSeenAt: true } },
      receiver: { select: { id: true, username: true, name: true, avatarUrl: true, status: true, lastSeenAt: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  const friends = friendships.map((f: any) => (f.requesterId === me.id ? f.receiver : f.requester))

  return NextResponse.json({
    sent: sent.map((r) => ({ id: r.id, to: r.to, createdAt: r.createdAt })),
    received: received.map((r) => ({ id: r.id, from: r.from, createdAt: r.createdAt })),
    friends,
  })
}

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { toId } = await req.json().catch(() => ({}))
  if (!toId || toId === me.id)
    return NextResponse.json({ error: "Invalid target" }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: toId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const blocked = await db.block.findFirst({
    where: { OR: [{ fromId: me.id, toId }, { fromId: toId, toId: me.id }] },
  })
  if (blocked) return NextResponse.json({ error: "Cannot send request due to block" }, { status: 403 })

  const existing = await db.friendRequest.findFirst({
    where: {
      OR: [
        { fromId: me.id, toId },
        { fromId: toId, toId: me.id },
      ],
      status: "pending",
    },
  })
  if (existing) return NextResponse.json({ error: "Request already pending" }, { status: 409 })

  const alreadyFriend = await db.friendship.findFirst({
    where: { OR: [{ requesterId: me.id, receiverId: toId }, { requesterId: toId, receiverId: me.id }] },
  })
  if (alreadyFriend) return NextResponse.json({ error: "Already friends" }, { status: 409 })

  const fr = await db.friendRequest.create({
    data: { fromId: me.id, toId },
  })

  await db.notification.create({
    data: {
      userId: toId,
      type: "friend_request",
      title: "New friend request",
      body: `${me.username} sent you a friend request`,
    },
  })

  return NextResponse.json({ ok: true, request: fr }, { status: 201 })
}
