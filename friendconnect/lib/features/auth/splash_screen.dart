import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'login_screen.dart';
import '../home/home_screen.dart';
import '../../core/services/notification_service.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  void _checkAuth() async {
    await Future.delayed(const Duration(seconds: 2));
    final user = FirebaseAuth.instance.currentUser;
    var isApproved = false;
    if (user != null) {
      try {
        var profile = await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
        if (!profile.exists) {
          profile = await FirebaseFirestore.instance.collection('users').doc(user.uid).get(const GetOptions(source: Source.cache));
        }
        final data = profile.data();
        isApproved = profile.exists && data?['isActive'] == true && data?['approved'] != false;
      } catch (_) {
        // If Firestore is temporarily unavailable, cached account data may still allow a private session.
        try {
          final profile = await FirebaseFirestore.instance.collection('users').doc(user.uid).get(const GetOptions(source: Source.cache));
          final data = profile.data();
          isApproved = profile.exists && data?['isActive'] == true && data?['approved'] != false;
        } catch (_) {}
      }
    }

    if (!mounted) return;
    if (user != null && isApproved) {
      ref.read(notificationServiceProvider).init();
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
      );
    } else {
      if (user != null) await FirebaseAuth.instance.signOut();
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Colors.blue,
      body: Center(
        child: Text(
          'FriendConnect',
          style: TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.white),
        ),
      ),
    );
  }
}
