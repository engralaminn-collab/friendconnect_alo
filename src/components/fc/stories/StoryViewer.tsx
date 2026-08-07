'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Eye, ChevronLeft, ChevronRight, Send, MessageCircle, Loader2 } from 'lucide-react'
import { api, timeAgo } from '@/lib/api'
import { UserAvatar } from '@/components/fc/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface StoryItem {
  id: string
  type: 'text' | 'image'
  content: string
  bg: string | null
  createdAt: string
  expiresAt: string
  viewedByMe: boolean
  viewCount: number
}

export interface StoryViewerUser {
  userId: string
  name: string
  photoUrl: string | null
  isMe: boolean
}

export interface StoryReply {
  id: string
  userId: string
  userName: string
  userPhoto: string | null
  content: string
  createdAt: string
}

interface StoryViewerProps {
  stories: StoryItem[]
  user: StoryViewerUser
  onClose: () => void
  onNavigate?: (userId: string) => void
}

const STORY_DURATION_MS = 5000

/**
 * Full-screen story viewer modal.
 * - Progress bars at top (one per story, active fills over ~5s)
 * - Auto-advance to next story after 5s; after last, close
 * - Tap left/right thirds to go prev/next, center third to close
 * - Text stories: full-screen centered text on `bg` background (gradient fallback)
 * - Image stories: full-screen <img object-contain>
 * - Header: avatar + name + timeAgo + close. If isMe, shows viewCount.
 * - On viewing each story for the first time: POST /api/stories/[id]/view
 * - Keyboard: Escape to close, ArrowLeft/ArrowRight to navigate
 */
export function StoryViewer({ stories, user, onClose }: StoryViewerProps) {
  const [index, setIndex] = useState(0)
  const [imgError, setImgError] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [replies, setReplies] = useState<StoryReply[]>([])
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [paused, setPaused] = useState(false)
  const viewedRef = useRef<Set<string>>(new Set())
  const touchStartX = useRef<number | null>(null)
  const progressBarRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const pausedAtRef = useRef<number | null>(null)
  const pausedAccRef = useRef<number>(0)
  const pausedRef = useRef(false)
  const goNextRef = useRef<() => void>(() => {})

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= stories.length) {
        onClose()
        return i
      }
      return i + 1
    })
  }, [stories.length, onClose])

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  // Reset image error state when index changes
  useEffect(() => {
    setImgError(false)
  }, [index])

  // Reset reply text + close replies popover when story changes
  useEffect(() => {
    setReplyText('')
    setRepliesOpen(false)
  }, [index])

  // Mark the active story as viewed (once per story id)
  useEffect(() => {
    const story = stories[index]
    if (!story) return
    if (viewedRef.current.has(story.id)) return
    viewedRef.current.add(story.id)
    api(`/api/stories/${story.id}/view`, { method: 'POST' }).catch(() => {
      /* silent — view tracking is best-effort */
    })
  }, [index, stories])

  // Keep refs in sync (used by the rAF auto-advance timer)
  useEffect(() => {
    goNextRef.current = goNext
  }, [goNext])
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Fetch replies when viewing own story (and when story changes)
  useEffect(() => {
    if (!user.isMe) {
      setReplies([])
      return
    }
    const story = stories[index]
    if (!story) return
    let cancelled = false
    setLoadingReplies(true)
    api<{ replies: StoryReply[] }>(`/api/stories/${story.id}/replies`)
      .then((data) => {
        if (!cancelled) setReplies(data.replies)
      })
      .catch(() => {
        if (!cancelled) setReplies([])
      })
      .finally(() => {
        if (!cancelled) setLoadingReplies(false)
      })
    return () => {
      cancelled = true
    }
  }, [index, user.isMe, stories])

  // Auto-advance timer using requestAnimationFrame (pauses while the reply input is focused).
  // Replaces the previous framer-motion progress bar so we can cleanly pause/resume on input focus.
  useEffect(() => {
    startRef.current = Date.now()
    pausedAtRef.current = pausedRef.current ? Date.now() : null
    pausedAccRef.current = 0
    if (progressBarRef.current) progressBarRef.current.style.width = '0%'

    const tick = () => {
      if (pausedAtRef.current === null) {
        const elapsed = Date.now() - startRef.current - pausedAccRef.current
        const p = Math.min(1, elapsed / STORY_DURATION_MS)
        if (progressBarRef.current) {
          progressBarRef.current.style.width = `${p * 100}%`
        }
        if (p >= 1) {
          goNextRef.current()
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [index])

  // Pause/resume handler (driven by reply input focus)
  useEffect(() => {
    if (paused) {
      pausedAtRef.current = Date.now()
    } else if (pausedAtRef.current !== null) {
      pausedAccRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = null
    }
  }, [paused])

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, goNext, goPrev])

  // Touch swipe support (left = next, right = prev, down = close)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 50) return
    if (dx < 0) goNext()
    else goPrev()
  }

  // Post a reply to the current story (friends only — backend enforces).
  const handleSendReply = useCallback(async () => {
    const story = stories[index]
    if (!story) return
    const content = replyText.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const data = await api<{ reply: StoryReply }>(`/api/stories/${story.id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      // If we happen to be viewing our own story, surface our own reply in the list.
      if (user.isMe) {
        setReplies((prev) => [...prev, data.reply])
      }
      setReplyText('')
      toast.success('Reply sent')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }, [stories, index, replyText, sending, user.isMe])

  if (!stories.length) {
    return null
  }

  const current = stories[index]
  if (!current) return null

  const bgStyle = current.bg || 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[90] bg-black select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Story content (crossfades between stories) */}
      <AnimatePresence>
        <motion.div
          key={current.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0"
        >
          {current.type === 'image' && !imgError ? (
            <img
              src={current.content}
              alt={user.name ? `${user.name}'s story` : 'Story'}
              className="h-full w-full object-contain"
              onError={() => setImgError(true)}
            />
          ) : current.type === 'image' && imgError ? (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center"
              style={{ background: 'linear-gradient(135deg, #1f1f23, #000000)' }}
            >
              <p className="text-lg font-semibold text-white">Image unavailable</p>
              <p className="text-sm text-white/60">This story media could not be loaded.</p>
            </div>
          ) : (
            <div
              className="flex h-full w-full items-center justify-center p-8"
              style={{ background: bgStyle }}
            >
              <p className="whitespace-pre-wrap break-words text-center text-2xl font-bold leading-snug text-white drop-shadow-sm sm:text-3xl md:text-4xl">
                {current.content}
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Tap zones (left = prev, center = close, right = next) */}
      <div className="absolute inset-0 z-10 flex">
        <button
          type="button"
          aria-label="Previous story"
          onClick={goPrev}
          className="h-full w-1/3 cursor-pointer"
        />
        <button
          type="button"
          aria-label="Close story viewer"
          onClick={onClose}
          className="h-full w-1/3 cursor-pointer"
        />
        <button
          type="button"
          aria-label="Next story"
          onClick={goNext}
          className="h-full w-1/3 cursor-pointer"
        />
      </div>

      {/* Progress bars */}
      <div className="fc-safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex gap-1 p-3">
        {stories.map((s, i) => (
          <div
            key={s.id}
            className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30"
          >
            {i < index ? (
              <div className="h-full w-full bg-white" />
            ) : i === index ? (
              <div
                ref={progressBarRef}
                className="h-full bg-white"
                style={{ width: '0%' }}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* Header: avatar + name + views (if me) + time + close */}
      <div className="fc-safe-top pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-4 pt-7">
        <div className="pointer-events-auto">
          <UserAvatar name={user.name} src={user.photoUrl} size={38} />
        </div>
        <div className="pointer-events-auto min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-white drop-shadow-sm">
              {user.name}
            </span>
            {user.isMe && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <Eye size={11} />
                {current.viewCount} {current.viewCount === 1 ? 'view' : 'views'}
              </span>
            )}
            <span className="text-xs text-white/70 drop-shadow-sm">
              {timeAgo(current.createdAt)}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          <X size={22} />
        </button>
      </div>

      {/* Side nav arrows (desktop / large screens) */}
      <button
        type="button"
        aria-label="Previous"
        onClick={goPrev}
        className={cn(
          'absolute left-2 top-1/2 z-30 hidden -translate-y-1/2 place-items-center rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-95 md:grid',
          index === 0 && 'pointer-events-none opacity-0'
        )}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={goNext}
        className="absolute right-2 top-1/2 z-30 hidden -translate-y-1/2 place-items-center rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-95 md:grid"
      >
        <ChevronRight size={22} />
      </button>

      {/* Subtle bottom gradient for legibility on image stories */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-black/50 to-transparent" />

      {/* Reply input bar (others) OR Replies button + popover (own story) */}
      <div className="absolute bottom-4 left-4 right-4 z-10">
        {user.isMe ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setRepliesOpen((v) => !v)}
              aria-expanded={repliesOpen}
              aria-label="View story replies"
              className="flex w-full items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-white backdrop-blur transition hover:bg-black/60"
            >
              <MessageCircle size={16} />
              <span className="flex-1 text-left text-sm">
                {loadingReplies
                  ? 'Loading replies…'
                  : replies.length === 0
                  ? 'No replies yet'
                  : `Replies (${replies.length})`}
              </span>
              {repliesOpen ? <X size={16} /> : null}
            </button>
            <AnimatePresence>
              {repliesOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                  className="fc-scroll absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl bg-black/80 p-2 backdrop-blur"
                >
                  {loadingReplies && replies.length === 0 ? (
                    <div className="grid place-items-center py-8">
                      <Loader2 size={20} className="animate-spin text-white/70" />
                    </div>
                  ) : replies.length === 0 ? (
                    <div className="grid place-items-center gap-2 py-8 text-center text-sm text-white/60">
                      <MessageCircle size={24} className="opacity-50" />
                      No replies yet
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {replies.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-start gap-2 rounded-lg p-2 transition hover:bg-white/5"
                        >
                          <UserAvatar name={r.userName} src={r.userPhoto} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-white">
                                {r.userName}
                              </span>
                              <span className="shrink-0 text-[10px] text-white/50">
                                {timeAgo(r.createdAt)}
                              </span>
                            </div>
                            <p className="break-words text-sm text-white/90">{r.content}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendReply()
            }}
            className="flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-white backdrop-blur"
          >
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendReply()
                }
              }}
              placeholder={`Reply to ${user.name.split(' ')[0]}…`}
              maxLength={500}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/60"
              aria-label="Reply to story"
            />
            <button
              type="submit"
              disabled={!replyText.trim() || sending}
              aria-label="Send reply"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </button>
          </form>
        )}
      </div>
    </motion.div>
  )
}
