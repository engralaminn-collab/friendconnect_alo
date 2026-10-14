# FriendConnect Private

FriendConnect is a private place for an invited circle of old friends to reconnect. The web app is built with React, TypeScript, Vite, and Firebase; an Android/Flutter client lives in `friendconnect/`.

## Try it now

```bash
npm install
npm run dev
```

Open the local address Vite prints and choose **Explore the interactive preview**. The preview needs no account. It includes sample friends and conversations so you can try messaging, emoji, friend requests, calls, and media sharing. Preview changes are saved only in that browser; preview attachments are limited to 1 MB.

## What works

- Private, invite-only email/password sign-in and password reset
- Realtime one-to-one conversations and friend requests
- Text, emoji, reactions, read receipts, voice notes, images, videos, and documents
- One-to-one audio and video calls using browser WebRTC and Firestore signaling
- Contact search, profile editing, call history, and responsive mobile layout
- Matching Firestore/Storage rules for the web and Flutter clients

Real attachments are stored in Firebase Storage (50 MB maximum). Calls need microphone/camera permission and HTTPS (or localhost). The included public STUN servers are enough for many networks; for reliable calling behind restrictive NATs/firewalls, add a TURN relay as described below. Group chats are shown in the sample preview; live group creation and group calls are not implemented yet.

## Firebase setup

The web client uses the Firebase project configuration in `firebase-applet-config.json`. Enable:

1. Authentication → Email/Password
2. Cloud Firestore
3. Cloud Storage
4. Firebase Hosting, if you plan to deploy

New live accounts are not publicly registered. Create the Authentication account, then create a Firestore `users/{uid}` document with its UID as the document ID. Example:

```json
{
  "uid": "AUTH_USER_UID",
  "name": "Friend Name",
  "username": "friendname",
  "email": "friend@example.com",
  "role": "user",
  "isActive": true,
  "approved": true,
  "onlineStatus": false,
  "lastSeen": 0,
  "createdAt": 0,
  "profileVisibility": "private"
}
```

To set up the first administrator, create the account in Firebase Authentication and set `role` to `admin` on that user's document. Do not expose administrator credentials in the app.

The member directory is readable only by active, approved users in this invite-only circle. Keep the circle limited to people you trust, and avoid putting secrets in profile fields. Deploy the checked-in rules after reviewing them:

```bash
npm run build
npx firebase-tools deploy --only hosting,firestore,storage
```

`firebase.json` already configures the `dist` hosting directory and SPA rewrites. The corresponding rule files are `firestore.rules` and `storage.rules`.

## TURN relay for calls

Copy `.env.example` to `.env.local` and enter credentials from a TURN provider. Use comma-separated `turn:` / `turns:` URLs; Vite reads these when it builds the app. **`VITE_` values are bundled into public browser code, so never put a long-lived TURN secret here. Use short-lived provider credentials; a production deployment should mint them from a trusted backend.**

```dotenv
VITE_TURN_URLS="turn:relay.example.com:3478,turns:relay.example.com:5349"
VITE_TURN_USERNAME="your-username"
VITE_TURN_CREDENTIAL="your-secret"
```

The Flutter client's current Firebase-backed WebRTC settings are in `friendconnect/lib/config/webrtc_config.dart` and can be supplied with `--dart-define=TURN_URL=... --dart-define=TURN_USERNAME=... --dart-define=TURN_PASSWORD=...`. These build-time values are client-visible and must not contain long-lived credentials. The new parallel API has a server-side temporary TURN credential endpoint, but neither the web nor Flutter client is wired to it yet.

## Self-hosted migration status

A first-party Node/Express/Socket.IO/MySQL implementation and tests now live in `server/`. It is **not the active production app**: the existing web/Flutter clients still use Firebase; no Firebase data was exported/imported; no VPS, Caddy, PM2, MySQL, media storage, SMTP, ClamAV, or Coturn service was changed or verified. Do not remove Firebase or point production traffic at this code until the migration, restore, client, rollback, HTTPS, and cross-device checks are complete. See [`docs/self-hosted-migration-audit.md`](docs/self-hosted-migration-audit.md) and [`server/README.md`](server/README.md) for the detailed inventory, limits, and staged path.

## Important privacy note

FriendConnect uses Firebase Authentication, Firestore, and Storage for live accounts. **Messages and shared files are not end-to-end encrypted by this project**; Firebase project administrators can access stored data under the project's Firebase access controls. WebRTC calls use browser peer-to-peer encryption, but may use a configured TURN relay. Do not describe this as equivalent to WhatsApp's end-to-end encrypted messaging until end-to-end encryption is implemented and independently reviewed.

## Build and check

```bash
npm run lint
npm run build
```

The Flutter client is a separate source project in `friendconnect/`. See `friendconnect/README.md` for Android-specific setup.
