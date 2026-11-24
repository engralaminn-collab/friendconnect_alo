import { json } from '@/lib/serialize'
import { getRendererCapability, probeRendererHealth } from '@/lib/jara-renderer'

export async function GET() {
  const renderer = getRendererCapability()
  const health = await probeRendererHealth()
  return json({ renderer, health })
}
