import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/theme_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Dark Mode'),
            value: Theme.of(context).brightness == Brightness.dark,
            onChanged: (val) {
              // App-level theme change would go here via Riverpod
            },
          ),
          ListTile(
            title: const Text('Theme Color'),
            subtitle: Wrap(
              spacing: 8,
              children: Colors.primaries.take(5).map((color) {
                return GestureDetector(
                  onTap: () {
                    ref.read(themeColorProvider.notifier).state = color;
                  },
                  child: Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: ref.watch(themeColorProvider) == color ? Colors.black : Colors.transparent,
                        width: 2,
                      )
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          ListTile(
            title: const Text('Notifications'),
            trailing: const Icon(Icons.arrow_forward_ios),
            onTap: () {},
          ),
          ListTile(
            title: const Text('Privacy & Security'),
            trailing: const Icon(Icons.arrow_forward_ios),
            onTap: () {},
          ),
          ListTile(
            title: const Text('About'),
            trailing: const Icon(Icons.arrow_forward_ios),
            onTap: () {},
          ),
        ],
      ),
    );
  }
}
