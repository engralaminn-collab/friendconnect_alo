import { getSessionUser, getCurrentSessionToken } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

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
  } catch (error) {
    return handleRouteError(error, '/api/auth/token')
  }
}
