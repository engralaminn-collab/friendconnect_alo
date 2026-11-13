import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null
        const ident = credentials.identifier.trim().toLowerCase()
        const user = await db.user.findFirst({
          where: { OR: [{ email: ident }, { username: ident }] },
        })
        if (!user) return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null
        await db.user.update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
        })
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
        } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
        token.username = (user as any).username
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).username = token.username
      }
      return session
    },
  },
  pages: { signIn: "/" },
  secret: process.env.NEXTAUTH_SECRET || "friendconnect-dev-secret-change-in-production",
  debug: false,
}
