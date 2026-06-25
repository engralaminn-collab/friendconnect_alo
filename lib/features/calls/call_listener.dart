import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/models/call_model.dart';
import 'call_screen.dart';

class CallListener extends ConsumerStatefulWidget {
  final Widget child;

  const CallListener({super.key, required this.child});

  @override
  ConsumerState<CallListener> createState() => _CallListenerState();
}

class _CallListenerState extends ConsumerState<CallListener> {
  @override
  void initState() {
    super.initState();
    _listenForIncomingCalls();
  }

  void _listenForIncomingCalls() {
    final currentUserId = FirebaseAuth.instance.currentUser?.uid;
    if (currentUserId == null) return;

    FirebaseFirestore.instance
        .collection('calls')
        .where('receiverId', isEqualTo: currentUserId)
        .where('status', isEqualTo: 'calling')
        .snapshots()
        .listen((snapshot) {
      for (var change in snapshot.docChanges) {
        if (change.type == DocumentChangeType.added) {
          final call = CallModel.fromMap(change.doc.data()!, change.doc.id);
          _showIncomingCallScreen(call);
        }
      }
    });
  }

  void _showIncomingCallScreen(CallModel call) {
    if (mounted) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CallScreen(
            callId: call.id,
            isVideo: call.type == 'video',
            isIncoming: true,
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}
