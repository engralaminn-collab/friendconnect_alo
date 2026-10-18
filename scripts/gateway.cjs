#!/usr/bin/env node
'use strict'
/**
 * Same-origin gateway: :3000 → Next (:3001) and Socket.IO (:3003)
 * Optional HTTPS on HTTPS_PORT when TLS_CERT + TLS_KEY are set.
 */
const fs = require('fs')
const http = require('http')
const https = require('https')
const net = require('net')
require('./load-env.cjs')

const LISTEN = Number(process.env.PORT || 3000)
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT || 3001)
const SOCKET_PORT = Number(process.env.SOCKET_PORT || 3003)

function isSocket(url) {
  return (url || '').startsWith('/socket.io')
}

function proxyHttp(req, res, port) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` }
  const p = http.request(
    { hostname: '127.0.0.1', port, path: req.url, method: req.method, headers },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers)
      pr.pipe(res)
    }
  )
  p.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('Bad gateway: ' + err.message)
  })
  req.pipe(p)
}

function proxyUpgrade(req, socket, head, port) {
  const ws = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue
      lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    }
    ws.write(lines.join('\r\n') + '\r\n\r\n')
    if (head && head.length) ws.write(head)
    ws.pipe(socket)
    socket.pipe(ws)
  })
  ws.on('error', () => socket.destroy())
  socket.on('error', () => ws.destroy())
}

function attach(server) {
  server.on('upgrade', (req, socket, head) => {
    proxyUpgrade(req, socket, head, isSocket(req.url) ? SOCKET_PORT : NEXT_PORT)
  })
}

const server = http.createServer((req, res) => {
  proxyHttp(req, res, isSocket(req.url) ? SOCKET_PORT : NEXT_PORT)
})
attach(server)
server.listen(LISTEN, '0.0.0.0', () => {
  console.log(`Gateway :${LISTEN} → next:${NEXT_PORT} socket:${SOCKET_PORT}`)
})

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 0)
const TLS_CERT = process.env.TLS_CERT
const TLS_KEY = process.env.TLS_KEY
if (HTTPS_PORT && TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
  const tlsServer = https.createServer(
    { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
    (req, res) => proxyHttp(req, res, isSocket(req.url) ? SOCKET_PORT : NEXT_PORT)
  )
  attach(tlsServer)
  tlsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Gateway TLS :${HTTPS_PORT} (self-signed/local)`)
  })
}
