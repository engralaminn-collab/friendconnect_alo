import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../core/services/chat_service.dart';
import '../../core/models/message_model.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/services/webrtc_service.dart';
import '../calls/call_screen.dart';

class ChatScreen extends ConsumerStatefulWidget {
  final String chatId;
  final String friendId;
  final String friendName;

  const ChatScreen({
    super.key,
    required this.chatId,
    required this.friendId,
    required this.friendName,
  });

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  bool _isUploading = false;

  void _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _messageController.clear();
    await ref.read(chatServiceProvider).updateTypingStatus(widget.chatId, false);
    
    await ref.read(chatServiceProvider).sendMessage(widget.chatId, text, 'text');
  }

  void _onTextChanged(String text) {
    ref.read(chatServiceProvider).updateTypingStatus(widget.chatId, text.isNotEmpty);
  }

  Future<void> _pickAndUploadMedia(bool isVideo) async {
    final XFile? file = isVideo 
        ? await _picker.pickVideo(source: ImageSource.gallery)
        : await _picker.pickImage(source: ImageSource.gallery);
    
    if (file != null) {
      setState(() => _isUploading = true);
      
      final url = await ref.read(chatServiceProvider).uploadMedia(
        File(file.path), 
        widget.chatId, 
        isVideo ? 'video' : 'image'
      );

      if (url != null) {
        await ref.read(chatServiceProvider).sendMessage(widget.chatId, url, isVideo ? 'video' : 'image');
      }
      
      setState(() => _isUploading = false);
    }
  }

  void _startCall(bool isVideo) async {
    final callId = await ref.read(webRTCServiceProvider).makeCall(widget.friendId, isVideo);
    if (mounted) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CallScreen(callId: callId, isVideo: isVideo, isIncoming: false),
        ),
      );
    }
  }

  @override
  void dispose() {
    ref.read(chatServiceProvider).updateTypingStatus(widget.chatId, false);
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatService = ref.watch(chatServiceProvider);
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.friendName),
            StreamBuilder<Map<String, dynamic>>(
              stream: chatService.getTypingStatus(widget.chatId),
              builder: (context, snapshot) {
                if (snapshot.hasData && snapshot.data![widget.friendId] == true) {
                  return const Text('typing...', style: TextStyle(fontSize: 12, color: Colors.greenAccent));
                }
                return const SizedBox.shrink();
              },
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.call), onPressed: () => _startCall(false)),
          IconButton(icon: const Icon(Icons.videocam), onPressed: () => _startCall(true)),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<List<MessageModel>>(
              stream: chatService.getMessages(widget.chatId),
              builder: (context, snapshot) {
                if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                
                final messages = snapshot.data!;
                return ListView.builder(
                  reverse: true,
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[index];
                    final isMe = msg.senderId == currentUserId;
                    return _buildMessageItem(msg, isMe);
                  },
                );
              },
            ),
          ),
          if (_isUploading) const LinearProgressIndicator(),
          _buildMessageInput(),
        ],
      ),
    );
  }

  Widget _buildMessageItem(MessageModel msg, bool isMe) {
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isMe ? Colors.blue : Colors.grey.shade300,
          borderRadius: BorderRadius.circular(16).copyWith(
            bottomRight: isMe ? const Radius.circular(0) : null,
            bottomLeft: !isMe ? const Radius.circular(0) : null,
          ),
        ),
        child: _buildMessageContent(msg, isMe),
      ),
    );
  }

  Widget _buildMessageContent(MessageModel msg, bool isMe) {
    if (msg.type == 'text') {
      return Text(msg.content, style: TextStyle(color: isMe ? Colors.white : Colors.black87));
    } else if (msg.type == 'image') {
      return CachedNetworkImage(
        imageUrl: msg.content,
        width: 200,
        height: 200,
        fit: BoxFit.cover,
        placeholder: (context, url) => const CircularProgressIndicator(),
        errorWidget: (context, url, error) => const Icon(Icons.error),
      );
    } else if (msg.type == 'video') {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.videocam, color: Colors.white),
          const SizedBox(width: 8),
          Text('Video', style: TextStyle(color: isMe ? Colors.white : Colors.black87)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _buildMessageInput() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      color: Theme.of(context).cardColor,
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.image),
            onPressed: () => _pickAndUploadMedia(false),
          ),
          IconButton(
            icon: const Icon(Icons.video_library),
            onPressed: () => _pickAndUploadMedia(true),
          ),
          Expanded(
            child: TextField(
              controller: _messageController,
              onChanged: _onTextChanged,
              decoration: const InputDecoration(
                hintText: 'Type a message...',
                border: InputBorder.none,
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.send, color: Colors.blue),
            onPressed: _sendMessage,
          ),
        ],
      ),
    );
  }
}
