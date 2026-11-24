import { getSessionUser, getCurrentSessionToken } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'

export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const token = await getCurrentSessionToken()
    if (!token) return errorJson('No active session', 401)
    return new Response(JSON.stringify({ token }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
      },
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
