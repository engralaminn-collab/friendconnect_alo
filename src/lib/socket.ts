"use client"

import { io, Socket } from "socket.io-client"

let socket: Socket | null = null

export function getSocket(token?: string): Socket {
  if (socket) return socket
  if (!token) throw new Error("token required to init socket")
  const socketUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  socket = io(socketUrl, {
    path: "/socket.io/",
    transports: ["polling", "websocket"],
    withCredentials: true,
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
