import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'chat_screen.dart';
import '../../core/services/chat_service.dart';

class ChatListScreen extends ConsumerWidget {
  const ChatListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    if (currentUserId == null) return const Scaffold(body: Center(child: Text('Not logged in')));

    return Scaffold(
      appBar: AppBar(title: const Text('Chats')),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('chats')
            .where('participants', arrayContains: currentUserId)
            .orderBy('lastMessageTime', descending: true)
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          
          final docs = snapshot.data!.docs;
          if (docs.isEmpty) return const Center(child: Text('No chats yet.'));

          return ListView.builder(
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final chat = docs[index].data() as Map<String, dynamic>;
              final participants = List<String>.from(chat['participants']);
              participants.remove(currentUserId);
              final friendId = participants.first;

              return FutureBuilder<DocumentSnapshot>(
                future: FirebaseFirestore.instance.collection('users').doc(friendId).get(),
                builder: (context, userSnapshot) {
                  if (!userSnapshot.hasData) return const ListTile(title: Text('Loading...'));
                  final friendData = userSnapshot.data!.data() as Map<String, dynamic>;

                  return ListTile(
                    leading: CircleAvatar(
                      child: Text(friendData['name'][0].toUpperCase()),
                    ),
                    title: Text(friendData['name']),
                    subtitle: Text(chat['lastMessage'] ?? 'Started a chat'),
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ChatScreen(
                            chatId: docs[index].id,
                            friendId: friendId,
                            friendName: friendData['name'],
                          ),
                        ),
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
