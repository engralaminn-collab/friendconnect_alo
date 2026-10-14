# FriendConnect Android client

This Flutter source tree is the Android companion to the React/Firebase web app at the repository root. It uses the same Firebase Authentication, Firestore collections, Storage paths, and security rules.

## Setup

1. Install Flutter and configure the Firebase project with FlutterFire (`flutterfire configure --project=friendconnect-2ca91`).
2. Put the Android Firebase configuration in the generated Android app scaffold when preparing a device build.
3. Enable Email/Password Authentication, Firestore, and Storage in Firebase Console.
4. Provision each account from the admin/Firebase Console; public registration is disabled for this private circle.

Fetch dependencies and run:

```bash
flutter pub get
flutter run
```

## Calls

WebRTC uses public STUN servers by default. Networks with strict NAT/firewall rules may need a TURN relay. Supply relay settings at build time:

```bash
flutter run \
  --dart-define=TURN_URL=turn:relay.example.com:3478 \
  --dart-define=TURN_USERNAME=your-username \
  --dart-define=TURN_PASSWORD=your-secret
```

The shared Firestore/Storage rule files are copied here as `firestore.rules` and `storage.rules`. Keep them in sync with the repository root when changing the data model.
