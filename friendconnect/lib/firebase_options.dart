import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    // These are placeholder values. The user must replace them with their 
    // actual google-services.json / GoogleService-Info.plist details
    // or run `flutterfire configure`.
    return const FirebaseOptions(
      apiKey: 'API_KEY',
      appId: 'APP_ID',
      messagingSenderId: 'SENDER_ID',
      projectId: 'friendconnect-2ca91',
    );
  }
}
