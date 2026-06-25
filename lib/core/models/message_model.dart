class MessageModel {
  final String id;
  final String chatId;
  final String senderId;
  final String type; // 'text', 'image', 'video', 'file', 'voice'
  final String content;
  final int createdAt;
  final String status; // 'sent', 'delivered', 'seen'
  final String? replyToId;

  MessageModel({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.createdAt,
    required this.status,
    this.replyToId,
  });

  factory MessageModel.fromMap(Map<String, dynamic> map, String documentId) {
    return MessageModel(
      id: documentId,
      chatId: map['chatId'] ?? '',
      senderId: map['senderId'] ?? '',
      type: map['type'] ?? 'text',
      content: map['content'] ?? '',
      createdAt: map['createdAt'] ?? 0,
      status: map['status'] ?? 'sent',
      replyToId: map['replyToId'],
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'chatId': chatId,
      'senderId': senderId,
      'type': type,
      'content': content,
      'createdAt': createdAt,
      'status': status,
      'replyToId': replyToId,
    };
  }
}
