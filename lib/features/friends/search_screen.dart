import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/services/friend_service.dart';
import '../../core/models/user_model.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _searchController = TextEditingController();
  List<UserModel> _searchResults = [];
  bool _isLoading = false;

  void _search() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;

    setState(() => _isLoading = true);
    final results = await ref.read(friendServiceProvider).searchUsers(query);
    if (mounted) {
      setState(() {
        _searchResults = results;
        _isLoading = false;
      });
    }
  }

  void _sendRequest(String receiverId) async {
    await ref.read(friendServiceProvider).sendFriendRequest(receiverId);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Friend request sent!')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    return Scaffold(
      appBar: AppBar(title: const Text('Search Users')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: const InputDecoration(
                      hintText: 'Search by username...',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                ),
                IconButton(icon: const Icon(Icons.search), onPressed: _search),
              ],
            ),
          ),
          
          // Pending Requests Section
          if (currentUserId != null)
            StreamBuilder<QuerySnapshot>(
              stream: FirebaseFirestore.instance
                  .collection('friendRequests')
                  .where('receiverId', isEqualTo: currentUserId)
                  .where('status', isEqualTo: 'pending')
                  .snapshots(),
              builder: (context, snapshot) {
                if (!snapshot.hasData || snapshot.data!.docs.isEmpty) return const SizedBox.shrink();
                
                final requests = snapshot.data!.docs;
                return ExpansionTile(
                  title: Text('Friend Requests (${requests.length})', style: const TextStyle(fontWeight: FontWeight.bold)),
                  children: requests.map((doc) {
                    final data = doc.data() as Map<String, dynamic>;
                    return FutureBuilder<DocumentSnapshot>(
                      future: FirebaseFirestore.instance.collection('users').doc(data['senderId']).get(),
                      builder: (context, userSnap) {
                        if (!userSnap.hasData) return const ListTile(title: Text('Loading...'));
                        final userData = userSnap.data!.data() as Map<String, dynamic>;
                        return ListTile(
                          title: Text(userData['name']),
                          subtitle: Text('@${userData['username']}'),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.check, color: Colors.green),
                                onPressed: () => ref.read(friendServiceProvider).acceptRequest(doc.id, data['senderId']),
                              ),
                              IconButton(
                                icon: const Icon(Icons.close, color: Colors.red),
                                onPressed: () => ref.read(friendServiceProvider).rejectRequest(doc.id),
                              ),
                            ],
                          ),
                        );
                      },
                    );
                  }).toList(),
                );
              },
            ),

          const Divider(),

          // Search Results
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    itemCount: _searchResults.length,
                    itemBuilder: (context, index) {
                      final user = _searchResults[index];
                      return ListTile(
                        leading: CircleAvatar(child: Text(user.name[0].toUpperCase())),
                        title: Text(user.name),
                        subtitle: Text('@${user.username}'),
                        trailing: IconButton(
                          icon: const Icon(Icons.person_add),
                          onPressed: () => _sendRequest(user.uid),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
