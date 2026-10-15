'use client'

import { useEffect, useState, useCallback, createContext, useContext, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from '@/hooks/use-auth'

interface SocketCtx {
  socket: Socket | null
  isOnline: (userId: string) => boolean
  onlineUsers: string[]
}

const Ctx = createContext<SocketCtx>({ socket: null, isOnline: () => false, onlineUsers: [] })

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])

  useEffect(() => {
    // Check inside useEffect (React Rule of Hooks compliant)
    if (!user?.id) {
      if (socket) {
        socket.disconnect()
        setSocket(null)
      }
      return
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin
    const s = io(socketUrl, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
    })

    s.on('connect', () => {
      s.emit('auth', user.id)
    })

    s.on('onlineUsers', (users: string[]) => {
      setOnlineUsers(users)
    })

    setSocket(s)

    return () => {
      s.disconnect()
    }
  }, [user?.id])

  const isOnline = useCallback(
    (targetId: string) => onlineUsers.includes(targetId),
    [onlineUsers]
  )

  return (
    <Ctx.Provider value={{ socket, isOnline, onlineUsers }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSocket() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return { socket: null, isOnline: () => false, onlineUsers: [] }
  }
  return ctx
}
