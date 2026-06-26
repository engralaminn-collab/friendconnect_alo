import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'firebase_options.dart';
import 'core/providers/theme_provider.dart';
import 'features/auth/splash_screen.dart';
import 'features/calls/call_listener.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  
  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: true,
  );

  runApp(const ProviderScope(child: FriendConnectApp()));
}

class FriendConnectApp extends ConsumerWidget {
  const FriendConnectApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeColor = ref.watch(themeColorProvider);

    return MaterialApp(
      title: 'FriendConnect',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: themeColor),
        useMaterial3: true,
      ),
      darkTheme: ThemeData.dark(useMaterial3: true),
      themeMode: ThemeMode.system,
      home: const CallListener(child: SplashScreen()),
    );
  }
}
