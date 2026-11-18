// Parse @username mentions from message text.
// Returns the text with mentions highlighted + list of mentioned usernames.

export interface Mention {
  username: string
  start: number
  end: number
}

export function parseMentions(text: string): { text: string; mentions: Mention[] } {
  const regex = /@([a-zA-Z0-9_]+)/g
  const mentions: Mention[] = []
  let match

  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      username: match[1],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return { text, mentions }
}

// Render message text with mentions as HTML-safe segments
export function renderMentions(text: string): { type: "text" | "mention"; content: string }[] {
  const { mentions } = parseMentions(text)
  if (mentions.length === 0) return [{ type: "text", content: text }]

  const segments: { type: "text" | "mention"; content: string }[] = []
  let lastEnd = 0

  for (const m of mentions) {
    if (m.start > lastEnd) {
      segments.push({ type: "text", content: text.slice(lastEnd, m.start) })
    }
    segments.push({ type: "mention", content: m.username })
    lastEnd = m.end
  }

  if (lastEnd < text.length) {
    segments.push({ type: "text", content: text.slice(lastEnd) })
  }

  return segments
}
