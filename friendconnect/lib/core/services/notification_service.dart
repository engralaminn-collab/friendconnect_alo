import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService();
});

class NotificationService {
  final FirebaseMessaging _fcm = FirebaseMessaging.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  Future<void> init() async {
    NotificationSettings settings = await _fcm.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      String? token = await _fcm.getToken();
      if (token != null && _auth.currentUser != null) {
        await _saveToken(token);
      }

      _fcm.onTokenRefresh.listen(_saveToken);
    }
  }

  Future<void> _saveToken(String token) async {
    final userId = _auth.currentUser?.uid;
    if (userId != null) {
      await _firestore.collection('users').doc(userId).update({
        'fcmToken': token,
      });
    }
  }
}
