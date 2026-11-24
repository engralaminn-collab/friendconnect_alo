import { randomUUID } from 'node:crypto'

export type SmsProviderName = 'httpsms' | 'telnyx' | 'twilio' | 'none'

export interface SmsCapability {
  provider: SmsProviderName
  outboundReady: boolean
  inboundReady: boolean
  missingEnv: string[]
  note: string
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone.trim())
}

export function normalizeSmsProvider(raw: unknown): SmsProviderName {
  const s = String(raw || 'none').trim().toLowerCase()
  if (s === 'httpsms' || s === 'telnyx' || s === 'twilio') return s
  return 'none'
}

export function getSmsCapability(config?: {
  enabled?: boolean
  provider?: string | null
  senderId?: string | null
  webhookSecret?: string | null
  inboundEnabled?: boolean
  outboundEnabled?: boolean
} | null): SmsCapability {
  const provider = normalizeSmsProvider(config?.provider)
  const missingEnv: string[] = []

  if (provider === 'httpsms') {
    const hasKey = Boolean(process.env.HTTPSMS_API_KEY)
    const hasWebhookSecret = Boolean(process.env.HTTPSMS_WEBHOOK_SECRET || config?.webhookSecret)
    if (!hasKey) missingEnv.push('HTTPSMS_API_KEY')
    if (!config?.senderId && !process.env.HTTPSMS_FROM_NUMBER) missingEnv.push('senderId (or HTTPSMS_FROM_NUMBER)')
    return {
      provider,
      outboundReady: Boolean(config?.enabled && config?.outboundEnabled && hasKey && (config?.senderId || process.env.HTTPSMS_FROM_NUMBER)),
      inboundReady: Boolean(config?.enabled && config?.inboundEnabled && hasWebhookSecret),
      missingEnv,
      note: 'httpSMS adapter (compatible with NdoleStudio/httpsms & self-hosted sms.domovina.ai gateways).',
    }
  }

  if (provider === 'telnyx') {
    const hasKey = Boolean(process.env.TELNYX_API_KEY)
    const hasPub = Boolean(process.env.TELNYX_PUBLIC_KEY || config?.webhookSecret)
    if (!hasKey) missingEnv.push('TELNYX_API_KEY')
    if (!config?.senderId && !process.env.TELNYX_FROM_NUMBER) missingEnv.push('senderId (or TELNYX_FROM_NUMBER)')
    return {
      provider,
      outboundReady: Boolean(config?.enabled && config?.outboundEnabled && hasKey && (config?.senderId || process.env.TELNYX_FROM_NUMBER)),
      inboundReady: Boolean(config?.enabled && config?.inboundEnabled && hasPub),
      missingEnv,
      note: 'Telnyx Messaging v2 adapter with Ed25519 webhook verification.',
    }
  }

  if (provider === 'twilio') {
    const hasSid = Boolean(process.env.TWILIO_ACCOUNT_SID)
    const hasToken = Boolean(process.env.TWILIO_AUTH_TOKEN || config?.webhookSecret)
    const hasWebhookUrl = Boolean(process.env.JARA_SMS_PUBLIC_WEBHOOK_URL)
    if (!hasSid) missingEnv.push('TWILIO_ACCOUNT_SID')
    if (!hasToken) missingEnv.push('TWILIO_AUTH_TOKEN')
    if (!config?.senderId && !process.env.TWILIO_FROM_NUMBER) missingEnv.push('senderId (or TWILIO_FROM_NUMBER)')
    return {
      provider,
      outboundReady: Boolean(config?.enabled && config?.outboundEnabled && hasSid && hasToken && (config?.senderId || process.env.TWILIO_FROM_NUMBER)),
      inboundReady: Boolean(config?.enabled && config?.inboundEnabled && Boolean(config?.webhookSecret) && hasWebhookUrl),
      missingEnv,
      note: 'Twilio REST API v2010-04-01 adapter with X-Twilio-Signature HMAC-SHA1 verification.',
    }
  }

  return {
    provider: 'none',
    outboundReady: false,
    inboundReady: false,
    missingEnv: ['provider (httpsms | telnyx | twilio)'],
    note: 'SMS gateway is not configured. Choose a provider (httpSMS, Telnyx, or Twilio) and set credentials.',
  }
}

export interface SendSmsResult {
  ok: boolean
  provider: SmsProviderName
  providerMessageId: string | null
  status: 'sent' | 'failed'
  error?: string
  httpStatus?: number
}

export async function sendSmsViaProvider(input: {
  provider: SmsProviderName
  from: string
  to: string
  body: string
  webhookSecret?: string | null
}): Promise<SendSmsResult> {
  const { provider, from, to, body } = input
  const timeoutMs = 15_000

  if (provider === 'httpsms') {
    const apiKey = process.env.HTTPSMS_API_KEY || ''
    const baseUrl = (process.env.HTTPSMS_API_URL || 'https://api.httpsms.com').replace(/\/+$/, '')
    if (!apiKey) return { ok: false, provider, providerMessageId: null, status: 'failed', error: 'HTTPSMS_API_KEY not configured', httpStatus: 503 }
    const requestId = randomUUID()
    const res = await fetch(`${baseUrl}/v1/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ from, to, content: body, request_id: requestId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, provider, providerMessageId: null, status: 'failed', error: data?.message || `httpSMS HTTP ${res.status}`, httpStatus: 502 }
    }
    return {
      ok: true,
      provider,
      providerMessageId: data?.data?.id || data?.id || requestId,
      status: 'sent',
    }
  }

  if (provider === 'telnyx') {
    const apiKey = process.env.TELNYX_API_KEY || ''
    if (!apiKey) return { ok: false, provider, providerMessageId: null, status: 'failed', error: 'TELNYX_API_KEY not configured', httpStatus: 503 }
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, text: body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || `Telnyx HTTP ${res.status}`
      return { ok: false, provider, providerMessageId: null, status: 'failed', error: errMsg, httpStatus: 502 }
    }
    return {
      ok: true,
      provider,
      providerMessageId: data?.data?.id || null,
      status: 'sent',
    }
  }

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
    const authToken = process.env.TWILIO_AUTH_TOKEN || input.webhookSecret || ''
    if (!accountSid || !authToken) {
      return { ok: false, provider, providerMessageId: null, status: 'failed', error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured', httpStatus: 503 }
    }
    const auth = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64')
    const params = new URLSearchParams({ From: from, To: to, Body: body })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, provider, providerMessageId: null, status: 'failed', error: data?.message || `Twilio HTTP ${res.status}`, httpStatus: 502 }
    }
    return {
      ok: true,
      provider,
      providerMessageId: data?.sid || null,
      status: 'sent',
    }
  }

  return { ok: false, provider, providerMessageId: null, status: 'failed', error: 'No SMS provider configured', httpStatus: 503 }
}
