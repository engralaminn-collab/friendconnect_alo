import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/services/friend_service.dart';
import '../../core/services/chat_service.dart';
import '../../core/services/presence_service.dart';
import '../chat/chat_screen.dart';

class FriendListScreen extends ConsumerStatefulWidget {
  const FriendListScreen({super.key});

  @override
  ConsumerState<FriendListScreen> createState() => _FriendListScreenState();
}

class _FriendListScreenState extends ConsumerState<FriendListScreen> {
  String _searchQuery = '';
  bool _isSearching = false;

  @override
  Widget build(BuildContext context) {
    final friendService = ref.watch(friendServiceProvider);

    return Scaffold(
      appBar: AppBar(
        title: _isSearching
            ? TextField(
                autofocus: true,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  hintText: 'Search friends...',
                  hintStyle: TextStyle(color: Colors.white70),
                  border: InputBorder.none,
                ),
                onChanged: (value) => setState(() => _searchQuery = value),
              )
            : const Text('Friends'),
        actions: [
          IconButton(
            icon: Icon(_isSearching ? Icons.close : Icons.search),
            onPressed: () {
              setState(() {
                _isSearching = !_isSearching;
                if (!_isSearching) _searchQuery = '';
              });
            },
          ),
        ],
      ),
      body: StreamBuilder(
        stream: friendService.getFriends(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          
          var friends = snapshot.data!;
          if (_searchQuery.isNotEmpty) {
            friends = friends.where((f) => 
              f.name.toLowerCase().contains(_searchQuery.toLowerCase()) || 
              f.username.toLowerCase().contains(_searchQuery.toLowerCase())
            ).toList();
          }

          if (friends.isEmpty) return const Center(child: Text('No friends found.'));

          return ListView.builder(
            itemCount: friends.length,
            itemBuilder: (context, index) {
              final friend = friends[index];
              return ListTile(
                leading: Stack(
                  children: [
                    CircleAvatar(child: Text(friend.name[0].toUpperCase())),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: StreamBuilder<bool>(
                        stream: ref.watch(presenceServiceProvider).getUserPresence(friend.uid),
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
