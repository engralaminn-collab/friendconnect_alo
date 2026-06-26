# FriendConnect

A private friend communication app built with Flutter and Firebase.

## Setup Instructions

1. Ensure you have the Flutter SDK installed on your machine.
2. Ensure you have the Firebase CLI installed and configured.
3. Replace the placeholder values in `lib/firebase_options.dart` with your actual Firebase project configuration, or simply run:
   ```bash
   flutterfire configure --project=friendconnect-2ca91
   ```
4. Place your `google-services.json` in the `android/app/` directory (you will need to generate the Android scaffolding first using `flutter create .` if not present, though this directory acts as your dart source code core).

## Build Instructions

To fetch dependencies:
```bash
flutter pub get
```

To run the application on an emulator or connected device:
```bash
flutter run
```

To build the release APK for Android:
```bash
flutter build apk --release
```

The output will be located at `build/app/outputs/flutter-apk/app-release.apk` which you can rename to `friendconnect.apk`.

## Features
- User Authentication (Login, Register)
- Real-time Firestore Database Integration
- Clean Architecture implementation
- Riverpod State Management
