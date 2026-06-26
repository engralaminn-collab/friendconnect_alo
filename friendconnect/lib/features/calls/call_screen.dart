import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../core/services/webrtc_service.dart';
import '../../core/models/call_model.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class CallScreen extends ConsumerStatefulWidget {
  final String callId;
  final bool isVideo;
  final bool isIncoming;

  const CallScreen({
    super.key,
    required this.callId,
    required this.isVideo,
    required this.isIncoming,
  });

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  final RTCVideoRenderer _localRenderer = RTCVideoRenderer();
  final RTCVideoRenderer _remoteRenderer = RTCVideoRenderer();
  bool _isMuted = false;
  bool _isVideoOff = false;
  CallModel? _call;

  @override
  void initState() {
    super.initState();
    _initRenderers();
    _setupCall();
  }

  Future<void> _initRenderers() async {
    await _localRenderer.initialize();
    await _remoteRenderer.initialize();
  }

  Future<void> _setupCall() async {
    final webrtcService = ref.read(webRTCServiceProvider);
    
    webrtcService.onAddRemoteStream = (stream) {
      if (mounted) {
        setState(() {
          _remoteRenderer.srcObject = stream;
        });
      }
    };

    webrtcService.onCallStateChange = (call) {
      if (mounted) {
        setState(() => _call = call);
        if (call.status == 'ended' || call.status == 'rejected') {
          Navigator.of(context).pop();
        }
      }
    };

    if (widget.isIncoming) {
      // Waiting for user to accept or reject
      FirebaseFirestore.instance.collection('calls').doc(widget.callId).get().catchError((e) {
        return FirebaseFirestore.instance.collection('calls').doc(widget.callId).get(const GetOptions(source: Source.cache));
      }).then((doc) {
        if(doc.exists && mounted) {
           setState(() => _call = CallModel.fromMap(doc.data()!, doc.id));
        }
      });
    } else {
      // Calling logic already started in ChatScreen
      FirebaseFirestore.instance.collection('calls').doc(widget.callId).snapshots().listen((doc) {
        if(doc.exists && mounted) {
          setState(() => _call = CallModel.fromMap(doc.data()!, doc.id));
          if (_localRenderer.srcObject == null && webrtcService.localStream != null) {
            _localRenderer.srcObject = webrtcService.localStream;
          }
        }
      });
    }
  }

  @override
  void dispose() {
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }

  void _acceptCall() async {
    await ref.read(webRTCServiceProvider).acceptCall(widget.callId);
    if (mounted) {
       setState(() {
         if (ref.read(webRTCServiceProvider).localStream != null) {
           _localRenderer.srcObject = ref.read(webRTCServiceProvider).localStream;
         }
       });
    }
  }

  void _rejectCall() async {
    await ref.read(webRTCServiceProvider).rejectCall(widget.callId);
    if (mounted) Navigator.pop(context);
  }

  void _endCall() async {
    await ref.read(webRTCServiceProvider).endCall(widget.callId);
    if (mounted) Navigator.pop(context);
  }

  void _toggleMute() {
    ref.read(webRTCServiceProvider).toggleMute();
    setState(() => _isMuted = !_isMuted);
  }

  void _toggleVideo() {
    ref.read(webRTCServiceProvider).toggleVideo();
    setState(() => _isVideoOff = !_isVideoOff);
  }
  
  void _switchCamera() {
    ref.read(webRTCServiceProvider).switchCamera();
  }

  @override
  Widget build(BuildContext context) {
    if (_call == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final isCalling = _call!.status == 'calling';

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            // Remote Video
            if (widget.isVideo && !isCalling)
              Positioned.fill(
                child: RTCVideoView(_remoteRenderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover),
              ),

            // Local Video
            if (widget.isVideo && !_isVideoOff)
              Positioned(
                right: 20,
                bottom: 120,
                width: 100,
                height: 150,
                child: Container(
                  decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: RTCVideoView(_localRenderer, mirror: true, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover),
                  ),
                ),
              ),

            // Call Status / Avatar (if audio or calling)
            if (!widget.isVideo || isCalling)
              Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircleAvatar(radius: 50, child: Icon(Icons.person, size: 50)),
                    const SizedBox(height: 20),
                    Text(
                      widget.isIncoming && isCalling ? 'Incoming Call...' : (isCalling ? 'Calling...' : 'Connected'),
                      style: const TextStyle(color: Colors.white, fontSize: 24),
                    ),
                  ],
                ),
              ),

            // Controls
            Positioned(
              bottom: 40,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  if (widget.isIncoming && isCalling) ...[
                    FloatingActionButton(
                      backgroundColor: Colors.green,
                      onPressed: _acceptCall,
                      child: const Icon(Icons.call),
                    ),
                    FloatingActionButton(
                      backgroundColor: Colors.red,
                      onPressed: _rejectCall,
                      child: const Icon(Icons.call_end),
                    ),
                  ] else ...[
                    FloatingActionButton(
                      backgroundColor: _isMuted ? Colors.white : Colors.grey.shade800,
                      foregroundColor: _isMuted ? Colors.black : Colors.white,
                      onPressed: _toggleMute,
                      child: Icon(_isMuted ? Icons.mic_off : Icons.mic),
                    ),
                    if (widget.isVideo) ...[
                      FloatingActionButton(
                        backgroundColor: _isVideoOff ? Colors.white : Colors.grey.shade800,
                        foregroundColor: _isVideoOff ? Colors.black : Colors.white,
                        onPressed: _toggleVideo,
                        child: Icon(_isVideoOff ? Icons.videocam_off : Icons.videocam),
                      ),
                      FloatingActionButton(
                        backgroundColor: Colors.grey.shade800,
                        foregroundColor: Colors.white,
                        onPressed: _switchCamera,
                        child: const Icon(Icons.flip_camera_ios),
                      ),
                    ],
                    FloatingActionButton(
                      backgroundColor: Colors.red,
                      onPressed: _endCall,
                      child: const Icon(Icons.call_end),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
