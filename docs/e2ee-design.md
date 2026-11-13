# FriendConnect — End-to-End Encryption (E2EE)

## What E2EE means

With E2EE, only the communicating users can read messages. The server stores
and relays **encrypted blobs** — it cannot decrypt message content even if
compromised. This is different from transport encryption (TLS), which only
protects messages in transit.

## Implementation

### Crypto stack (all via Web Crypto API — no external crypto libraries)
- **Key agreement**: ECDH P-256 (elliptic curve Diffie-Hellman)
- **Symmetric encryption**: AES-GCM 256-bit
- **Key storage**: IndexedDB (private keys never leave the browser)
- **Public key exchange**: via REST API (`/api/users/[id]/public-key`)

### Key flow
1. On first login, the client generates an ECDH P-256 key pair
2. Private key stored in IndexedDB (never sent to server)
3. Public key published to `/api/me/public-key` (stored on User model)
4. To send an encrypted message to Bob:
   - Fetch Bob's public key
   - Derive shared key = ECDH(myPrivate, bobPublic)
   - Encrypt plaintext with AES-GCM(sharedKey, randomIV)
   - Send `{ content: ciphertext, iv, encrypted: true, senderPublicKey: myPublic }`
5. To receive:
   - Derive shared key = ECDH(myPrivate, senderPublic)
   - Decrypt with AES-GCM(sharedKey, iv)

### What the server sees
- Public keys (ECDH, can't derive private keys from them)
- Encrypted ciphertext (AES-GCM, can't decrypt without shared key)
- IV (initialization vector, not secret — just needs to be unique)
- Metadata: sender, recipient, timestamp, conversation ID

The server **cannot** derive the shared key because it doesn't have any
private key. ECDH requires one private + one public to derive the shared
secret.

## Files
- `src/lib/e2ee.ts` — crypto primitives (key gen, encrypt, decrypt, storage)
- `src/hooks/useE2EE.ts` — React hook for key management
- `src/app/api/me/public-key/route.ts` — publish/get current user's public key
- `src/app/api/users/[id]/public-key/route.ts` — get any user's public key
- `prisma/schema.prisma` — User.publicKey, Message.encrypted/iv/senderPublicKey

## Limitations (vs Signal Protocol)

This is simplified E2EE. A production-grade implementation (like Signal's)
would also include:

| Feature | This implementation | Signal Protocol |
|---|---|---|
| Key agreement | ECDH P-256 (static) | X3DH (ephemeral + signed pre-keys) |
| Forward secrecy | ❌ No | ✅ Double Ratchet |
| Key rotation | ❌ No | ✅ Per-message ratchet |
| Multi-device sync | ❌ Each browser is separate | ✅ Device-to-device sync |
| Group E2EE | ❌ Only 1:1 | ✅ Sender Keys |
| Key verification | ❌ No QR code safety numbers | ✅ Safety number verification |
| Recovery | ❌ Lost device = lost messages | ✅ Optional encrypted backup |

## Trade-offs

When E2EE is enabled for a conversation:
- ❌ Server-side message search won't work (content is encrypted)
- ❌ Server-side moderation/AI can't read encrypted messages
- ❌ Message history on a new device won't work (private key is browser-specific)
- ❌ If the user clears browser data, all E2EE messages are unreadable
- ✅ Server compromise doesn't expose message content
- ✅ Even with DB access, messages can't be decrypted

## How to upgrade to Signal-grade E2EE

To implement forward secrecy and key rotation:
1. Use `@aspect-build/protocol` or the `signal-protocol` npm package
2. Implement X3DH key agreement (needs signed pre-keys + one-time pre-keys)
3. Implement Double Ratchet (derive new key per message)
4. Add safety number verification (QR code comparison)
5. Add encrypted key backup for multi-device sync

This is a 2-4 week security engineering milestone.

## Security audit checklist

Before relying on this E2EE for sensitive communication:
- [ ] Have the crypto reviewed by a security engineer
- [ ] Add key verification (safety numbers)
- [ ] Implement forward secrecy (Double Ratchet)
- [ ] Add multi-device key sync
- [ ] Test malicious-server scenario (verify server can't decrypt)
- [ ] Test device-compromise scenario (verify past messages stay safe with FS)
- [ ] Add tamper detection (AES-GCM provides authentication, but verify)
