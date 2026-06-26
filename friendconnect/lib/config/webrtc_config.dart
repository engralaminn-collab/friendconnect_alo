class WebRTCConfig {
  static const String turnUrl = String.fromEnvironment('TURN_URL', defaultValue: '');
  static const String turnUsername = String.fromEnvironment('TURN_USERNAME', defaultValue: '');
  static const String turnPassword = String.fromEnvironment('TURN_PASSWORD', defaultValue: '');

  static Map<String, dynamic> get defaultConfiguration {
    List<Map<String, dynamic>> iceServers = [
      {
        'urls': [
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302'
        ]
      }
    ];

    if (turnUrl.isNotEmpty && turnUsername.isNotEmpty && turnPassword.isNotEmpty) {
      iceServers.add({
        'urls': turnUrl,
        'username': turnUsername,
        'credential': turnPassword,
      });
    }

    return {
      'iceServers': iceServers,
    };
  }
}
