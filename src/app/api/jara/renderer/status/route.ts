import { json } from '@/lib/serialize'
import { getRendererCapability } from '@/lib/jara-renderer'

export async function GET() {
  return json({ renderer: getRendererCapability() })
}