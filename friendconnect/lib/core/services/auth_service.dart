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
        DocumentSnapshot doc = await _firestore.collection('users').doc(result.user!.uid).get().catchError((e) {
          return _firestore.collection('users').doc(result.user!.uid).get(const GetOptions(source: Source.cache));
        });
        if (doc.exists) {
           await _firestore.collection('users').doc(result.user!.uid).update({
             'onlineStatus': true,
             'lastSeen': DateTime.now().millisecondsSinceEpoch,
           });
           return UserModel.fromMap(doc.data() as Map<String, dynamic>, doc.id);
        }
      }
      return null;
    } catch (e) {
      rethrow;
    }
  }

  Future<UserModel?> register(String name, String username, String email, String password) async {
    try {
      UserCredential result = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      
      if (result.user != null) {
        final userModel = UserModel(
          uid: result.user!.uid,
          name: name,
          username: username,
          email: email,
          onlineStatus: true,
          lastSeen: DateTime.now().millisecondsSinceEpoch,
          createdAt: DateTime.now().millisecondsSinceEpoch,
          isActive: true,
          role: 'user',
          profileVisibility: 'public',
        );

        await _firestore.collection('users').doc(result.user!.uid).set(userModel.toMap());
        return userModel;
      }
      return null;
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
