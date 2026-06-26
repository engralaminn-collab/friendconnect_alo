import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../core/models/user_model.dart';

class AdminDashboard extends StatefulWidget {
  const AdminDashboard({super.key});

  @override
  State<AdminDashboard> createState() => _AdminDashboardState();
}

class _AdminDashboardState extends State<AdminDashboard> {
  
  void _toggleVisibility(String userId, String currentVisibility) {
    FirebaseFirestore.instance.collection('users').doc(userId).update({
      'profileVisibility': currentVisibility == 'public' ? 'hidden' : 'public',
    });
  }

  void _toggleActive(String userId, bool currentActive) {
    FirebaseFirestore.instance.collection('users').doc(userId).update({
      'isActive': !currentActive,
    });
  }

  void _deleteUser(String userId) {
    // In a real app, you need a Cloud Function or Admin SDK to completely delete an Auth user.
    // For now, we delete the Firestore document to simulate.
    FirebaseFirestore.instance.collection('users').doc(userId).delete();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin Dashboard')),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance.collection('users').snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());

          final users = snapshot.data!.docs.map((doc) => UserModel.fromMap(doc.data() as Map<String, dynamic>, doc.id)).toList();

          return ListView.builder(
            itemCount: users.length,
            itemBuilder: (context, index) {
              final user = users[index];
              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: ExpansionTile(
                  leading: CircleAvatar(child: Text(user.role == 'admin' ? 'A' : 'U')),
                  title: Text(user.name),
                  subtitle: Text(user.email),
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        TextButton.icon(
                          icon: Icon(user.profileVisibility == 'public' ? Icons.visibility : Icons.visibility_off),
                          label: Text(user.profileVisibility),
                          onPressed: () => _toggleVisibility(user.uid, user.profileVisibility),
                        ),
                        TextButton.icon(
                          icon: Icon(user.isActive ? Icons.check_circle : Icons.cancel),
                          label: Text(user.isActive ? 'Active' : 'Disabled'),
                          onPressed: () => _toggleActive(user.uid, user.isActive),
                        ),
                        TextButton.icon(
                          icon: const Icon(Icons.delete, color: Colors.red),
                          label: const Text('Delete', style: TextStyle(color: Colors.red)),
                          onPressed: () => _deleteUser(user.uid),
                        ),
                      ],
                    )
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
