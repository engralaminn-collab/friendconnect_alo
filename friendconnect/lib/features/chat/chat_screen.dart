import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:file_picker/file_picker.dart';
import '../../core/services/chat_service.dart';
import '../../core/services/block_service.dart';
import '../../core/services/presence_service.dart';
import '../../core/models/message_model.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/services/webrtc_service.dart';
import '../calls/call_screen.dart';
import 'chat_info_screen.dart';

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
  final TextEditingController _searchController = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();
  bool _isUploading = false;
  bool _isSearching = false;
  bool _isRecording = false;
  String _searchQuery = '';
  String? _audioPath;

  void _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _messageController.clear();
    await ref.read(chatServiceProvider).updateTypingStatus(widget.chatId, false);
    
    await ref.read(chatServiceProvider).sendMessage(widget.chatId, text, 'text');
  }

  Future<void> _startRecording() async {
    if (await _audioRecorder.hasPermission()) {
      final dir = await getApplicationDocumentsDirectory();
      _audioPath = '${dir.path}/audio_${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _audioRecorder.start(const RecordConfig(), path: _audioPath!);
      setState(() { _isRecording = true; });
    }
  }

  Future<void> _stopRecording() async {
    final path = await _audioRecorder.stop();
    setState(() { _isRecording = false; });
    if (path != null) {
      setState(() => _isUploading = true);
      final url = await ref.read(chatServiceProvider).uploadMedia(
        File(path), 
        widget.chatId, 
        'audio'
      );
      if (url != null) {
        await ref.read(chatServiceProvider).sendMessage(widget.chatId, url, 'audio');
      }
      setState(() => _isUploading = false);
    }
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

  Future<void> _pickAndUploadFile() async {
    FilePickerResult? result = await FilePicker.platform.pickFiles();
    if (result != null && result.files.single.path != null) {
      setState(() => _isUploading = true);
      final url = await ref.read(chatServiceProvider).uploadMedia(
        File(result.files.single.path!),
        widget.chatId,
        'file'
      );
      if (url != null) {
        await ref.read(chatServiceProvider).sendMessage(widget.chatId, url, 'file');
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
    _searchController.dispose();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatService = ref.watch(chatServiceProvider);
    final blockService = ref.watch(blockServiceProvider);
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;

    return StreamBuilder<bool>(
      stream: blockService.isBlocked(widget.friendId),
      builder: (context, blockSnapshot) {
        final isBlocked = blockSnapshot.data == true;
        
        return Scaffold(
          appBar: AppBar(
            title: _isSearching
                ? TextField(
                    controller: _searchController,
                    autofocus: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      hintText: 'Search messages...',
                      hintStyle: TextStyle(color: Colors.white70),
                      border: InputBorder.none,
                    ),
                    onChanged: (value) {
                      setState(() {
                        _searchQuery = value;
                      });
                    },
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.friendName),
                      if (!isBlocked)
                        StreamBuilder<Map<String, dynamic>>(
                          stream: chatService.getTypingStatus(widget.chatId),
                          builder: (context, snapshot) {
                            if (snapshot.hasData && snapshot.data![widget.friendId] == true) {
                              return const Text('typing...', style: TextStyle(fontSize: 12, color: Colors.greenAccent));
                            }
                            return StreamBuilder<bool>(
                              stream: ref.watch(presenceServiceProvider).getUserPresence(widget.friendId),
                              builder: (context, presenceSnapshot) {
                                final isOnline = presenceSnapshot.data == true;
                                return Text(
                                  isOnline ? 'online' : 'offline',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: isOnline ? Colors.greenAccent : Colors.white70,
                                  ),
                                );
                              },
                            );
                          },
                        ),
                    ],
                  ),
            actions: [
              IconButton(
                icon: Icon(_isSearching ? Icons.close : Icons.search),
                onPressed: () {
                  setState(() {
                    _isSearching = !_isSearching;
                    if (!_isSearching) {
                      _searchController.clear();
                      _searchQuery = '';
                    }
                  });
                },
              ),
              if (!_isSearching && !isBlocked) ...[
                IconButton(icon: const Icon(Icons.call), onPressed: () => _startCall(false)),
                IconButton(icon: const Icon(Icons.videocam), onPressed: () => _startCall(true)),
              ],
              if (!_isSearching)
                IconButton(
                  icon: const Icon(Icons.info), 
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => ChatInfoScreen(chatId: widget.chatId, friendName: widget.friendName)),
                    );
                  }
                ),
            ],
          ),
          body: Column(
            children: [
              Expanded(
                child: StreamBuilder<List<MessageModel>>(
                  stream: chatService.getMessages(widget.chatId),
                  builder: (context, snapshot) {
                    if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                    
                    var messages = snapshot.data!;
                    if (_searchQuery.isNotEmpty) {
                      messages = messages.where((msg) => 
                        msg.type == 'text' && msg.content.toLowerCase().contains(_searchQuery.toLowerCase())
                      ).toList();
                    }

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
              isBlocked
                ? Container(
                    padding: const EdgeInsets.all(16),
                    color: Colors.grey.shade300,
                    child: const Center(child: Text('You cannot message this user.')),
                  )
                : _buildMessageInput(),
            ],
          ),
        );
      }
    );
  }

  Widget _buildMessageItem(MessageModel msg, bool isMe) {
    if (!isMe && msg.readAt == null) {
      // Mark as read when displayed, wrap in post frame to avoid any build phase issues
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(chatServiceProvider).markAsRead(widget.chatId, msg.id);
      });
    }

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _showReactionDialog(msg),
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
          child: Column(
            crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              _buildMessageContent(msg, isMe),
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _formatTime(msg.createdAt),
                    style: TextStyle(
                      fontSize: 10,
                      color: isMe ? Colors.white70 : Colors.black54,
                    ),
                  ),
                  if (isMe) ...[
                    const SizedBox(width: 4),
                    Icon(
                      msg.readAt != null ? Icons.done_all : Icons.check,
                      size: 14,
                      color: msg.readAt != null ? Colors.amberAccent : Colors.white70,
                    ),
                  ]
                ],
              ),
              if (msg.reactions != null && msg.reactions!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Wrap(
                  spacing: 4,
                  children: msg.reactions!.values.map((emoji) => Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(emoji.toString(), style: const TextStyle(fontSize: 12)),
                  )).toList(),
                )
              ]
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }

  void _showReactionDialog(MessageModel msg) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: ['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) {
                return GestureDetector(
                  onTap: () {
                    ref.read(chatServiceProvider).addReaction(widget.chatId, msg.id, emoji);
                    Navigator.pop(context);
                  },
                  child: Text(emoji, style: const TextStyle(fontSize: 24)),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.forward),
              title: const Text('Forward'),
              onTap: () {
                Navigator.pop(context);
                _showForwardDialog(msg);
              },
            ),
            if (msg.senderId == FirebaseAuth.instance.currentUser!.uid) ...[
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Edit'),
                onTap: () {
                  Navigator.pop(context);
                  _showEditDialog(msg);
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete),
                title: const Text('Delete'),
                onTap: () {
                  Navigator.pop(context);
                  ref.read(chatServiceProvider).deleteMessage(widget.chatId, msg.id);
                },
              ),
            ]
          ],
        ),
      ),
    );
  }

  void _showEditDialog(MessageModel msg) {
    if (msg.type != 'text') return;
    final controller = TextEditingController(text: msg.content);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit Message'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(hintText: 'New message'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                ref.read(chatServiceProvider).editMessage(widget.chatId, msg.id, controller.text.trim());
              }
              Navigator.pop(context);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showForwardDialog(MessageModel msg) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Forward to...'),
          content: SizedBox(
            width: double.maxFinite,
            height: 300,
            child: StreamBuilder<QuerySnapshot>(
              stream: FirebaseFirestore.instance.collection('chats').where('participants', arrayContains: FirebaseAuth.instance.currentUser!.uid).snapshots(),
              builder: (context, snapshot) {
                if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                final chats = snapshot.data!.docs;
                if (chats.isEmpty) return const Center(child: Text('No other chats.'));
                return ListView.builder(
                  shrinkWrap: true,
                  itemCount: chats.length,
                  itemBuilder: (context, index) {
                    final chatData = chats[index].data() as Map<String, dynamic>;
                    final otherParticipants = List<String>.from(chatData['participants'])..remove(FirebaseAuth.instance.currentUser!.uid);
                    final friendId = otherParticipants.isNotEmpty ? otherParticipants.first : 'Unknown';
                    
                    return FutureBuilder<DocumentSnapshot>(
                      future: FirebaseFirestore.instance.collection('users').doc(friendId).get().catchError((e) {
                        return FirebaseFirestore.instance.collection('users').doc(friendId).get(const GetOptions(source: Source.cache));
                      }),
                      builder: (context, userSnap) {
                        if (!userSnap.hasData) return const ListTile(title: Text('Loading...'));
                        final userData = userSnap.data!.data() as Map<String, dynamic>?;
                        final name = userData?['name'] ?? 'Unknown User';
                        return ListTile(
                          title: Text(name),
                          onTap: () {
                            ref.read(chatServiceProvider).sendMessage(chats[index].id, msg.content, msg.type);
                            Navigator.pop(context);
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Forwarded to $name')));
                          },
                        );
                      }
                    );
                  },
                );
              },
            ),
          ),
        );
      },
    );
  }

  Widget _buildMessageContent(MessageModel msg, bool isMe) {
    if (msg.type == 'text') {
      return Column(
        crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(msg.content, style: TextStyle(color: isMe ? Colors.white : Colors.black87)),
          if (msg.isEdited)
            Text('(Edited)', style: TextStyle(color: isMe ? Colors.white70 : Colors.black54, fontSize: 10)),
        ],
      );
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
    } else if (msg.type == 'audio') {
      return GestureDetector(
        onTap: () async {
          await _audioPlayer.play(UrlSource(msg.content));
        },
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.play_arrow, color: Colors.white),
            const SizedBox(width: 8),
            Text('Audio Message (Tap to play)', style: TextStyle(color: isMe ? Colors.white : Colors.black87)),
          ],
        ),
      );
    } else if (msg.type == 'file') {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.insert_drive_file, color: Colors.white),
          const SizedBox(width: 8),
          Text('File Attachment', style: TextStyle(color: isMe ? Colors.white : Colors.black87)),
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
            icon: const Icon(Icons.attach_file),
            onPressed: _pickAndUploadFile,
          ),
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
              decoration: InputDecoration(
                hintText: _isRecording ? 'Recording...' : 'Type a message...',
                border: InputBorder.none,
              ),
            ),
          ),
          _messageController.text.trim().isEmpty
            ? GestureDetector(
                onLongPress: () {
                  _startRecording();
                },
                onLongPressUp: () {
                  _stopRecording();
                },
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Icon(Icons.mic, color: _isRecording ? Colors.red : Colors.blue),
                ),
              )
            : IconButton(
                icon: const Icon(Icons.send, color: Colors.blue),
                onPressed: _sendMessage,
              ),
        ],
      ),
    );
  }
}
