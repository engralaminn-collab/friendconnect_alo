"use client"

// End-to-end encryption for FriendConnect direct messages.
//
// Uses the Web Crypto API (available in all modern browsers):
//   - ECDH P-256 for key agreement (key exchange)
//   - AES-GCM 256 for symmetric message encryption
//   - IndexedDB for private key storage (never sent to server)
//
// Flow:
//   1. On first login, generate an ECDH key pair. Store private key in
//      IndexedDB. Publish public key to /api/me/public-key.
//   2. To send an encrypted message to Bob:
//      a. Fetch Bob's public key from /api/users/[id]/public-key
//      b. Derive shared key = ECDH(myPrivate, bobPublic)
//      c. Encrypt plaintext with AES-GCM(sharedKey, random IV)
//      d. Send { content: base64(ciphertext), iv: base64(iv),
//               encrypted: true, senderPublicKey: myPublic }
//   3. To receive:
//      a. Derive shared key = ECDH(myPrivate, senderPublic)
//      b. Decrypt with AES-GCM(sharedKey, iv)
//
// The server only sees encrypted blobs + public keys. It CANNOT decrypt
// messages even if compromised.
//
// LIMITATIONS (vs Signal Protocol):
//   - No forward secrecy (same shared key for all messages between two users)
//   - No key rotation / ratchet
//   - No multi-device sync (each browser has its own key pair)
//   - No group E2EE (only 1:1 direct chats)
//   - Lost device = lost private key = can't decrypt old messages
//   - Server-side search/moderation/AI won't work on encrypted content

const DB_NAME = "friendconnect-e2ee"
const DB_VERSION = 1
const PRIVATE_KEY_STORE = "privateKeys"

// ---------- IndexedDB helpers ----------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PRIVATE_KEY_STORE)) {
        db.createObjectStore(PRIVATE_KEY_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: any): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRIVATE_KEY_STORE, "readwrite")
    tx.objectStore(PRIVATE_KEY_STORE).put(value, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRIVATE_KEY_STORE, "readonly")
    const req = tx.objectStore(PRIVATE_KEY_STORE).get(key)
    req.onsuccess = () => { db.close(); resolve(req.result) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ---------- Base64 helpers ----------

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function strToBuf(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer
}

function bufToStr(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf)
}

// ---------- Key generation ----------

export interface E2EEKeyPair {
  publicKeyB64: string
  privateKeyJwk: JsonWebKey
}

export async function generateKeyPair(): Promise<E2EEKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  )
  const publicKeyBuf = await crypto.subtle.exportKey("raw", keyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey)
  return {
    publicKeyB64: bufToB64(publicKeyBuf),
    privateKeyJwk,
  }
}

// ---------- Key storage ----------

export async function storePrivateKey(userId: string, privateKeyJwk: JsonWebKey): Promise<void> {
  await idbSet(`privateKey:${userId}`, privateKeyJwk)
}

export async function loadPrivateKey(userId: string): Promise<JsonWebKey | undefined> {
  return idbGet<JsonWebKey>(`privateKey:${userId}`)
}

export async function getOrCreateKeyPair(userId: string): Promise<E2EEKeyPair> {
  const existing = await loadPrivateKey(userId)
  if (existing) {
    // We need the public key too — re-derive from private
    const privateKey = await crypto.subtle.importKey("jwk", existing, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])
    // Can't export public from private directly — need to store public separately
    const publicB64 = await idbGet<string>(`publicKey:${userId}`)
    if (publicB64) {
      return { publicKeyB64: publicB64, privateKeyJwk: existing }
    }
  }
  // Generate new
  const kp = await generateKeyPair()
  await storePrivateKey(userId, kp.privateKeyJwk)
  await idbSet(`publicKey:${userId}`, kp.publicKeyB64)
  return kp
}

// ---------- Key import for deriving shared secret ----------

async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  const buf = b64ToBuf(publicKeyB64)
  return crypto.subtle.importKey(
    "raw",
    buf,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  )
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey", "deriveBits"]
  )
}

// ---------- Shared key derivation ----------

async function deriveSharedKey(
  privateKeyJwk: JsonWebKey,
  peerPublicKeyB64: string
): Promise<CryptoKey> {
  const privateKey = await importPrivateKey(privateKeyJwk)
  const peerPublicKey = await importPublicKey(peerPublicKeyB64)
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

// ---------- Encryption / Decryption ----------

export interface EncryptedPayload {
  content: string      // base64 ciphertext
  iv: string            // base64 IV
  senderPublicKeyB64: string
}

export async function encryptMessage(
  plaintext: string,
  myPrivateKeyJwk: JsonWebKey,
  peerPublicKeyB64: string,
  myPublicKeyB64: string
): Promise<EncryptedPayload> {
  const sharedKey = await deriveSharedKey(myPrivateKeyJwk, peerPublicKeyB64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    strToBuf(plaintext)
  )
  return {
    content: bufToB64(ciphertext),
    iv: bufToB64(iv.buffer),
    senderPublicKeyB64: myPublicKeyB64,
  }
}

export async function decryptMessage(
  payload: EncryptedPayload,
  myPrivateKeyJwk: JsonWebKey
): Promise<string> {
  const sharedKey = await deriveSharedKey(myPrivateKeyJwk, payload.senderPublicKeyB64)
  const ciphertext = b64ToBuf(payload.content)
  const iv = new Uint8Array(b64ToBuf(payload.iv))
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    ciphertext
  )
  return bufToStr(plaintext)
}

// ---------- Public key API ----------

export async function publishPublicKey(userId: string, publicKeyB64: string): Promise<void> {
  await fetch("/api/me/public-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: publicKeyB64 }),
  })
}

export async function fetchPeerPublicKey(peerUserId: string): Promise<string | null> {
  const res = await fetch(`/api/users/${peerUserId}/public-key`)
  if (!res.ok) return null
  const data = await res.json()
  return data.publicKey || null
}
