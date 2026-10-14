import 'package:flutter/material.dart';

class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Private circle')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.people_alt_outlined, size: 48),
              const SizedBox(height: 18),
              const Text(
                'FriendConnect is invite-only. Ask your admin to create and approve an account for you.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, height: 1.5),
              ),
              const SizedBox(height: 20),
              OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Back to sign in')),
            ],
          ),
        ),
      ),
    );
  }
}
