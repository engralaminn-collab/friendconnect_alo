import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/services/friend_service.dart';
import '../../core/services/chat_service.dart';
import '../chat/chat_screen.dart';

class FriendListScreen extends ConsumerWidget {
  const FriendListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final friendService = ref.watch(friendServiceProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Friends')),
      body: StreamBuilder(
        stream: friendService.getFriends(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          
          final friends = snapshot.data!;
          if (friends.isEmpty) return const Center(child: Text('No friends yet.'));

          return ListView.builder(
            itemCount: friends.length,
            itemBuilder: (context, index) {
              final friend = friends[index];
              return ListTile(
                leading: CircleAvatar(child: Text(friend.name[0].toUpperCase())),
                title: Text(friend.name),
                subtitle: Text('@${friend.username}'),
                trailing: IconButton(
                  icon: const Icon(Icons.message),
                  onPressed: () async {
                    final chatId = await ref.read(chatServiceProvider).createOrGetChat(friend.uid);
                    if (context.mounted) {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ChatScreen(
                            chatId: chatId,
                            friendId: friend.uid,
                            friendName: friend.name,
                          ),
                        ),
                      );
                    }
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}
