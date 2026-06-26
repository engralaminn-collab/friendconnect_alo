import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'chat_screen.dart';
import '../../core/services/chat_service.dart';
import '../../core/services/presence_service.dart';

class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});

  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> {
  bool _showArchived = false;

  @override
  Widget build(BuildContext context) {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    if (currentUserId == null) return const Scaffold(body: Center(child: Text('Not logged in')));

    return Scaffold(
      appBar: AppBar(
        title: Text(_showArchived ? 'Archived Chats' : 'Chats'),
        actions: [
          IconButton(
            icon: Icon(_showArchived ? Icons.chat : Icons.archive),
            onPressed: () => setState(() => _showArchived = !_showArchived),
          ),
        ],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('chats')
            .where('participants', arrayContains: currentUserId)
            .orderBy('lastMessageTime', descending: true)
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          
          var docs = snapshot.data!.docs.where((doc) {
            final chat = doc.data() as Map<String, dynamic>;
            final archivedBy = List<String>.from(chat['archivedBy'] ?? []);
            final isArchived = archivedBy.contains(currentUserId);
            return _showArchived ? isArchived : !isArchived;
          }).toList();

          if (docs.isEmpty) return Center(child: Text(_showArchived ? 'No archived chats.' : 'No chats yet.'));

          return ListView.builder(
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final doc = docs[index];
              final chat = doc.data() as Map<String, dynamic>;
              final participants = List<String>.from(chat['participants']);
              participants.remove(currentUserId);
              final friendId = participants.first;

              return FutureBuilder<DocumentSnapshot>(
                future: FirebaseFirestore.instance.collection('users').doc(friendId).get().catchError((e) {
                  return FirebaseFirestore.instance.collection('users').doc(friendId).get(const GetOptions(source: Source.cache));
                }),
                builder: (context, userSnapshot) {
                  if (userSnapshot.hasError || !userSnapshot.hasData || !userSnapshot.data!.exists) return const ListTile(title: Text('Loading...'));
                  final friendData = userSnapshot.data!.data() as Map<String, dynamic>;

                  return Dismissible(
                    key: Key(doc.id),
                    direction: _showArchived ? DismissDirection.none : DismissDirection.endToStart,
                    background: Container(
                      color: Colors.red,
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 20),
                      child: const Icon(Icons.archive, color: Colors.white),
                    ),
                    onDismissed: (_) {
                      ref.read(chatServiceProvider).archiveChat(doc.id);
                    },
                      child: ListTile(
                        leading: Stack(
                          children: [
                            CircleAvatar(
                              child: Text(friendData['name'][0].toUpperCase()),
                            ),
                            Positioned(
                              right: 0,
                              bottom: 0,
                              child: StreamBuilder<bool>(
                                stream: ref.watch(presenceServiceProvider).getUserPresence(friendId),
                                builder: (context, snapshot) {
                                  final isOnline = snapshot.data == true;
                                  return Container(
                                    width: 12,
                                    height: 12,
                                    decoration: BoxDecoration(
                                      color: isOnline ? Colors.green : Colors.grey,
                                      shape: BoxShape.circle,
                                      border: Border.all(color: Colors.white, width: 2),
                                    ),
                                  );
                                },
                              ),
                            ),
                          ],
                        ),
                        title: Text(friendData['name']),
                        subtitle: Text(chat['lastMessage'] ?? 'Started a chat'),
                        onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ChatScreen(
                              chatId: doc.id,
                              friendId: friendId,
                              friendName: friendData['name'],
                            ),
                          ),
                        );
                      },
                    ),
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
