class UserModel {
  final String uid;
  final String name;
  final String username;
  final String email;
  final String? phone;
  final String? photoUrl;
  final String? bio;
  final bool onlineStatus;
  final int lastSeen;
  final int createdAt;
  final bool isActive;
  final String role;
  final String profileVisibility;

  UserModel({
    required this.uid,
    required this.name,
    required this.username,
    required this.email,
    this.phone,
    this.photoUrl,
    this.bio,
    required this.onlineStatus,
    required this.lastSeen,
    required this.createdAt,
    required this.isActive,
    required this.role,
    required this.profileVisibility,
  });

  factory UserModel.fromMap(Map<String, dynamic> map, String documentId) {
    return UserModel(
      uid: documentId,
      name: map['name'] ?? '',
      username: map['username'] ?? '',
      email: map['email'] ?? '',
      phone: map['phone'],
      photoUrl: map['photoUrl'],
      bio: map['bio'],
      onlineStatus: map['onlineStatus'] ?? false,
      lastSeen: map['lastSeen'] ?? 0,
      createdAt: map['createdAt'] ?? 0,
      isActive: map['isActive'] ?? true,
      role: map['role'] ?? 'user',
      profileVisibility: map['profileVisibility'] ?? 'public',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'username': username,
      'email': email,
      'phone': phone,
      'photoUrl': photoUrl,
      'bio': bio,
      'onlineStatus': onlineStatus,
      'lastSeen': lastSeen,
      'createdAt': createdAt,
      'isActive': isActive,
      'role': role,
      'profileVisibility': profileVisibility,
    };
  }
}
