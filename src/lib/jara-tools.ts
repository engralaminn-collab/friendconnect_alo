/**
 * Jara built-in tool registry.
 *
 * Inspired by the tool ecosystems around LibreChat (OpenAPI Actions, MCP) and
 * Open WebUI (Pipelines/tools), but deliberately constrained for FriendConnect:
 *
 *   - Only read-only or user-scoped, reversible tools are registered.
 *   - No arbitrary URL fetching. Network tools hit FIXED, environment-configured
 *     endpoints only (SearXNG/Brave for search; Open-Meteo for weather) — the
 *     SSRF class of bugs is structural, not policy.
 *   - No shell, code execution, or package installation is exposed to the model.
 *     (SWE-agent / code-interpreter style sandboxing stays deferred — see
 *     docs/JARA_OPEN_SOURCE_ADOPTION.md.)
 *   - Every invocation is written to the Jara audit log (best effort).
 *   - Tools are invoked through /api/jara/tools/run by an authenticated user;
 *     Jara chat does not self-authorize tool calls.
 *
 * Database access is lazy so the pure parts (calculator, tokenizer) are unit
 * testable without a database.
 */

import { searchApprovedKnowledge } from './jara-knowledge'

export interface ToolContext {
  userId: string
  actorRole?: string | null
}

export interface ToolResult {
  ok: boolean
  tool: string
  output?: unknown
  error?: string
  /** Suggested HTTP status for the route layer (defaults to 200/400). */
  httpStatus?: number
  /** True when the tool needs an env configuration that is not present. */
  unconfigured?: boolean
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, string>
  /** True when the tool performs network egress to a third party. */
  egress: boolean
  /** True when the tool is usable right now in this environment. */
  configured: boolean
  /** Consequential tools would change state; none are registered today. */
  consequential: boolean
}

const FETCH_TIMEOUT_MS = 8000
const MAX_RESULTS = 8
const MAX_QUERY_LENGTH = 300

// ============================================================
// Safe expression evaluator (no eval, no Function)
// ============================================================

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'lparen' } | { type: 'rparen' }

function tokenizeExpression(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const src = input.replace(/\s+/g, '')
  while (i < src.length) {
    const ch = src[i]
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1
      const raw = src.slice(i, j)
      if ((raw.match(/\./g) || []).length > 1) return null
      const value = Number(raw)
      if (!Number.isFinite(value)) return null
      tokens.push({ type: 'num', value })
      i = j
      continue
    }
    if ('+-*/%^'.includes(ch)) {
      // unary minus / plus
      const prev = tokens[tokens.length - 1]
      const isUnary = !prev || prev.type === 'op' || prev.type === 'lparen'
      if ((ch === '-' || ch === '+') && isUnary) {
        tokens.push({ type: 'num', value: 0 })
        tokens.push({ type: 'op', value: ch })
        i += 1
        continue
      }
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue }
    return null // unknown character — reject, never guess
  }
  return tokens
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 }
const RIGHT_ASSOC = new Set(['^'])

export function evaluateExpression(expression: string): number | null {
  const src = String(expression || '').trim()
  if (!src || src.length > 120) return null
  const tokens = tokenizeExpression(src)
  if (!tokens || tokens.length === 0) return null

  // Shunting-yard
  const output: Token[] = []
  const ops: Token[] = []
  for (const token of tokens) {
    if (token.type === 'num') { output.push(token); continue }
    if (token.type === 'op') {
      while (ops.length > 0) {
        const top = ops[ops.length - 1]
        if (top.type !== 'op') break
        const pTop = PRECEDENCE[top.value]
        const pCur = PRECEDENCE[token.value]
        if (pTop > pCur || (pTop === pCur && !RIGHT_ASSOC.has(token.value))) {
          output.push(ops.pop()!)
        } else break
      }
      ops.push(token)
      continue
    }
    if (token.type === 'lparen') { ops.push(token); continue }
    // rparen
    let found = false
    while (ops.length > 0) {
      const top = ops.pop()!
      if (top.type === 'lparen') { found = true; break }
      output.push(top)
    }
    if (!found) return null
  }
  while (ops.length > 0) {
    const top = ops.pop()!
    if (top.type === 'lparen') return null
    output.push(top)
  }

  // Evaluate RPN
  const stack: number[] = []
  for (const token of output) {
    if (token.type === 'num') { stack.push(token.value); continue }
    if (token.type !== 'op') return null
    const b = stack.pop()
    const a = stack.pop()
    if (a === undefined || b === undefined) return null
    let value: number
    switch (token.value) {
      case '+': value = a + b; break
      case '-': value = a - b; break
      case '*': value = a * b; break
      case '/': if (b === 0) return null; value = a / b; break
      case '%': if (b === 0) return null; value = a % b; break
      case '^': value = Math.pow(a, b); break
      default: return null
    }
    if (!Number.isFinite(value)) return null
    stack.push(value)
  }
  return stack.length === 1 ? stack[0] : null
}

// ============================================================
// Individual tools
// ============================================================

async function toolGetTime(args: Record<string, unknown>): Promise<ToolResult> {
  const timezone = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : 'UTC'
  try {
    const now = new Date()
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now)
    return { ok: true, tool: 'get_time', output: { timezone, iso: now.toISOString(), formatted } }
  } catch {
    return { ok: false, tool: 'get_time', error: `Unknown IANA timezone: ${timezone}`, httpStatus: 400 }
  }
}

async function toolCalculate(args: Record<string, unknown>): Promise<ToolResult> {
  const expression = typeof args.expression === 'string' ? args.expression : ''
  const value = evaluateExpression(expression)
  if (value === null) {
    return { ok: false, tool: 'calculate', error: 'Expression rejected. Use numbers, + - * / % ^ and parentheses only.', httpStatus: 400 }
  }
  return { ok: true, tool: 'calculate', output: { expression, value } }
}

async function toolSearchKnowledge(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return { ok: false, tool: 'search_knowledge', error: 'query is required', httpStatus: 400 }
  const limit = Math.max(1, Math.min(5, Math.floor(Number(args.limit) || 3)))
  const hits = await searchApprovedKnowledge(query, limit)
  return { ok: true, tool: 'search_knowledge', output: { query, results: hits, approvedOnly: true } }
}

type WebSearchResult = { title: string; url: string; snippet: string }

async function searchViaSearxng(baseUrl: string, query: string, limit: number): Promise<WebSearchResult[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
  const data: any = await res.json()
  const rows: any[] = Array.isArray(data?.results) ? data.results : []
  return rows.slice(0, limit).map((row) => ({
    title: String(row?.title || '').slice(0, 200),
    url: String(row?.url || '').slice(0, 500),
    snippet: String(row?.content || '').slice(0, 400),
  })).filter((row) => row.url)
}

async function searchViaBrave(apiKey: string, query: string, limit: number): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}&safesearch=moderate`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  })
  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`)
  const data: any = await res.json()
  const rows: any[] = Array.isArray(data?.web?.results) ? data.web.results : []
  return rows.slice(0, limit).map((row) => ({
    title: String(row?.title || '').slice(0, 200),
    url: String(row?.url || '').slice(0, 500),
    snippet: String(row?.description || '').slice(0, 400),
  })).filter((row) => row.url)
}

export function getSearchProvider(): 'searxng' | 'brave' | 'none' {
  if ((process.env.JARA_SEARCH_URL || '').trim()) return 'searxng'
  if ((process.env.JARA_BRAVE_API_KEY || '').trim()) return 'brave'
  return 'none'
}

async function toolWebSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, MAX_QUERY_LENGTH) : ''
  if (!query) return { ok: false, tool: 'web_search', error: 'query is required', httpStatus: 400 }
  const provider = getSearchProvider()
  if (provider === 'none') {
    return {
      ok: false,
      tool: 'web_search',
      error: 'Web search is not configured. Set JARA_SEARCH_URL (SearXNG) or JARA_BRAVE_API_KEY.',
      httpStatus: 503,
      unconfigured: true,
    }
  }
  const limit = Math.max(1, Math.min(MAX_RESULTS, Math.floor(Number(args.limit) || 5)))
  try {
    const results = provider === 'searxng'
      ? await searchViaSearxng(process.env.JARA_SEARCH_URL as string, query, limit)
      : await searchViaBrave(process.env.JARA_BRAVE_API_KEY as string, query, limit)
    return { ok: true, tool: 'web_search', output: { query, provider, results } }
  } catch (e: any) {
    return { ok: false, tool: 'web_search', error: `Search provider failed: ${e?.message || e}`, httpStatus: 502 }
  }
}

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
}

async function toolWeather(args: Record<string, unknown>): Promise<ToolResult> {
  const city = typeof args.city === 'string' ? args.city.trim().slice(0, 120) : ''
  if (!city) return { ok: false, tool: 'weather', error: 'city is required', httpStatus: 400 }
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!geoRes.ok) throw new Error(`geocoding HTTP ${geoRes.status}`)
    const geo: any = await geoRes.json()
    const place = Array.isArray(geo?.results) ? geo.results[0] : null
    if (!place) return { ok: false, tool: 'weather', error: `No location match for "${city}"`, httpStatus: 404 }

    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: '3',
      timezone: 'auto',
    })
    const fcRes = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!fcRes.ok) throw new Error(`forecast HTTP ${fcRes.status}`)
    const fc: any = await fcRes.json()
    const current = fc?.current || {}
    const daily = fc?.daily || {}
    return {
      ok: true,
      tool: 'weather',
      output: {
        location: { name: place.name, country: place.country, latitude: place.latitude, longitude: place.longitude },
        current: {
          temperatureC: current.temperature_2m,
          apparentTemperatureC: current.apparent_temperature,
          humidityPercent: current.relative_humidity_2m,
          windSpeedKmh: current.wind_speed_10m,
          condition: WMO_CODES[Number(current.weather_code)] || `code ${current.weather_code}`,
        },
        nextDays: Array.isArray(daily?.time)
          ? daily.time.map((date: string, i: number) => ({
              date,
              condition: WMO_CODES[Number(daily.weather_code?.[i])] || `code ${daily.weather_code?.[i]}`,
              maxC: daily.temperature_2m_max?.[i],
              minC: daily.temperature_2m_min?.[i],
              precipitationProbabilityPercent: daily.precipitation_probability_max?.[i],
            }))
          : [],
        source: 'open-meteo.com',
      },
    }
  } catch (e: any) {
    return { ok: false, tool: 'weather', error: `Weather lookup failed: ${e?.message || e}`, httpStatus: 502 }
  }
}

function memoryKeyFor(note: string): string {
  const slug = note.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'note'
  return `tool:${slug}`
}

async function toolRemember(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const note = typeof args.note === 'string' ? args.note.trim().slice(0, 1000) : ''
  if (!note) return { ok: false, tool: 'remember', error: 'note is required', httpStatus: 400 }
  const key = typeof args.key === 'string' && args.key.trim() ? `tool:${args.key.trim().slice(0, 48)}` : memoryKeyFor(note)
  try {
    const { db } = await import('@/lib/db')
    const row = await (db as any).jaraMemory.upsert({
      where: { userId_key: { userId: ctx.userId, key } },
      create: { userId: ctx.userId, key, value: note },
      update: { value: note },
    })
    return { ok: true, tool: 'remember', output: { key: row.key, stored: true } }
  } catch (e: any) {
    return { ok: false, tool: 'remember', error: `Memory store failed: ${e?.message || e}`, httpStatus: 500 }
  }
}

async function toolRecall(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  try {
    const { db } = await import('@/lib/db')
    const rows = await (db as any).jaraMemory.findMany({
      where: { userId: ctx.userId, key: { startsWith: 'tool:' } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    })
    const filtered = (rows || []).filter((row: any) => !query || String(row.value || '').toLowerCase().includes(query))
    return {
      ok: true,
      tool: 'recall_memory',
      output: { memories: filtered.slice(0, 10).map((row: any) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt })) },
    }
  } catch (e: any) {
    return { ok: false, tool: 'recall_memory', error: `Memory recall failed: ${e?.message || e}`, httpStatus: 500 }
  }
}

// ============================================================
// Registry
// ============================================================

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>

const REGISTRY: Record<string, { descriptor: Omit<ToolDescriptor, 'configured'>; run: ToolHandler; configured: () => boolean }> = {
  get_time: {
    descriptor: { name: 'get_time', description: 'Current date/time for an IANA timezone (default UTC).', inputSchema: { timezone: 'IANA timezone, e.g. Asia/Dhaka (optional)' }, egress: false, consequential: false },
    run: (args) => toolGetTime(args),
    configured: () => true,
  },
  calculate: {
    descriptor: { name: 'calculate', description: 'Evaluate a bounded arithmetic expression (+ - * / % ^, parentheses). No code execution.', inputSchema: { expression: 'e.g. (12*7)/5+2' }, egress: false, consequential: false },
    run: (args) => toolCalculate(args),
    configured: () => true,
  },
  search_knowledge: {
    descriptor: { name: 'search_knowledge', description: 'Search Super-Admin-approved Jara knowledge sources (BM25 lexical). Returns approved snippets only.', inputSchema: { query: 'search text', limit: '1-5 (optional)' }, egress: false, consequential: false },
    run: (args) => toolSearchKnowledge(args),
    configured: () => true,
  },
  web_search: {
    descriptor: { name: 'web_search', description: 'SearXNG/Brave search. Requires JARA_SEARCH_URL or JARA_BRAVE_API_KEY. Read-only public web results.', inputSchema: { query: 'search text', limit: '1-8 (optional)' }, egress: true, consequential: false },
    run: (args) => toolWebSearch(args),
    configured: () => getSearchProvider() !== 'none',
  },
  weather: {
    descriptor: { name: 'weather', description: 'Current weather and 3-day outlook via Open-Meteo (no API key required).', inputSchema: { city: 'city name, e.g. Dhaka' }, egress: true, consequential: false },
    run: (args) => toolWeather(args),
    configured: () => true,
  },
  remember: {
    descriptor: { name: 'remember', description: 'Store a short user-scoped memory note for Jara (JaraMemory). Reversible by the user.', inputSchema: { note: 'text to remember', key: 'short key (optional)' }, egress: false, consequential: false },
    run: (args, ctx) => toolRemember(args, ctx),
    configured: () => true,
  },
  recall_memory: {
    descriptor: { name: 'recall_memory', description: 'List the current user\'s stored memory notes (optionally substring-filtered).', inputSchema: { query: 'filter text (optional)' }, egress: false, consequential: false },
    run: (args, ctx) => toolRecall(args, ctx),
    configured: () => true,
  },
}

export function listTools(): ToolDescriptor[] {
  return Object.values(REGISTRY).map((entry) => ({ ...entry.descriptor, configured: entry.configured() }))
}

async function auditToolUse(ctx: ToolContext, name: string, argsSummary: string, ok: boolean): Promise<void> {
  try {
    const { writeJaraAudit } = await import('@/lib/jara-admin')
    await writeJaraAudit({
      action: 'tool_call',
      actorId: ctx.userId,
      actorRole: ctx.actorRole || null,
      detail: `Tool ${name} ${ok ? 'ran' : 'failed'}: ${argsSummary}`.slice(0, 500),
      authorizationResult: ok ? 'allowed' : 'error',
    })
  } catch (e: any) {
    // Audit must not break the tool path, but failures are visible in logs.
    console.warn(`[jara-tools] audit write failed for ${name}: ${e?.message || e}`)
  }
}

export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const toolName = String(name || '').trim()
  const entry = REGISTRY[toolName]
  if (!entry) {
    return { ok: false, tool: toolName || 'unknown', error: `Unknown tool. Available: ${Object.keys(REGISTRY).join(', ')}`, httpStatus: 404 }
  }
  if (!ctx?.userId) {
    return { ok: false, tool: toolName, error: 'Authenticated user context required', httpStatus: 401 }
  }
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>
  const argsSummary = JSON.stringify(args).slice(0, 300)
  const result = await entry.run(args, ctx)
  await auditToolUse(ctx, toolName, argsSummary, result.ok)
  return result
}
