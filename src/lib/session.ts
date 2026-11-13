import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export type CurrentUser = {
  id: string
  username: string
  name: string
  email: string
  avatarUrl: string | null
  bio: string | null
  status: string
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as any)?.id
  if (!id) return null
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      avatarUrl: true,
      bio: true,
      status: true,
    },
  })
  return user
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) throw new Error("UNAUTHORIZED")
  return u
}
