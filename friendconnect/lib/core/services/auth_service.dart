import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/user_model.dart';

final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(FirebaseAuth.instance, FirebaseFirestore.instance);
});

final authStateProvider = StreamProvider<User?>((ref) {
  return ref.watch(authServiceProvider).authStateChanges;
});

class AuthService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  AuthService(this._auth, this._firestore);

  Stream<User?> get authStateChanges => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  Future<UserModel?> login(String email, String password) async {
    try {
      UserCredential result = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      
      if (result.user != null) {
        final userRef = _firestore.collection('users').doc(result.user!.uid);
        final userDoc = await userRef.get().catchError((_) {
          return userRef.get(const GetOptions(source: Source.cache));
        });
        if (userDoc.exists) {
          final profile = UserModel.fromMap(userDoc.data() as Map<String, dynamic>, userDoc.id);
          if (!profile.isActive || !profile.approved) {
            await _auth.signOut();
            throw Exception('This account is not active or approved yet. Please contact your admin.');
          }
          await userRef.update({
            'onlineStatus': true,
            'lastSeen': DateTime.now().millisecondsSinceEpoch,
          }).catchError((_) {});
          return profile;
        }
      }
      await _auth.signOut();
      throw Exception('This account has not been added to the private circle yet. Please contact your admin.');
    } catch (e) {
      rethrow;
    }
  }

  Future<void> logout() async {
    if (currentUser != null) {
      await _firestore.collection('users').doc(currentUser!.uid).update({
        'onlineStatus': false,
        'lastSeen': DateTime.now().millisecondsSinceEpoch,
      });
    }
    await _auth.signOut();
  }
}
