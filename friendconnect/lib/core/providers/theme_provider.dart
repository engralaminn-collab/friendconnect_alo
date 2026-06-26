import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final themeColorProvider = StateProvider<MaterialColor>((ref) {
  return Colors.blue;
});
