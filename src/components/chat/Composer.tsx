"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EmojiPicker } from "@/components/chat/EmojiPicker"
import { Paperclip, Send, Smile, X, ImageIcon, Mic } from "lucide-react"
import type { MessageData } from "./MessageItem"

// Emoji picker now uses the comprehensive EmojiPicker component (1440 emojis)

export function Composer({
  onSend,
  onTyping,
  replyingTo,
  onCancelReply,
  editing,
  onCancelEdit,
}: {
  onSend: (content: string, attachmentIds: string[], replyToId?: string | null) => Promise<void>
  onTyping: (isTyping: boolean) => void
  replyingTo: MessageData | null
  onCancelReply: () => void
  editing: MessageData | null
  onCancelEdit: () => void
}) {
  const [text, setText] = useState("")
    const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([])
  const [pendingPreviews, setPendingPreviews] = useState<{ id: string; url: string; mime: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingTimer = useRef<any>(null)
  const lastTypingFired = useRef(false)

  useEffect(() => {
    if (editing) {
      setText(editing.content)
      textareaRef.current?.focus()
    }
  }, [editing])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [text])

  function handleTextChange(v: string) {
    setText(v)
    if (v && !lastTypingFired.current) {
      onTyping(true)
      lastTypingFired.current = true
    }
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      onTyping(false)
      lastTypingFired.current = false
    }, 1500)
  }

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed && pendingAttachments.length === 0) return
    const replyToId = replyingTo?.id || null
    const isEdit = !!editing
    await onSend(trimmed, pendingAttachments, isEdit ? null : replyToId)
    setText("")
    setPendingAttachments([])
    setPendingPreviews([])
    if (isEdit) onCancelEdit()
    if (replyingTo) onCancelReply()
    onTyping(false)
    lastTypingFired.current = false
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === "Escape") {
      if (editing) onCancelEdit()
      if (replyingTo) onCancelReply()
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded: { id: string; url: string; mime: string; filename: string }[] = []
      for (const file of files) {
        const fd = new FormData()
        fd.append("file", file)
        const r = await fetch("/api/upload", { method: "POST", body: fd })
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error || "Upload failed")
        uploaded.push({
          id: body.attachment.id,
          url: body.attachment.url,
          mime: body.attachment.mimeType,
          filename: body.attachment.filename,
        })
      }
      setPendingAttachments((prev) => [...prev, ...uploaded.map((u) => u.id)])
      setPendingPreviews((prev) => [...prev, ...uploaded.map((u) => ({ id: u.id, url: u.url, mime: u.mime }))])
    } catch (err: any) {
      alert(err.message || "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur px-3 py-2">
      {/* Reply preview */}
      {replyingTo && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-muted rounded-md text-xs border-l-2 border-emerald-500">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-emerald-600 dark:text-emerald-400">
              Reply to {replyingTo.sender.name}
            </div>
            <div className="text-muted-foreground line-clamp-1">{replyingTo.content || "[attachment]"}</div>
          </div>
          <button onClick={onCancelReply} className="p-1 hover:bg-background rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {/* Editing preview */}
      {editing && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-amber-500/10 rounded-md text-xs border-l-2 border-amber-500">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-amber-600 dark:text-amber-400">Editing message</div>
            <div className="text-muted-foreground line-clamp-1">{editing.content}</div>
          </div>
          <button onClick={onCancelEdit} className="p-1 hover:bg-background rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Pending attachments preview */}
      {pendingPreviews.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto">
          {pendingPreviews.map((p) => (
            <div key={p.id} className="relative shrink-0">
              {p.mime.startsWith("image/") ? (
                 
                <img src={p.url} alt="" className="w-16 h-16 object-cover rounded-md border" />
              ) : (
                <div className="w-16 h-16 flex items-center justify-center bg-muted rounded-md border text-xs p-1 text-center">
                  {p.mime.split("/")[1] || "file"}
                </div>
              )}
              <button
                onClick={() => {
                  setPendingAttachments((prev) => prev.filter((id) => id !== p.id))
                  setPendingPreviews((prev) => prev.filter((pp) => pp.id !== p.id))
                }}
                className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.xls,.xlsx"
          multiple
        />
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <span className="animate-pulse">…</span> : <Paperclip className="w-5 h-5" />}
        </Button>

        <EmojiPicker
          onPick={(emoji) => {
            setText((prev) => prev + emoji)
            textareaRef.current?.focus()
          }}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Type a message…"
          data-testid="chat-composer-input"
          className="flex-1 resize-none bg-muted rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 max-h-40"
        />

        <Button
          onClick={handleSend}
          data-testid="chat-send"
          aria-label="Send message"
          disabled={!text.trim() && pendingAttachments.length === 0}
          className="rounded-full shrink-0 bg-emerald-500 hover:bg-emerald-600 text-white"
          size="icon"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
