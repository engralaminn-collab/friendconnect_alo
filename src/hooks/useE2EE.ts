"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  generateKeyPair, loadPrivateKey, storePrivateKey,
  encryptMessage, decryptMessage, publishPublicKey, fetchPeerPublicKey,
  type E2EEKeyPair, type EncryptedPayload,
} from "@/lib/e2ee"

// Hook: manages the current user's E2EE key pair and provides
// encrypt/decrypt functions for a specific peer.
export function useE2EE(userId: string | null) {
  const [keyPair, setKeyPair] = useState<E2EEKeyPair | null>(null)
  const [ready, setReady] = useState(false)
  const peerKeyCache = useRef<Map<string, string>>(new Map())

  // Generate or load key pair on mount
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function init() {
      try {
        // Check if IndexedDB is available (not in SSR)
        if (typeof window === "undefined" || !("indexedDB" in window)) return

        // Try to load existing private key
        const existingPriv = await loadPrivateKey(userId)
        let kp: E2EEKeyPair

        if (existingPriv) {
          // We have a private key — need to get the public key from the server
          const res = await fetch("/api/me/public-key")
          const data = await res.json()
          if (data.publicKey) {
            kp = { publicKeyB64: data.publicKey, privateKeyJwk: existingPriv }
          } else {
            // No public key on server — generate new pair
            kp = await generateKeyPair()
            await storePrivateKey(userId, kp.privateKeyJwk)
            await publishPublicKey(userId, kp.publicKeyB64)
          }
        } else {
          // No private key — generate new pair
          kp = await generateKeyPair()
          await storePrivateKey(userId, kp.privateKeyJwk)
          await publishPublicKey(userId, kp.publicKeyB64)
        }

        if (!cancelled) {
          setKeyPair(kp)
          setReady(true)
        }
      } catch (e) {
        console.error("[E2EE] init failed", e)
      }
    }
    init()
    return () => { cancelled = true }
  }, [userId])

  // Encrypt a message for a specific peer
  const encrypt = useCallback(async (
    plaintext: string,
    peerUserId: string
  ): Promise<EncryptedPayload | null> => {
    if (!keyPair) return null
    try {
      // Fetch peer's public key (with cache)
      let peerKey: string | undefined = peerKeyCache.current.get(peerUserId)
      if (!peerKey) {
        const fetched = await fetchPeerPublicKey(peerUserId)
        peerKey = fetched || undefined
        if (!peerKey) {
          throw new Error("Peer has not published a public key — they need to log in with E2EE enabled first")
        }
        peerKeyCache.current.set(peerUserId, peerKey)
      }
      return await encryptMessage(plaintext, keyPair.privateKeyJwk, peerKey!, keyPair.publicKeyB64)
    } catch (e: any) {
      console.error("[E2EE] encrypt failed", e)
      throw e
    }
  }, [keyPair])

  // Decrypt a received message
  const decrypt = useCallback(async (
    payload: EncryptedPayload
  ): Promise<string | null> => {
    if (!keyPair) return null
    try {
      return await decryptMessage(payload, keyPair.privateKeyJwk)
    } catch (e) {
      console.error("[E2EE] decrypt failed", e)
      return null
    }
  }, [keyPair])

  // Check if a peer has E2EE enabled (has published a public key)
  const peerHasE2EE = useCallback(async (peerUserId: string): Promise<boolean> => {
    if (peerKeyCache.current.has(peerUserId)) return true
    const key = await fetchPeerPublicKey(peerUserId)
    if (key) {
      peerKeyCache.current.set(peerUserId, key)
      return true
    }
    return false
  }, [])

  return { keyPair, ready, encrypt, decrypt, peerHasE2EE }
}
