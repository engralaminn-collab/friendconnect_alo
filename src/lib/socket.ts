"use client"

import { io, Socket } from "socket.io-client"

let socket: Socket | null = null

export function getSocket(token?: string): Socket {
  if (socket) return socket
  if (!token) throw new Error("token required to init socket")
  socket = io("/?XTransformPort=3003", {
    path: "/",
    transports: ["polling", "websocket"],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    upgrade: true,
  })
  return socket
}

export function getExistingSocket(): Socket | null {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}
