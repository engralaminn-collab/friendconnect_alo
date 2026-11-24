'use strict'

async function findCurrentSession(prisma, { userId = null, token = null, issuedAt = null, cookieToken = null } = {}, now = Date.now()) {
  let session = null
  if (typeof token === 'string' && token) {
    session = await prisma.session.findUnique({ where: { token } })
    if (session && userId && session.userId !== userId) return null
  } else if (userId && Number.isFinite(Number(issuedAt)) && Number(issuedAt) > 0) {
    const issued = new Date(Number(issuedAt) * 1000)
    const matches = await prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date(now) },
        createdAt: { gte: new Date(issued.getTime() - 120_000), lte: new Date(issued.getTime() + 120_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
    })
    // Ambiguous legacy JWTs must reauthenticate rather than inherit another device's row.
    if (matches.length === 1) session = matches[0]
  }
  if (!session && typeof cookieToken === 'string' && cookieToken) {
    session = await prisma.session.findUnique({ where: { token: cookieToken } })
    if (session && userId && session.userId !== userId) return null
  }
  if (!session || !session.userId || !session.token || new Date(session.expiresAt).getTime() <= now) return null
  return session
}

module.exports = { findCurrentSession }
