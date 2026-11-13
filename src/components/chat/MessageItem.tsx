"use client"

import { useState, useRef, useEffect } from "react"
import { Avatar } from "./Avatar"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/api"
import {
  Smile, Star, MoreVertical, Pencil, Trash2, Reply, CornerUpRight,
  Check, CheckCheck, Download,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"

export interface MessageData {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  editedAt?: string | null
  deletedForAll?: boolean
  sender: { id: string; username: string; name: string; avatarUrl?: string | null }
  attachments?: { id: string; filename: string; mimeType: string; url: string; thumbUrl?: string | null }[]
  reactions?: { id: string; emoji: string; userId: string; user: { id: string; username: string } }[]
  reads?: { userId: string; readAt: string }[]
  replyTo?: { id: string; content: string; senderId: string; sender: { username: string; name: string } } | null
}

const EMOJI_LIST = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👏"]

export function MessageItem({
  message,
  currentUserId,
  isGroup,
  showSender,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onStar,
  starred,
}: {
  message: MessageData
  currentUserId: string
  isGroup: boolean
  showSender: boolean
  onReply: (m: MessageData) => void
  onEdit: (m: MessageData) => void
  onDelete: (m: MessageData, scope: "self" | "all") => void
  onReact: (m: MessageData, emoji: string) => void
  onStar: (m: MessageData) => void
  starred: boolean
}) {
  const isMine = message.senderId === currentUserId
  const [hovered, setHovered] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)

  const reactionsByEmoji: Record<string, { count: number; mine: boolean }> = {}
  for (const r of message.reactions || []) {
    if (!reactionsByEmoji[r.emoji]) reactionsByEmoji[r.emoji] = { count: 0, mine: false }
    reactionsByEmoji[r.emoji].count++
    if (r.userId === currentUserId) reactionsByEmoji[r.emoji].mine = true
  }

  const readByOther = (message.reads || []).some((r) => r.userId !== currentUserId)

  if (message.deletedForAll) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"} px-2`}>
        <div className="text-xs text-muted-foreground italic px-3 py-2 rounded-lg bg-muted/50 max-w-[75%]">
          🗑️ This message was deleted
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group flex gap-2 px-2 ${isMine ? "flex-row-reverse" : "flex-row"} ${showSender ? "mt-3" : "mt-0.5"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar (left side for non-mine, hidden for mine) */}
      {!isMine && (
        <div className="w-8 shrink-0 self-end">
          {showSender ? <Avatar name={message.sender.name} src={message.sender.avatarUrl} size={32} /> : null}
        </div>
      )}
      {isMine && <div className="w-8 shrink-0" />}

      {/* Bubble */}
      <div className={`flex flex-col max-w-[78%] ${isMine ? "items-end" : "items-start"}`}>
        {showSender && !isMine && (
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-0.5 px-1">
            {message.sender.name}
          </div>
        )}

        {/* Reply context */}
        {message.replyTo && (
          <div
            className={`text-xs px-2 py-1 mb-0.5 rounded-md border-l-2 border-emerald-500 bg-muted/60 ${
              isMine ? "self-end" : "self-start"
            }`}
          >
            <div className="font-medium text-emerald-600 dark:text-emerald-400">
              {message.replyTo.sender.name}
            </div>
            <div className="text-muted-foreground line-clamp-1">{message.replyTo.content || "[attachment]"}</div>
          </div>
        )}

        <div
          className={`relative rounded-2xl px-3 py-2 ${
            isMine
              ? "bg-emerald-500 text-white rounded-br-md"
              : "bg-muted text-foreground rounded-bl-md"
          }`}
        >
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className={`mb-2 grid gap-1 ${message.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {message.attachments.map((a) => (
                <Attachment key={a.id} a={a} />
              ))}
            </div>
          )}

          {/* Text */}
          {message.content && (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {message.content}
            </div>
          )}

          {/* Footer: time + edited + read receipts */}
          <div className={`flex items-center gap-1 mt-0.5 ${isMine ? "justify-end" : "justify-start"} ${isMine ? "text-emerald-50/80" : "text-muted-foreground"}`}>
            {message.editedAt && <span className="text-[10px] italic">edited</span>}
            <span className="text-[10px]">{formatTime(message.createdAt)}</span>
            {isMine && (
              readByOther
                ? <CheckCheck className="w-3 h-3" />
                : <Check className="w-3 h-3" />
            )}
          </div>

          {/* Hover actions */}
          {hovered && (
            <div
              className={`absolute top-0 ${isMine ? "left-0 -translate-x-full -ml-1" : "right-0 translate-x-full mr-1"} flex items-center gap-0.5 bg-background/95 border border-border rounded-full shadow px-1 py-0.5`}
            >
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <button className="p-1 rounded-full hover:bg-muted" aria-label="React">
                    <Smile className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1" align="center">
                  <div className="grid grid-cols-8 gap-0.5">
                    {EMOJI_LIST.map((e) => (
                      <button
                        key={e}
                        className="text-lg hover:bg-muted rounded px-1"
                        onClick={() => {
                          onReact(message, e)
                          setEmojiOpen(false)
                        }}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <button
                className="p-1 rounded-full hover:bg-muted"
                onClick={() => onReply(message)}
                aria-label="Reply"
              >
                <Reply className="w-3.5 h-3.5" />
              </button>
              <button
                className={`p-1 rounded-full hover:bg-muted ${starred ? "text-amber-500" : ""}`}
                onClick={() => onStar(message)}
                aria-label="Star"
              >
                <Star className="w-3.5 h-3.5" fill={starred ? "currentColor" : "none"} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1 rounded-full hover:bg-muted" aria-label="More">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isMine ? "start" : "end"}>
                  <DropdownMenuItem onClick={() => onReact(message, "👍")}>
                    <Smile className="w-4 h-4 mr-2" /> React 👍
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onReply(message)}>
                    <CornerUpRight className="w-4 h-4 mr-2" /> Reply
                  </DropdownMenuItem>
                  {isMine && !message.deletedForAll && (
                    <>
                      <DropdownMenuItem onClick={() => onEdit(message)}>
                        <Pencil className="w-4 h-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-rose-600" onClick={() => onDelete(message, "all")}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete for everyone
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Reactions */}
        {Object.keys(reactionsByEmoji).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
            {Object.entries(reactionsByEmoji).map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={() => onReact(message, emoji)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border ${
                  info.mine
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted border-border"
                }`}
              >
                <span>{emoji}</span>
                <span className="text-[10px]">{info.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Attachment({ a }: { a: { id: string; filename: string; mimeType: string; url: string; thumbUrl?: string | null } }) {
  const isImage = a.mimeType.startsWith("image/")
  const isVideo = a.mimeType.startsWith("video/")
  const isAudio = a.mimeType.startsWith("audio/")

  if (isImage) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block">
        { }
        <img src={a.url} alt={a.filename} className="rounded-lg max-h-60 max-w-full object-cover" />
      </a>
    )
  }
  if (isVideo) {
    return <video src={a.url} controls className="rounded-lg max-h-60 max-w-full" />
  }
  if (isAudio) {
    return (
      <div className="bg-background/10 rounded-lg p-2">
        <audio src={a.url} controls className="w-full h-8" />
      </div>
    )
  }
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 bg-background/10 rounded-lg p-2 hover:bg-background/20 transition"
    >
      <Download className="w-4 h-4" />
      <span className="text-sm truncate">{a.filename}</span>
    </a>
  )
}
