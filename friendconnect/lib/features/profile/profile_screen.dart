import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../core/models/user_model.dart';
import '../../core/services/auth_service.dart';
import '../auth/login_screen.dart';
import 'blocked_users_screen.dart';
import 'settings_screen.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    if (currentUserId == null) return const Center(child: Text('Not logged in'));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await ref.read(authServiceProvider).logout();
              if (context.mounted) {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                );
              }
            },
          )
        ],
      ),
      body: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance.collection('users').doc(currentUserId).snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          if (!snapshot.data!.exists) return const Center(child: Text('Profile not found'));

          final user = UserModel.fromMap(snapshot.data!.data() as Map<String, dynamic>, snapshot.data!.id);

          return Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 50,
                  child: Text(user.name[0].toUpperCase(), style: const TextStyle(fontSize: 40)),
                ),
                const SizedBox(height: 20),
                Text(user.name, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                Text('@${user.username}', style: const TextStyle(fontSize: 16, color: Colors.grey)),
                const SizedBox(height: 40),
                ListTile(
                  leading: const Icon(Icons.email),
                  title: const Text('Email'),
                  subtitle: Text(user.email),
                ),
                ListTile(
                  leading: const Icon(Icons.visibility),
                  title: const Text('Profile Visibility'),
                  subtitle: Text(user.profileVisibility.toUpperCase()),
                ),
                ListTile(
                  leading: const Icon(Icons.admin_panel_settings),
                  title: const Text('Role'),
                  subtitle: Text(user.role.toUpperCase()),
                ),
                const Divider(),
                ListTile(
                  leading: const Icon(Icons.block, color: Colors.red),
                  title: const Text('Blocked Users', style: TextStyle(color: Colors.red)),
                  onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const BlockedUsersScreen()));
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.settings),
                  title: const Text('Settings'),
                  onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
