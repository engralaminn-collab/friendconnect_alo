import { json } from '@/lib/serialize'

export async function GET() {
  return json({
    name: 'FriendConnect API',
    version: '1.0.0',
    docs: '/api/health',
  })
}
