import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/services/auth_service.dart';
import '../chat/chat_list_screen.dart';
import '../friends/friend_list_screen.dart';
import '../friends/search_screen.dart';
import '../profile/profile_screen.dart';
import '../admin/admin_dashboard.dart';
import '../../core/models/user_model.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _currentIndex = 0;
  UserModel? _currentUser;

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null) {
      final doc = await FirebaseFirestore.instance.collection('users').doc(uid).get();
      if (doc.exists && mounted) {
        setState(() {
          _currentUser = UserModel.fromMap(doc.data()!, doc.id);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_currentUser == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final pages = [
      const ChatListScreen(),
      const FriendListScreen(),
      const SearchScreen(),
      const ProfileScreen(),
      if (_currentUser!.role == 'admin') const AdminDashboard(),
    ];

    return Scaffold(
      body: pages[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        type: BottomNavigationBarType.fixed,
        items: [
          const BottomNavigationBarItem(icon: Icon(Icons.chat), label: 'Chats'),
          const BottomNavigationBarItem(icon: Icon(Icons.people), label: 'Friends'),
          const BottomNavigationBarItem(icon: Icon(Icons.search), label: 'Search'),
          const BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profile'),
          if (_currentUser!.role == 'admin')
            const BottomNavigationBarItem(icon: Icon(Icons.admin_panel_settings), label: 'Admin'),
        ],
      ),
    );
  }
}
