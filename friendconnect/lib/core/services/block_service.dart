import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final blockServiceProvider = Provider<BlockService>((ref) {
  return BlockService(FirebaseFirestore.instance, FirebaseAuth.instance);
});

class BlockService {
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  BlockService(this._firestore, this._auth);

  Future<void> blockUser(String blockedId) async {
    final blockerId = _auth.currentUser!.uid;
    final blockId = '${blockerId}_$blockedId';

    await _firestore.collection('blocks').doc(blockId).set({
      'blockerId': blockerId,
      'blockedId': blockedId,
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<void> unblockUser(String blockedId) async {
    final blockerId = _auth.currentUser!.uid;
    final blockId = '${blockerId}_$blockedId';

    await _firestore.collection('blocks').doc(blockId).delete();
  }

  Stream<bool> isBlocked(String otherUserId) {
    final currentUserId = _auth.currentUser!.uid;
    return _firestore.collection('blocks').snapshots().map((snapshot) {
      for (var doc in snapshot.docs) {
        final data = doc.data();
        if ((data['blockerId'] == currentUserId && data['blockedId'] == otherUserId) ||
            (data['blockerId'] == otherUserId && data['blockedId'] == currentUserId)) {
          return true;
        }
      }
      return false;
    });
  }
}
