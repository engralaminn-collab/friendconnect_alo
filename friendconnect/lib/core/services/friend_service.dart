import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/user_model.dart';
import 'block_service.dart';

final friendServiceProvider = Provider<FriendService>((ref) {
  return FriendService(FirebaseFirestore.instance, FirebaseAuth.instance, ref.watch(blockServiceProvider));
});

class FriendService {
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final BlockService _blockService;

  FriendService(this._firestore, this._auth, this._blockService);

  Future<List<UserModel>> searchUsers(String query) async {
    if (query.isEmpty) return [];
    
    // In a real app, you'd use Algolia or Typesense for better search.
    // For now, doing a prefix search on username.
    final currentUserId = _auth.currentUser!.uid;

    final snapshot = await _firestore.collection('users')
        .where('username', isGreaterThanOrEqualTo: query)
        .where('username', isLessThanOrEqualTo: '$query\uf8ff')
        .get();

    List<UserModel> users = [];
    for (var doc in snapshot.docs) {
      if (doc.id == currentUserId) continue;
      final user = UserModel.fromMap(doc.data(), doc.id);
      
      // Hide profiles logic
      if (user.profileVisibility == 'hidden') continue;
      
      // Check block logic manually if needed, though rules should cover it if we query blocks directly.
      // But rules don't automatically filter search results.
      bool blocked = await _blockService.isBlocked(doc.id).first;
      if (!blocked) {
        users.add(user);
      }
    }
    return users;
  }

  Future<void> sendFriendRequest(String receiverId) async {
    final senderId = _auth.currentUser!.uid;
    final requestId = '${senderId}_$receiverId';
    
    await _firestore.collection('friendRequests').doc(requestId).set({
      'id': requestId,
      'senderId': senderId,
      'receiverId': receiverId,
      'status': 'pending',
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<void> acceptRequest(String requestId, String senderId) async {
    final receiverId = _auth.currentUser!.uid;
    
    WriteBatch batch = _firestore.batch();
    
    // Update request
    batch.update(_firestore.collection('friendRequests').doc(requestId), {
      'status': 'accepted',
    });
    
    // Add to friends collection
    final friendDoc1 = _firestore.collection('friends').doc();
    batch.set(friendDoc1, {
      'userId': receiverId,
      'friendId': senderId,
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    });

    final friendDoc2 = _firestore.collection('friends').doc();
    batch.set(friendDoc2, {
      'userId': senderId,
      'friendId': receiverId,
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    });

    await batch.commit();
  }

  Future<void> rejectRequest(String requestId) async {
    await _firestore.collection('friendRequests').doc(requestId).update({
      'status': 'rejected',
    });
  }

  Future<void> removeFriend(String friendId) async {
    final currentUserId = _auth.currentUser!.uid;
    
    final query1 = await _firestore.collection('friends')
        .where('userId', isEqualTo: currentUserId)
        .where('friendId', isEqualTo: friendId)
        .get();
        
    final query2 = await _firestore.collection('friends')
        .where('userId', isEqualTo: friendId)
        .where('friendId', isEqualTo: currentUserId)
        .get();

    WriteBatch batch = _firestore.batch();
    for (var doc in query1.docs) {
      batch.delete(doc.reference);
    }
    for (var doc in query2.docs) {
      batch.delete(doc.reference);
    }
    await batch.commit();
  }

  Stream<List<UserModel>> getFriends() {
    final currentUserId = _auth.currentUser!.uid;
    return _firestore.collection('friends')
        .where('userId', isEqualTo: currentUserId)
        .snapshots()
        .asyncMap((snapshot) async {
      List<UserModel> friends = [];
      for (var doc in snapshot.docs) {
        final friendId = doc.data()['friendId'];
        try {
          final userDoc = await _firestore.collection('users').doc(friendId).get();
          if (userDoc.exists) {
            friends.add(UserModel.fromMap(userDoc.data()!, userDoc.id));
          }
        } catch (e) {
          try {
            final userDoc = await _firestore.collection('users').doc(friendId).get(const GetOptions(source: Source.cache));
            if (userDoc.exists) {
              friends.add(UserModel.fromMap(userDoc.data()!, userDoc.id));
            }
          } catch (_) {}
        }
      }
      return friends;
    });
  }
}
