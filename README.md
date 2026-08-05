# FriendConnect Private

FriendConnect Private is a friends-only chat app built with Vite, React, TypeScript, and Firebase.

This app is not a public social network. New users should be created or approved by the admin only.

## Local run

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build

```bash
npm run build
```

The production files are generated in `dist`.

## Firebase project

Project ID:

```text
friendconnect-2ca91
```

## Required Firebase services

Enable these in Firebase Console:

1. Authentication with Email/Password provider
2. Firestore Database
3. Storage
4. Hosting

## Firebase deployment configuration

`firebase.json` is configured for Firebase Hosting (including SPA rewrites), Firestore rules, Storage rules, and the notification Cloud Functions in `friendconnect/functions`. Before deploying, review the rules carefully and make sure an administrator account has been provisioned as described below.

## Deploy

```bash
npm install
npm run build
npx firebase-tools login
npx firebase-tools use friendconnect-2ca91
npx firebase-tools deploy --only hosting,firestore,storage,functions
```

## First admin setup

1. Firebase Console > Authentication > Users > Add user
2. Copy the user UID
3. Firestore > users > create document with that UID
4. Add this data:

```json
{
  "uid": "PASTE_UID_HERE",
  "name": "Admin",
  "username": "admin",
  "email": "admin@example.com",
  "role": "admin",
  "isActive": true,
  "approved": true,
  "onlineStatus": false,
  "lastSeen": 0,
  "createdAt": 0,
  "profileVisibility": "private"
}
```

## Private mode

- Public register route is blocked.
- Login page has no signup link.
- Inactive or unapproved users are blocked.
- Only authenticated users can access Firestore and Storage.

## Notes

This is currently a Firebase web app/PWA. For Android Play Store later, wrap the web app with Capacitor or create a native Android project using package name `com.friendconnect.app`.
