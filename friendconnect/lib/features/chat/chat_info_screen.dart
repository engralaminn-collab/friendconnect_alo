import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../core/models/message_model.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ChatInfoScreen extends ConsumerWidget {
  final String chatId;
  final String friendName;

  const ChatInfoScreen({super.key, required this.chatId, required this.friendName});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: Text('$friendName Info')),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('chats')
            .doc(chatId)
            .collection('messages')
            .where('type', whereIn: ['image', 'video'])
            .orderBy('createdAt', descending: true)
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final messages = snapshot.data!.docs.map((doc) => MessageModel.fromMap(doc.data() as Map<String, dynamic>, doc.id)).toList();

          if (messages.isEmpty) {
            return const Center(child: Text('No media shared yet.'));
          }

          return GridView.builder(
            padding: const EdgeInsets.all(8),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
            ),
            itemCount: messages.length,
            itemBuilder: (context, index) {
              final msg = messages[index];
              return ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: msg.type == 'image'
                    ? Image.network(msg.content, fit: BoxFit.cover)
                    : Container(
                        color: Colors.black,
                        child: const Icon(Icons.videocam, color: Colors.white, size: 40),
                      ),
              );
            },
          );
        },
      ),
    );
  }
}
