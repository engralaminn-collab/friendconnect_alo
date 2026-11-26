import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { getRendererCapability, probeRendererHealth, submitAvatarRenderJob, getAvatarRenderJobStatus } from '../../src/lib/jara-renderer'
import { getVoiceCapability, transcribeAudioServer, synthesizeSpeechServer } from '../../src/lib/jara-voice'
import { getMalwareScanner } from '../../src/lib/jara-scanner'

test('renderer capability is honest in default env', () => {
  const cap = getRendererCapability()
  assert.equal(cap.realVideoTrack, false)
  assert.equal(cap.audioDrivenLipSync, false)
  assert.equal(cap.mode, 'browser_fallback')
})

test('voice capability is honest in default env', () => {
  const cap = getVoiceCapability()
  assert.equal(cap.mode, 'browser_fallback')
  assert.equal(cap.stt.configured, false)
  assert.equal(cap.tts.configured, false)
  assert.equal(cap.realtime.streamingAsr, false)
})

test('malware scanner reports not_configured by default', async () => {
  const scanner = getMalwareScanner()
  const res = await scanner.scan(Buffer.from('test'), 'test.txt')
  assert.equal(res.status, 'not_configured')
})

test('server ASR & TTS fail closed when unconfigured and work against compatible endpoints', async (t) => {
  const unconfiguredAsr = await transcribeAudioServer(Buffer.from('RIFF....'), 'a.wav', 'audio/wav', 'bn')
  assert.equal(unconfiguredAsr.ok, false)
  assert.equal(unconfiguredAsr.httpStatus, 503)

  const unconfiguredTts = await synthesizeSpeechServer('Hello Jara', { language: 'en' })
  assert.equal(unconfiguredTts.ok, false)
  assert.equal(unconfiguredTts.httpStatus, 503)

  const mockVoiceServer = http.createServer((req, res) => {
    if (req.url === '/v1/audio/transcriptions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ text: 'হ্যালো জারা কেমন আছো' }))
      return
    }
    if (req.url === '/v1/audio/speech' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(Buffer.from('ID3-mock-mp3-payload'))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => mockVoiceServer.listen(0, '127.0.0.1', () => resolve()))
  const addr = mockVoiceServer.address() as net.AddressInfo
  const baseUrl = `http://127.0.0.1:${addr.port}`

  const prevAsr = process.env.JARA_ASR_URL
  const prevTts = process.env.JARA_TTS_URL
  process.env.JARA_ASR_URL = baseUrl
  process.env.JARA_TTS_URL = baseUrl
  t.after(() => {
    if (prevAsr === undefined) delete process.env.JARA_ASR_URL
    else process.env.JARA_ASR_URL = prevAsr
    if (prevTts === undefined) delete process.env.JARA_TTS_URL
    else process.env.JARA_TTS_URL = prevTts
    mockVoiceServer.close()
  })

  const cap = getVoiceCapability()
  assert.equal(cap.mode, 'server_asr_tts')
  assert.equal(cap.stt.configured, true)
  assert.equal(cap.tts.configured, true)

  const asr = await transcribeAudioServer(Buffer.from('RIFF0000'), 'bn.wav', 'audio/wav', 'bn')
  assert.equal(asr.ok, true)
  assert.equal(asr.text, 'হ্যালো জারা কেমন আছো')

  const tts = await synthesizeSpeechServer('আমি ভালো আছি', { language: 'bn' })
  assert.equal(tts.ok, true)
  assert.equal(tts.mimeType, 'audio/mpeg')
  assert.equal(Buffer.from(tts.audioBase64!, 'base64').toString('utf8'), 'ID3-mock-mp3-payload')
})

test('GPU avatar renderer adapter fails closed unconfigured and dispatches jobs to GPU worker', async (t) => {
  const unconfigured = await submitAvatarRenderJob({ title: 'Demo', script: 'Hi' })
  assert.equal(unconfigured.ok, false)
  assert.equal(unconfigured.httpStatus, 503)

  const worker = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.url === '/v1/render' && req.method === 'POST') {
      res.writeHead(202, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobId: 'job-991', status: 'queued' }))
      return
    }
    if (req.url === '/v1/render/job-991' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'completed', outputs: { videoUrl: 'https://cdn.example/out.mp4' } }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', () => resolve()))
  const addr = worker.address() as net.AddressInfo
  const prevGpu = process.env.JARA_GPU_WORKER_URL
  process.env.JARA_GPU_WORKER_URL = `http://127.0.0.1:${addr.port}`
  t.after(() => {
    if (prevGpu === undefined) delete process.env.JARA_GPU_WORKER_URL
    else process.env.JARA_GPU_WORKER_URL = prevGpu
    worker.close()
  })

  const cap = getRendererCapability()
  assert.equal(cap.mode, 'gpu_worker')
  assert.equal(cap.audioDrivenLipSync, true)

  const health = await probeRendererHealth()
  assert.equal(health.reachable, true)

  const job = await submitAvatarRenderJob({ title: 'Townhall', script: 'Welcome' })
  assert.equal(job.ok, true)
  assert.equal(job.jobId, 'job-991')

  const status = await getAvatarRenderJobStatus('job-991')
  assert.equal(status.ok, true)
  assert.equal(status.status, 'completed')
})

test('ClamAV INSTREAM scanner distinguishes clean and infected payloads over TCP', async (t) => {
  const clamd = net.createServer((socket) => {
    const buf: Buffer[] = []
    const push = (d: Buffer | string) => buf.push(typeof d === 'string' ? Buffer.from(d) : d)
    socket.on('data', push)
    socket.on('end', () => {
      const joined = Buffer.concat(buf).toString('utf8')
      socket.end(joined.includes('EICAR-TEST-VIRUS') ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0')
    })
  })
  await new Promise<void>((resolve) => clamd.listen(0, '127.0.0.1', () => resolve()))
  const addr = clamd.address() as net.AddressInfo

  const prevMode = process.env.JARA_MALWARE_SCAN
  const prevHost = process.env.CLAMD_HOST
  const prevPort = process.env.CLAMD_PORT
  process.env.JARA_MALWARE_SCAN = 'clamav'
  process.env.CLAMD_HOST = '127.0.0.1'
  process.env.CLAMD_PORT = String(addr.port)
  t.after(() => {
    if (prevMode === undefined) delete process.env.JARA_MALWARE_SCAN
    else process.env.JARA_MALWARE_SCAN = prevMode
    if (prevHost === undefined) delete process.env.CLAMD_HOST
    else process.env.CLAMD_HOST = prevHost
    if (prevPort === undefined) delete process.env.CLAMD_PORT
    else process.env.CLAMD_PORT = prevPort
    clamd.close()
  })

  const scanner = getMalwareScanner()
  const clean = await scanner.scan(Buffer.from('normal photo bytes'), 'photo.jpg')
  assert.equal(clean.status, 'clean')

  const infected = await scanner.scan(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-TEST-VIRUS!$H+H*'), 'bad.bin')
  assert.equal(infected.status, 'infected')
})
