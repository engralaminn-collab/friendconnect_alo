"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Loader2, MessageCircle } from "lucide-react"
import { toast } from "sonner"

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [loading, setLoading] = useState(false)

  // login fields
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  // register fields
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [regPassword, setRegPassword] = useState("")

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier || !password) return
    setLoading(true)
    try {
      const res = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      })
      if (!res || !res.ok) {
        toast.error("Invalid credentials")
        return
      }
      toast.success("Welcome back!")
      onAuthed()
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !username || !email || !regPassword) return
    setLoading(true)
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, email, password: regPassword }),
      })
      const body = await r.json()
      if (!r.ok) {
        toast.error(body?.error || "Registration failed")
        return
      }
      // auto-login
      const res = await signIn("credentials", {
        identifier: email,
        password: regPassword,
        redirect: false,
      })
      if (res?.ok) {
        toast.success("Account created!")
        onAuthed()
      } else {
        toast.error("Account created — please sign in")
        setMode("login")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-rose-50 to-violet-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <MessageCircle className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">FriendConnect</h1>
          <p className="text-sm text-muted-foreground">Personal messaging, real and private.</p>
        </div>
        <Card className="border-border/60 shadow-xl">
          <CardHeader className="pb-2">
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign in</TabsTrigger>
                <TabsTrigger value="register">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="login" className="mt-4">
                <CardTitle className="text-lg">Welcome back</CardTitle>
              </TabsContent>
              <TabsContent value="register" className="mt-4">
                <CardTitle className="text-lg">Join FriendConnect</CardTitle>
              </TabsContent>
            </Tabs>
          </CardHeader>
          <CardContent>
            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="identifier">Email or username</Label>
                  <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Sign in
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required placeholder="lowercase, no spaces" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="regPassword">Password</Label>
                  <Input id="regPassword" type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required minLength={6} />
                </div>
                <Button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create account
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Your messages are stored on this self-hosted instance.
        </p>
      </div>
    </div>
  )
}
