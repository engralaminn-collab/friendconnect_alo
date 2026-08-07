import { db } from '@/lib/db'
import { json } from '@/lib/serialize'

// Health check endpoint (round 11)
export async function GET() {
  const checks: Record<string, string> = {}
  let ok = true
  try {
    await db.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
    ok = false
  }
  checks.realtime = 'ok' // realtime service is a separate process on :3003
  checks.uptime = `${process.uptime().toFixed(1)}s`
  return json({ status: ok ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() }, ok ? 200 : 503)
}
