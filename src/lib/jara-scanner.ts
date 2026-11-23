export interface ScanResult {
  status: 'not_configured' | 'clean' | 'infected' | 'error'
  scanner?: string
  detail: string
}

export interface MalwareScanner {
  scan(buf: Buffer, name: string): Promise<ScanResult>
}

export class NoopMalwareScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> {
    const configured = process.env.JARA_MALWARE_SCAN
    if (configured === 'clamav') {
      // Integration point: exec clamdscan/clamd INSTREAM. Not wired in this environment.
      return { status: 'not_configured', scanner: 'clamav', detail: 'JARA_MALWARE_SCAN=clamav set but ClamAV runtime integration is not wired in this build. Treat as unscanned.' }
    }
    return { status: 'not_configured', detail: 'Malware scanning not configured. Configure scanner runtime before production use.' }
  }
}

export function getMalwareScanner(): MalwareScanner {
  return new NoopMalwareScanner()
}