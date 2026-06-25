class CallModel {
  final String id;
  final String callerId;
  final String receiverId;
  final String type; // 'audio' or 'video'
  final String status; // 'calling', 'accepted', 'rejected', 'ended'
  final int createdAt;

  CallModel({
    required this.id,
    required this.callerId,
    required this.receiverId,
    required this.type,
    required this.status,
    required this.createdAt,
  });

  factory CallModel.fromMap(Map<String, dynamic> map, String documentId) {
    return CallModel(
      id: documentId,
      callerId: map['callerId'] ?? '',
      receiverId: map['receiverId'] ?? '',
      type: map['type'] ?? 'audio',
      status: map['status'] ?? 'calling',
      createdAt: map['createdAt'] ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'callerId': callerId,
      'receiverId': receiverId,
      'type': type,
      'status': status,
      'createdAt': createdAt,
    };
  }
}
