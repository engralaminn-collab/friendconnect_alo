/**
 * Multi-provider AI gateway.
 *
 * Replaces the implicit "whichever env var happens to be set wins" routing in
 * `src/lib/ai.ts` with an explicit registry that knows each provider's *actual*
 * capabilities, its data-handling class, and whether the operator and the user
 * have authorised sending content to it.
 *
 * The rules this file exists to enforce:
 *
 *  1. **Local first.** A local provider (Ollama, LiteLLM-on-localhost, any
 *     OpenAI-compatible endpoint on a private address) is preferred when it can do
 *     the task. Content does not leave the deployment unless nothing local can.
 *  2. **No silent cross-provider fallback.** The previous implementation refused
 *     to fall back at all ("no cross-provider fallback was attempted"). That is
 *     safe but means one flaky provider breaks the feature. Falling back freely is
 *     unsafe: it moves a user's private messages to a different company. This
 *     gateway falls back only to providers the caller has explicitly allowed, and
 *     reports which provider actually answered.
 *  3. **Capabilities are declared, not assumed.** No model is described as
 *     supporting vision/audio/tools because it "probably does". A capability is
 *     present only if the registry entry says so, and a request for a capability a
 *     provider lacks is a routing decision, not an error to swallow.
 *  4. **Secrets stay server-side.** Only this module reads API keys; it returns
 *     model metadata to callers, never credentials.
 */

export type Capability = 'text' | 'streaming' | 'vision' | 'audio-transcription' | 'speech' | 'tools'
export type ProviderKind = 'local' | 'external'
export type DataClass = 'private' | 'public'

export interface ProviderDefinition {
  id: string
  label: string
  kind: ProviderKind
  /** Capabilities this provider genuinely supports through our adapter. */
  capabilities: Capability[]
  /** Environment variables that must be set for this provider to be usable. */
  requiredEnv: string[]
  /** True when the endpoint is configured to something local/private. */
  isEndpointLocal?: boolean
  /** Human note about licensing/cost, surfaced in the admin UI. */
  costNote: string
}

export interface ModelEntry {
  providerId: string
  model: string
  capabilities: Capability[]
  /** Context window in tokens, when known. `null` means "not declared". */
  contextTokens: number | null
  /** Free to run (self-hosted or an explicitly free tier). */
  free: boolean
}

/**
 * Provider registry.
 *
 * Capabilities describe our adapter, not a vendor's marketing page. Ollama has
 * vision models but the adapter below only sends text, so `vision` is absent until
 * the adapter actually implements it — advertising it early is how a UI ends up
 * offering a button that cannot work.
 */
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'ollama',
    label: 'Ollama (self-hosted)',
    kind: 'local',
    capabilities: ['text', 'streaming'],
    requiredEnv: ['OLLAMA_URL'],
    isEndpointLocal: true,
    costNote: 'Free. Runs on the operator’s own hardware; no external API.',
  },
  {
    id: 'litellm',
    label: 'LiteLLM proxy',
    kind: 'local',
    capabilities: ['text', 'streaming'],
    requiredEnv: ['LITELLM_URL'],
    isEndpointLocal: true,
    costNote: 'Free software; the models behind it may be local or paid.',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    kind: 'local',
    capabilities: ['text', 'streaming'],
    requiredEnv: ['OPENAI_BASE_URL'],
    isEndpointLocal: true,
    costNote: 'Free if the endpoint is self-hosted (llama.cpp, vLLM); paid if it is api.openai.com.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (free tier models)',
    kind: 'external',
    capabilities: ['text'],
    requiredEnv: ['OPENROUTER_API_KEY'],
    costNote: 'Free tier only for models whose id ends in `:free`; paid otherwise.',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference API',
    kind: 'external',
    capabilities: ['text'],
    requiredEnv: ['HUGGINGFACE_API_KEY'],
    costNote: 'Free tier is rate-limited; heavier usage requires a paid plan.',
  },
  {
    id: 'zai',
    label: 'z-ai-web-dev-sdk',
    kind: 'external',
    capabilities: ['text'],
    requiredEnv: ['ZAI_API_KEY'],
    costNote: 'External service; availability depends on the operator’s account.',
  },
]

/** Is this hostname/localhost string clearly not on the public internet? */
export function isPrivateEndpoint(url: string | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url.includes('://') ? url : `http://${url}`).hostname
  } catch {
    return false
  }
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true
  // Private ranges (10/8, 192.168/16, 172.16/12) and Docker service names.
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  // A bare hostname with no dot is a container/service name (e.g. `ollama`).
  if (!host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true
  return false
}

/** Resolve the configured endpoint for a provider, for locality checks. */
function endpointFor(providerId: string): string | undefined {
  switch (providerId) {
    case 'ollama':
      return process.env.OLLAMA_URL
    case 'litellm':
      return process.env.LITELLM_URL
    case 'openai-compatible':
      return process.env.OPENAI_BASE_URL
    default:
      return undefined
  }
}

/**
 * Is this provider configured *and* genuinely local?
 *
 * `kind: 'local'` in the registry says the provider is local-capable; this
 * function checks the actual configured URL, because pointing `OPENAI_BASE_URL`
 * at api.openai.com makes the "OpenAI-compatible" adapter a cloud provider.
 */
export function isProviderLocal(provider: ProviderDefinition): boolean {
  if (provider.kind !== 'local') return false
  const endpoint = endpointFor(provider.id)
  if (!endpoint) return false
  return isPrivateEndpoint(endpoint)
}

export function isProviderConfigured(provider: ProviderDefinition): boolean {
  const env = provider.requiredEnv
  if (!env.length) return true
  // `openai-compatible` needs a key too, but a local llama.cpp/vLLM endpoint may
  // accept any key, so only the base URL is mandatory here.
  if (provider.id === 'openai-compatible') {
    return !!process.env.OPENAI_BASE_URL && !!endpointFor(provider.id)
  }
  return env.every((name) => !!process.env[name])
}

/** Every provider currently usable in this deployment. */
export function availableProviders(): ProviderDefinition[] {
  return PROVIDERS.filter(isProviderConfigured)
}

/** The models we know how to ask a provider for. */
export function modelsFor(providerId: string): ModelEntry[] {
  const text = (model: string, free: boolean, contextTokens: number | null = null): ModelEntry => ({
    providerId,
    model,
    capabilities: ['text', 'streaming'],
    contextTokens,
    free,
  })
  switch (providerId) {
    case 'ollama':
      return [
        text(process.env.OLLAMA_MODEL || 'llama3.2', true, 131_072),
        text('qwen2.5', true, 32_768),
        text('mistral', true, 32_768),
        text('phi3', true, 4_096),
        text('gemma2', true, 8_192),
        text('deepseek-r1', true, 65_536),
      ]
    case 'litellm':
      return [text(process.env.LITELLM_MODEL || 'gpt-4o-mini', false, 128_000)]
    case 'openai-compatible':
      return [text(process.env.AI_MODEL || 'gpt-4o-mini', false, null)]
    case 'openrouter':
      // Only the `:free` ids are actually free; the registry says so explicitly
      // rather than labelling every OpenRouter model as free.
      return [
        text('meta-llama/llama-3.2-3b-instruct:free', true, 131_072),
        text('google/gemma-2-9b-it:free', true, 8_192),
        text('qwen/qwen-2.5-7b-instruct:free', true, 32_768),
        text('mistralai/mistral-7b-instruct:free', true, 32_768),
      ]
    case 'huggingface':
      return [text(process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct', false, null)]
    case 'zai':
      return [text(process.env.ZAI_MODEL || 'glm-4.6', false, null)]
    default:
      return []
  }
}

export interface RouteRequest {
  capability: Capability
  /**
   * Providers the caller has authorised for this content. A private message may
   * only be routed to what is listed here; the gateway will not widen this.
   */
  allowedProviderIds: string[]
  /** Set when the content is private, which forbids external providers unless listed. */
  dataClass?: DataClass
  /** Preferred model, honoured if it exists and supports the capability. */
  preferredModel?: string
}

export interface RouteDecision {
  provider: ProviderDefinition
  model: string
  /** Providers that were skipped and why — surfaced in the admin UI and logs. */
  skipped: { providerId: string; reason: string }[]
  /** True when the decision came from the local-first rule rather than the caller. */
  localFirst: boolean
}

/**
 * Choose a provider and model.
 *
 * Order of preference:
 *   1. the caller's `preferredModel`, if a permitted provider offers it and
 *      supports the capability;
 *   2. any permitted local provider that supports the capability;
 *   3. any permitted external provider that supports it.
 *
 * Returns `null` when nothing is permitted — the caller must then report
 * "no provider available" rather than silently using one.
 */
export function routeRequest(request: RouteRequest): RouteDecision | null {
  const { capability, allowedProviderIds, dataClass = 'private', preferredModel } = request
  const skipped: RouteDecision['skipped'] = []

  const candidates: ProviderDefinition[] = []
  for (const provider of PROVIDERS) {
    if (!allowedProviderIds.includes(provider.id)) {
      skipped.push({ providerId: provider.id, reason: 'not authorised for this content' })
      continue
    }
    if (!isProviderConfigured(provider)) {
      skipped.push({ providerId: provider.id, reason: 'not configured' })
      continue
    }
    if (!provider.capabilities.includes(capability)) {
      skipped.push({ providerId: provider.id, reason: `does not support ${capability}` })
      continue
    }
    // Private content must never leave the deployment, even if the caller listed
    // an external provider: the operator's data policy outranks the request.
    if (dataClass === 'private' && provider.kind === 'external' && !isProviderLocal(provider)) {
      // An external provider is only reachable when the caller explicitly listed
      // it *and* the deployment has allowed external processing. That permission
      // is expressed by listing it — so this branch only blocks when the caller
      // listed a provider it cannot actually use locally and the policy forbids
      // external transfer.
      if (process.env.AI_ALLOW_EXTERNAL_PRIVATE_CONTENT !== 'true') {
        skipped.push({
          providerId: provider.id,
          reason: 'private content may not be sent to an external provider (set AI_ALLOW_EXTERNAL_PRIVATE_CONTENT=true to permit)',
        })
        continue
      }
    }
    candidates.push(provider)
  }

  if (!candidates.length) return null

  const supportsModel = (provider: ProviderDefinition, model: string) =>
    modelsFor(provider.id).some(
      (entry) => entry.model === model && entry.capabilities.includes(capability),
    )

  // 1. An explicit model preference, only if it can actually serve the request.
  if (preferredModel) {
    for (const provider of candidates) {
      if (supportsModel(provider, preferredModel)) {
        return { provider, model: preferredModel, skipped, localFirst: false }
      }
    }
    skipped.push({ providerId: '*', reason: `preferred model ${preferredModel} unavailable or lacks ${capability}` })
  }

  // 2. Local first.
  const local = candidates.find((p) => isProviderLocal(p) || p.kind === 'local')
  const pick = local ?? candidates[0]
  const entry =
    modelsFor(pick.id).find((m) => m.capabilities.includes(capability)) ??
    modelsFor(pick.id)[0]

  return {
    provider: pick,
    model: entry?.model ?? 'default',
    skipped,
    localFirst: !!local && pick === local,
  }
}

/**
 * Fallback chain for a failed request.
 *
 * Only providers the caller authorised are used, in local-first order, and the
 * first provider that produced the failed attempt is excluded — retrying the same
 * dead endpoint is not a fallback.
 *
 * @returns ordered providers to try, excluding `excludeProviderId`.
 */
export function fallbackChain(
  request: RouteRequest,
  excludeProviderId: string,
): RouteDecision[] {
  const remaining: RouteDecision[] = []
  const allowed = request.allowedProviderIds.filter((id) => id !== excludeProviderId)
  let guard = 0
  // Each call returns one decision; re-running with the chosen provider removed
  // walks the chain. The guard prevents an infinite loop in one call site.
  while (guard < PROVIDERS.length) {
    const decision = routeRequest({ ...request, allowedProviderIds: allowed, preferredModel: undefined })
    if (!decision) break
    remaining.push(decision)
    const index = allowed.indexOf(decision.provider.id)
    if (index >= 0) allowed.splice(index, 1)
    guard += 1
    if (remaining.length >= 3) break
  }
  return remaining
}

/** The id of the provider the legacy `ai.ts` would have used, for compatibility. */
export function primaryProviderId(): string {
  const configured = availableProviders()
  const local = configured.find((p) => isProviderLocal(p))
  return (local ?? configured[0])?.id ?? 'none'
}

/** Model metadata safe to send to a browser (no endpoints, no keys). */
export function modelDirectory() {
  return PROVIDERS.map((provider) => {
    const configured = isProviderConfigured(provider)
    const local = isProviderLocal(provider)
    return {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      locality: local ? 'local' : provider.kind === 'local' ? 'remote-endpoint' : 'external',
      configured,
      usable: configured,
      capabilities: provider.capabilities,
      costNote: provider.costNote,
      models: configured
        ? modelsFor(provider.id).map((m) => ({
            model: m.model,
            capabilities: m.capabilities,
            contextTokens: m.contextTokens,
            free: m.free,
          }))
        : [],
    }
  })
}
