import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../config/webrtc_config.dart';
import '../models/call_model.dart';

final webRTCServiceProvider = Provider<WebRTCService>((ref) {
  return WebRTCService(FirebaseFirestore.instance, FirebaseAuth.instance);
});

class WebRTCService {
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  RTCPeerConnection? peerConnection;
  MediaStream? localStream;
  MediaStream? remoteStream;

  Function(MediaStream stream)? onAddRemoteStream;
  Function(CallModel call)? onCallStateChange;

  WebRTCService(this._firestore, this._auth);

  final Map<String, dynamic> configuration = WebRTCConfig.defaultConfiguration;

  Future<String> makeCall(String receiverId, bool isVideo) async {
    final callerId = _auth.currentUser!.uid;
    
    // Create Call Document
    DocumentReference callDoc = _firestore.collection('calls').doc();
    
    final call = CallModel(
      id: callDoc.id,
      callerId: callerId,
      receiverId: receiverId,
      type: isVideo ? 'video' : 'audio',
      status: 'preparing',
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );

    await callDoc.set(call.toMap());

    // Initialize peer connection and streams
    peerConnection = await createPeerConnection(configuration);
    await _openUserMedia(peerConnection!, isVideo);

    // Setup Remote Stream
    _setupRemoteStreamListener();

    // Listen to remote ICE Candidates
    _listenToRemoteIceCandidates(callDoc, 'receiverCandidates');

    // Create Offer
    RTCSessionDescription offer = await peerConnection!.createOffer();
    await peerConnection!.setLocalDescription(offer);

    // Save Offer to Firestore
    await callDoc.update({
      'offer': {
        'type': offer.type,
        'sdp': offer.sdp,
      },
      'status': 'calling',
    });

    // Listen for Answer
    callDoc.snapshots().listen((snapshot) async {
      if (!snapshot.exists) return;
      final data = snapshot.data() as Map<String, dynamic>;
      
      // Update Call State
      if (onCallStateChange != null) {
        onCallStateChange!(CallModel.fromMap(data, snapshot.id));
      }

      // Set Remote Description if Answer exists
      if (peerConnection?.getRemoteDescription() == null && data.containsKey('answer')) {
        var answer = data['answer'];
        RTCSessionDescription description = RTCSessionDescription(answer['sdp'], answer['type']);
        await peerConnection?.setRemoteDescription(description);
      }
      
      if (data['status'] == 'ended' || data['status'] == 'rejected') {
        _cleanUp();
      }
    });

    // Send local ICE candidates to Firestore
    peerConnection?.onIceCandidate = (RTCIceCandidate candidate) {
      callDoc.collection('callerCandidates').add({
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };

    return callDoc.id;
  }

  Future<void> joinCall(String callId) async {
    DocumentReference callDoc = _firestore.collection('calls').doc(callId);
    var snapshot = await callDoc.get().catchError((e) {
      return callDoc.get(const GetOptions(source: Source.cache));
    });
    
    if (!snapshot.exists) return;
    var callData = snapshot.data() as Map<String, dynamic>;
    bool isVideo = callData['type'] == 'video';

    // Initialize peer connection and streams
    peerConnection = await createPeerConnection(configuration);
    await _openUserMedia(peerConnection!, isVideo);

    // Setup Remote Stream
    _setupRemoteStreamListener();

    // Listen to remote ICE Candidates
    _listenToRemoteIceCandidates(callDoc, 'callerCandidates');

    // Get Offer
    var offer = callData['offer'];
    await peerConnection?.setRemoteDescription(RTCSessionDescription(offer['sdp'], offer['type']));

    // Create Answer
    RTCSessionDescription answer = await peerConnection!.createAnswer();
    await peerConnection!.setLocalDescription(answer);

    // Save Answer to Firestore
    await callDoc.update({
      'answer': {
        'type': answer.type,
        'sdp': answer.sdp,
      },
    });

    // Send local ICE candidates to Firestore
    peerConnection?.onIceCandidate = (RTCIceCandidate candidate) {
      callDoc.collection('receiverCandidates').add({
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };
    
    // Listen for call ending
    callDoc.snapshots().listen((snapshot) {
      if (!snapshot.exists) return;
      final data = snapshot.data() as Map<String, dynamic>;
      
      if (onCallStateChange != null) {
        onCallStateChange!(CallModel.fromMap(data, snapshot.id));
      }

      if (data['status'] == 'ended' || data['status'] == 'rejected') {
        _cleanUp();
      }
    });
  }

  Future<void> acceptCall(String callId) async {
    await _firestore.collection('calls').doc(callId).update({'status': 'accepted'});
    await joinCall(callId);
  }

  Future<void> rejectCall(String callId) async {
    await _firestore.collection('calls').doc(callId).update({'status': 'rejected'});
    _cleanUp();
  }

  Future<void> endCall(String callId) async {
    await _firestore.collection('calls').doc(callId).update({'status': 'ended'});
    _cleanUp();
  }

  Future<void> _openUserMedia(RTCPeerConnection pc, bool isVideo) async {
    final Map<String, dynamic> mediaConstraints = {
      'audio': true,
      'video': isVideo ? {'facingMode': 'user'} : false,
    };

    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    
    localStream?.getTracks().forEach((track) {
      pc.addTrack(track, localStream!);
    });
  }

  void _setupRemoteStreamListener() {
    peerConnection?.onTrack = (RTCTrackEvent event) {
      if (event.streams.isNotEmpty) {
        remoteStream = event.streams[0];
        if (onAddRemoteStream != null) {
          onAddRemoteStream!(remoteStream!);
        }
      }
    };
  }

  void _listenToRemoteIceCandidates(DocumentReference callDoc, String collectionName) {
    callDoc.collection(collectionName).snapshots().listen((snapshot) {
      for (var change in snapshot.docChanges) {
        if (change.type == DocumentChangeType.added) {
          var data = change.doc.data() as Map<String, dynamic>;
          peerConnection?.addCandidate(
            RTCIceCandidate(data['candidate'], data['sdpMid'], data['sdpMLineIndex']),
          );
        }
      }
    });
  }

  void toggleMute() {
    if (localStream != null) {
      var audioTracks = localStream!.getAudioTracks();
      if (audioTracks.isNotEmpty) {
        bool enabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !enabled;
      }
    }
  }

  void toggleVideo() {
    if (localStream != null) {
      var videoTracks = localStream!.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        bool enabled = videoTracks[0].enabled;
        videoTracks[0].enabled = !enabled;
      }
    }
  }
  
  void switchCamera() async {
    if (localStream != null) {
      var videoTracks = localStream!.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        await Helper.switchCamera(videoTracks[0]);
      }
    }
  }

  void _cleanUp() {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream?.dispose();
    remoteStream?.getTracks().forEach((track) => track.stop());
    remoteStream?.dispose();
    peerConnection?.close();
    peerConnection?.dispose();
    
    localStream = null;
    remoteStream = null;
    peerConnection = null;
  }
}
