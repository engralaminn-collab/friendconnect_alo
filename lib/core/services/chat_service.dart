import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message_model.dart';
import 'package:uuid/uuid.dart';

final chatServiceProvider = Provider<ChatService>((ref) {
  return ChatService(FirebaseFirestore.instance, FirebaseAuth.instance, FirebaseStorage.instance);
});

class ChatService {
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final FirebaseStorage _storage;

  ChatService(this._firestore, this._auth, this._storage);

  Future<String> createOrGetChat(String friendId) async {
    final currentUserId = _auth.currentUser!.uid;
    
    // Check if chat exists
    final query = await _firestore.collection('chats')
        .where('participants', arrayContains: currentUserId)
        .get();

    for (var doc in query.docs) {
      List<dynamic> participants = doc.data()['participants'];
      if (participants.contains(friendId)) {
        return doc.id;
      }
    }

    // Create new chat
    final chatRef = _firestore.collection('chats').doc();
    await chatRef.set({
      'participants': [currentUserId, friendId],
      'createdAt': DateTime.now().millisecondsSinceEpoch,
      'typing': {},
    });

    return chatRef.id;
  }

  Future<void> sendMessage(String chatId, String content, String type, {String? replyToId}) async {
    final currentUserId = _auth.currentUser!.uid;
    final messageRef = _firestore.collection('chats').doc(chatId).collection('messages').doc();

    final message = MessageModel(
      id: messageRef.id,
      chatId: chatId,
      senderId: currentUserId,
      type: type,
      content: content,
      createdAt: DateTime.now().millisecondsSinceEpoch,
      status: 'sent',
      replyToId: replyToId,
    );

    await messageRef.set(message.toMap());

    // Update last message in chat
    await _firestore.collection('chats').doc(chatId).update({
      'lastMessage': type == 'text' ? content : '[$type]',
      'lastMessageTime': message.createdAt,
    });
  }

  Future<String?> uploadMedia(File file, String chatId, String type) async {
    try {
      final ext = file.path.split('.').last;
      final fileName = '${const Uuid().v4()}.$ext';
      final ref = _storage.ref().child('chat/$chatId/$type/$fileName');
      
      final uploadTask = await ref.putFile(file);
      return await uploadTask.ref.getDownloadURL();
    } catch (e) {
      return null;
    }
  }

  Stream<List<MessageModel>> getMessages(String chatId) {
    return _firestore.collection('chats').doc(chatId).collection('messages')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map((doc) => MessageModel.fromMap(doc.data(), doc.id)).toList();
    });
  }

  Future<void> updateTypingStatus(String chatId, bool isTyping) async {
    final currentUserId = _auth.currentUser!.uid;
    await _firestore.collection('chats').doc(chatId).update({
      'typing.$currentUserId': isTyping,
    });
  }

  Stream<Map<String, dynamic>> getTypingStatus(String chatId) {
    return _firestore.collection('chats').doc(chatId).snapshots().map((snapshot) {
      if (snapshot.exists && snapshot.data()!.containsKey('typing')) {
        return snapshot.data()!['typing'] as Map<String, dynamic>;
      }
      return {};
    });
  }
}
