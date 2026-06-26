import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final presenceServiceProvider = Provider<PresenceService>((ref) {
  return PresenceService();
});

class PresenceService {
  final FirebaseDatabase _db = FirebaseDatabase.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  void setupPresence() {
    final user = _auth.currentUser;
    if (user == null) return;

    final myConnectionsRef = _db.ref('status/${user.uid}/connections');
    final lastOnlineRef = _db.ref('status/${user.uid}/lastOnline');
    final connectedRef = _db.ref('.info/connected');

    connectedRef.onValue.listen((event) {
      final connected = event.snapshot.value as bool? ?? false;
      if (connected) {
        final con = myConnectionsRef.push();
        con.onDisconnect().remove();
        lastOnlineRef.onDisconnect().set(ServerValue.timestamp);

        con.set(true);
        _db.ref('status/${user.uid}/isOnline').set(true);
        _db.ref('status/${user.uid}/isOnline').onDisconnect().set(false);
      }
    });
  }

  Stream<bool> getUserPresence(String uid) {
    return _db.ref('status/$uid/isOnline').onValue.map((event) {
      return event.snapshot.value == true;
    });
  }
}
