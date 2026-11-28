/**
 * Jara knowledge retrieval — offline, dependency-free RAG-lite.
 *
 * Inspired by the retrieval stacks shipped alongside LibreChat (rag-api) and
 * Open WebUI (Knowledge Bases, oikb), but deliberately limited:
 *
 *   - Only Super-Admin-approved `JaraKnowledgeSource` rows are searchable.
 *     Draft/archived content can never leak into a Jara answer.
 *   - Lexical BM25-lite scoring (no embeddings, no vector DB, no external
 *     service). This keeps data inside the deployment and adds zero deps.
 *     If/when the org approves a vector store, swap `searchApprovedKnowledge`;
 *     the call sites and governance gates stay the same.
 *   - Pure scoring functions are exported for unit tests; the database is
 *     imported lazily so this module is safe to load anywhere.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'by', 'from', 'as', 'and', 'or', 'but', 'if', 'then', 'so', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'them',
  'me', 'my', 'your', 'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
  'why', 'can', 'could', 'should', 'would', 'will', 'may', 'might', 'do', 'does', 'did', 'has',
  'have', 'had', 'not', 'no', 'yes', 'on', 'off', 'up', 'down', 'out', 'about', 'into', 'over',
  'after', 'before', 'between', 'through', 'during', 'খুব', 'এবং', 'এর', 'এ', 'তে', 'থেকে',
])

export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

export interface ScoredDocument {
  index: number
  score: number
  matches: number
}

/**
 * BM25-lite: idf from document frequency + saturating term frequency.
 * `documents` is an array of pre-tokenized documents.
 */
export function rankDocuments(query: string, documents: string[][], k1 = 1.2, b = 0.75): ScoredDocument[] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0 || documents.length === 0) {
    return documents.map((_, index) => ({ index, score: 0, matches: 0 }))
  }
  const docCount = documents.length
  const avgLen = documents.reduce((acc, d) => acc + d.length, 0) / docCount || 1

  // document frequency
  const df = new Map<string, number>()
  const qSet = new Set(qTokens)
  for (const doc of documents) {
    const seen = new Set(doc)
    for (const token of qSet) {
      if (seen.has(token)) df.set(token, (df.get(token) || 0) + 1)
    }
  }

  const results: ScoredDocument[] = []
  for (let index = 0; index < documents.length; index += 1) {
    const doc = documents[index]
    if (doc.length === 0) {
      results.push({ index, score: 0, matches: 0 })
      continue
    }
    const tf = new Map<string, number>()
    for (const token of doc) {
      if (qSet.has(token)) tf.set(token, (tf.get(token) || 0) + 1)
    }
    let score = 0
    let matches = 0
    for (const [token, freq] of tf) {
      matches += 1
      const dferr = df.get(token) || 0
      const idf = Math.log(1 + (docCount - dferr + 0.5) / (dferr + 0.5))
      const norm = freq * (k1 + 1) / (freq + k1 * (1 - b + (b * doc.length) / avgLen))
      score += idf * norm
    }
    results.push({ index, score, matches })
  }
  return results
}

/** Extract a short snippet around the first occurrence of any query token. */
export function buildSnippet(content: string, query: string, maxLength = 320): string {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  const qTokens = tokenize(query)
  const lower = text.toLowerCase()
  let hit = -1
  for (const token of qTokens) {
    const idx = lower.indexOf(token)
    if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx
  }
  if (hit === -1) return `${text.slice(0, maxLength - 1)}…`
  const half = Math.floor(maxLength / 2)
  const start = Math.max(0, hit - half)
  const end = Math.min(text.length, start + maxLength)
  const adjustedStart = Math.max(0, end - maxLength)
  return `${adjustedStart > 0 ? '…' : ''}${text.slice(adjustedStart, end)}${end < text.length ? '…' : ''}`
}

export interface KnowledgeHit {
  id: string
  title: string
  sourceType: string
  language: string | null
  snippet: string
  score: number
}

/**
 * Search approved knowledge sources. Returns [] on any database failure —
 * retrieval must never break a Jara conversation.
 */
export async function searchApprovedKnowledge(query: string, limit = 3): Promise<KnowledgeHit[]> {
  const trimmed = String(query || '').trim()
  if (!trimmed) return []
  const cap = Math.max(1, Math.min(Number(limit) || 3, 8))

  let rows: any[] = []
  try {
    const { db } = await import('@/lib/db')
    rows = await (db as any).jaraKnowledgeSource.findMany({
      where: { status: 'approved', isApproved: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, sourceType: true, language: true, content: true },
    })
  } catch (e: any) {
    console.warn(`[jara-knowledge] approved-source query failed: ${e?.message || e}`)
    return []
  }

  const usable = rows.filter((row) => typeof row?.content === 'string' && row.content.trim().length > 0)
  if (usable.length === 0) return []

  const ranked = rankDocuments(trimmed, usable.map((row) => tokenize(`${row.title} ${row.content}`)))
  return ranked
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((entry) => {
      const row = usable[entry.index]
      return {
        id: String(row.id),
        title: String(row.title),
        sourceType: String(row.sourceType || 'text'),
        language: row.language ?? null,
        snippet: buildSnippet(String(row.content), trimmed),
        score: Number(entry.score.toFixed(4)),
      }
    })
}
