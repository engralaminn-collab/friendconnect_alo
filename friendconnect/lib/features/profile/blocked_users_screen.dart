import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/services/block_service.dart';

class BlockedUsersScreen extends ConsumerWidget {
  const BlockedUsersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    if (currentUserId == null) return const Scaffold();

    return Scaffold(
      appBar: AppBar(title: const Text('Blocked Users')),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('blocks')
            .where('blockerId', isEqualTo: currentUserId)
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          
          final blocks = snapshot.data!.docs;
          if (blocks.isEmpty) return const Center(child: Text('No blocked users.'));

          return ListView.builder(
            itemCount: blocks.length,
            itemBuilder: (context, index) {
              final block = blocks[index].data() as Map<String, dynamic>;
              final blockedId = block['blockedId'];

              return FutureBuilder<DocumentSnapshot>(
                future: FirebaseFirestore.instance.collection('users').doc(blockedId).get().catchError((e) {
                  return FirebaseFirestore.instance.collection('users').doc(blockedId).get(const GetOptions(source: Source.cache));
                }),
                builder: (context, userSnap) {
                  if (userSnap.hasError || !userSnap.hasData) return const ListTile(title: Text('Loading...'));
                  if (!userSnap.data!.exists) return const SizedBox.shrink();
                  
                  final userData = userSnap.data!.data() as Map<String, dynamic>;

                  return ListTile(
                    leading: CircleAvatar(child: Text(userData['name'][0].toUpperCase())),
                    title: Text(userData['name']),
                    subtitle: Text('@${userData['username']}'),
                    trailing: TextButton(
                      onPressed: () {
                        ref.read(blockServiceProvider).unblockUser(blockedId);
                      },
                      child: const Text('Unblock', style: TextStyle(color: Colors.blue)),
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
