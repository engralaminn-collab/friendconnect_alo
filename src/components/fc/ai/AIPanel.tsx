"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sparkles, Send, X, Loader2 } from "lucide-react"

interface AIMessage {
  role: "user" | "assistant"
  content: string
}

export function AIPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<AIMessage[]>([
    { role: "assistant", content: "Hi! I'm your AI assistant. I can help you summarize conversations, translate messages, or answer questions. How can I help?" }
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setMessages(prev => [...prev, { role: "user", content: userMsg }])
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMsg }].map(m => ({ role: m.role, content: m.content })),
          systemPrompt: "You are a helpful AI assistant integrated into FriendConnect, a personal messaging app. Be concise and friendly.",
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages(prev => [...prev, { role: "assistant", content: data.response }])
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${data.error || "AI request failed"}` }])
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-medium text-sm">AI Assistant</div>
            <div className="text-xs text-muted-foreground">Powered by FriendConnect AI</div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4" ref={scrollRef as any}>
        <div className="space-y-3 py-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Ask AI anything…"
          disabled={loading}
        />
        <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="rounded-full">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
