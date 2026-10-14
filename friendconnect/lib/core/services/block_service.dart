import 'dart:async';
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
    final controller = StreamController<bool>();
    final blockedState = [false, false];
    final subscriptions = <StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>>[];
    final references = [
      _firestore.collection('blocks').doc('${currentUserId}_$otherUserId'),
      _firestore.collection('blocks').doc('${otherUserId}_$currentUserId'),
    ];

    controller.onListen = () {
      for (var index = 0; index < references.length; index++) {
        final position = index;
        subscriptions.add(references[index].snapshots().listen((snapshot) {
          blockedState[position] = snapshot.exists;
          if (!controller.isClosed) controller.add(blockedState.any((blocked) => blocked));
        }, onError: controller.addError));
      }
    };
    controller.onCancel = () async {
      for (final subscription in subscriptions) {
        await subscription.cancel();
      }
    };
    return controller.stream;
  }
}
