/**
 * Jara AI input guardrails.
 *
 * Inspired by the guardrail support in BerriAI/LiteLLM ("guardrails" for the
 * LLM proxy) — applied here at the Jara gateway boundary so that obvious
 * credentials and other secrets never leave the process toward an external
 * model provider.
 *
 * Design rules:
 *   - Dependency-free and deterministic. No network, no model call.
 *   - Secret-shaped findings BLOCK the request before any provider is called.
 *   - Prompt-injection phrasing is REPORTED but does not block on its own:
 *     users legitimately quote such phrases, and Jara's system prompt already
 *     treats in-context text as untrusted (see jara-prompt.ts).
 *   - Set JARA_AI_GUARDRAILS=off to disable entirely (not recommended).
 */

export type GuardrailFindingKind =
  | 'private_key_block'
  | 'aws_access_key'
  | 'openai_style_key'
  | 'anthropic_key'
  | 'github_token'
  | 'slack_token'
  | 'twilio_auth_token'
  | 'password_literal'
  | 'prompt_injection_override'

export interface GuardrailFinding {
  kind: GuardrailFindingKind
  /** True when this finding blocks the request from reaching a provider. */
  blocking: boolean
  detail: string
}

export interface GuardrailResult {
  allowed: boolean
  findings: GuardrailFinding[]
}

const SECRET_PATTERNS: Array<{ kind: GuardrailFindingKind; re: RegExp; detail: string }> = [
  { kind: 'private_key_block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/, detail: 'PEM private key material' },
  { kind: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, detail: 'AWS-style access key id' },
  { kind: 'openai_style_key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/, detail: 'OpenAI-style secret key' },
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/, detail: 'Anthropic-style secret key' },
  { kind: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, detail: 'GitHub-style personal access token' },
  { kind: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, detail: 'Slack-style token' },
  { kind: 'twilio_auth_token', re: /\bSK[0-9a-fA-F]{32}\b/, detail: 'Twilio-style API key/secret' },
  { kind: 'password_literal', re: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{6,}/i, detail: 'inline password assignment' },
]

const INJECTION_PATTERN = /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules|messages)\b/i

export function guardrailsEnabled(): boolean {
  return (process.env.JARA_AI_GUARDRAILS || 'on').trim().toLowerCase() !== 'off'
}

export function inspectAIInput(text: string): GuardrailResult {
  const findings: GuardrailFinding[] = []
  const input = String(text || '')
  if (!input) return { allowed: true, findings }

  for (const { kind, re, detail } of SECRET_PATTERNS) {
    if (re.test(input)) findings.push({ kind, blocking: true, detail })
  }
  if (INJECTION_PATTERN.test(input)) {
    findings.push({
      kind: 'prompt_injection_override',
      blocking: false,
      detail: 'instruction-override phrasing detected (reported, not blocked)',
    })
  }
  return { allowed: !findings.some((f) => f.blocking), findings }
}
