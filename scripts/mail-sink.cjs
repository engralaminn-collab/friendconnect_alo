#!/usr/bin/env node
'use strict'
/**
 * Local SMTP sink for development. Accepts mail, writes .eml under logs/mail.
 * Not a production MTA.
 */
require('./load-env.cjs')
const { SMTPServer } = require('smtp-server')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.SMTP_PORT || 1025)
const dir = path.resolve(__dirname, '..', 'logs', 'mail')
fs.mkdirSync(dir, { recursive: true })

const server = new SMTPServer({
  disabledCommands: ['STARTTLS'],
  authOptional: true,
  hideSTARTTLS: true,
  onAuth(auth, _session, cb) {
    cb(null, { user: auth.username || 'dev' })
  },
  onData(stream, session, cb) {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => {
      const raw = Buffer.concat(chunks)
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.eml`
      fs.writeFileSync(path.join(dir, name), raw)
      const to = (session.envelope && session.envelope.rcptTo || []).map((a) => a.address).join(',')
      console.log(`[mail-sink] saved ${name} to=${to} bytes=${raw.length}`)
      cb()
    })
  },
})

server.on('error', (err) => console.error('[mail-sink]', err.message))
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mail-sink] SMTP ${PORT} → ${dir}`)
})
