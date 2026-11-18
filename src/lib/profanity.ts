// Simple profanity filter — blocks common bad words.
// For production, use a more comprehensive list or an AI moderation service.

const BAD_WORDS = [
  "fuck", "shit", "ass", "bitch", "bastard", "damn", "crap", "dick",
  "piss", "cock", "pussy", "asshole", "motherfucker", "wanker", "twat",
  "cunt", "slut", "whore", "nigger", "faggot", "retard", "rape",
]

const MASK_CHAR = "*"

export function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase()
  return BAD_WORDS.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "i")
    return regex.test(lower)
  })
}

export function filterProfanity(text: string): string {
  let result = text
  for (const word of BAD_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi")
    result = result.replace(regex, word[0] + MASK_CHAR.repeat(word.length - 2) + word[word.length - 1] || MASK_CHAR.repeat(word.length))
  }
  return result
}

export function getProfanityFilter() {
  return { containsProfanity, filterProfanity }
}
