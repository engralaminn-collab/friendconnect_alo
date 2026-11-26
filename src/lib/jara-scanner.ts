import net from 'node:net'

export interface ScanResult {
  status: 'not_configured' | 'clean' | 'infected' | 'error'
  scanner?: string
  detail: string
}

export interface MalwareScanner {
  scan(buf: Buffer, name: string): Promise<ScanResult>
}

function scanViaClamd(buf: Buffer, target: { path: string } | { host: string; port: number }): Promise<ScanResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection(target as any)
    const chunks: Buffer[] = []
  const push = (data: Buffer | string) => chunks.push(typeof data === 'string' ? Buffer.from(data) : data)
    let settled = false
    const finish = (res: ScanResult) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch {}
      resolve(res)
    }

    socket.setTimeout(10_000, () => {
      finish({ status: 'error', scanner: 'clamav', detail: 'ClamAV daemon scan timed out' })
    })
    socket.on('error', (err) => {
      finish({ status: 'error', scanner: 'clamav', detail: `ClamAV daemon connection failed: ${err.message}` })
    })
    socket.on('data', push)
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()
      if (reply.endsWith('OK')) {
        finish({ status: 'clean', scanner: 'clamav', detail: 'ClamAV INSTREAM clean' })
      } else if (reply.includes('FOUND')) {
        finish({ status: 'infected', scanner: 'clamav', detail: reply })
      } else {
        finish({ status: 'error', scanner: 'clamav', detail: `Unexpected clamd response: ${reply || 'empty'}` })
      }
    })

    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      const chunkSize = 64 * 1024
      for (let offset = 0; offset < buf.length; offset += chunkSize) {
        const slice = buf.subarray(offset, offset + chunkSize)
        const lenBuf = Buffer.allocUnsafe(4)
        lenBuf.writeUInt32BE(slice.length, 0)
        socket.write(lenBuf)
        socket.write(slice)
      }
      const zero = Buffer.alloc(4, 0)
      socket.end(zero)
    })
  })
}

export class ClamdMalwareScanner implements MalwareScanner {
  async scan(buf: Buffer, _name: string): Promise<ScanResult> {
    const mode = process.env.JARA_MALWARE_SCAN
    const socketPath = (process.env.CLAMD_SOCKET || '').trim()
    const host = (process.env.CLAMD_HOST || '').trim()
    const port = Number(process.env.CLAMD_PORT || 3310)

    if (mode !== 'clamav' && !socketPath && !host) {
      return {
        status: 'not_configured',
        detail: 'Malware scanning not configured. Set JARA_MALWARE_SCAN=clamav with CLAMD_HOST/CLAMD_SOCKET.',
      }
    }

    if (!socketPath && !host) {
      return {
        status: 'not_configured',
        scanner: 'clamav',
        detail: 'JARA_MALWARE_SCAN=clamav set but neither CLAMD_HOST nor CLAMD_SOCKET is configured.',
      }
    }

    return scanViaClamd(buf, socketPath ? { path: socketPath } : { host, port })
  }
}

export function getMalwareScanner(): MalwareScanner {
  return new ClamdMalwareScanner()
}
