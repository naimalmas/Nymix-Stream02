import 'package:flutter/material.dart';

class AppTheme {
  static const Color primary = Color(0xFF7C3AED);
  static const Color accent = Color(0xFFA855F7);
  static const Color background = Color(0xFF120826);
  static const Color surface = Color(0xFF1A0F35);
  static const Color surfaceRaised = Color(0xFF241644);
  static const Color text = Color(0xFFFFFFFF);
  static const Color muted = Color(0xFFC4B5FD);
  static const Color red = Color(0xFFEF4444);

  static ThemeData get lightTheme {
    final scheme = ColorScheme.fromSeed(
      seedColor: primary,
      brightness: Brightness.dark,
      surface: surface,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme.copyWith(
        primary: accent,
        secondary: const Color(0xFF22D3EE),
        surface: surface,
        surfaceContainer: surface,
        surfaceContainerHigh: surfaceRaised,
        onSurface: text,
      ),
      scaffoldBackgroundColor: background,
      appBarTheme: const AppBarTheme(
        backgroundColor: background,
        foregroundColor: text,
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(
          color: text,
          fontSize: 20,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.3,
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: const Color(0xFF190D30),
        indicatorColor: primary.withValues(alpha: 0.75),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
            color: selected ? text : muted,
          );
        }),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceRaised,
        hintStyle: TextStyle(color: muted.withValues(alpha: 0.72)),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: accent, width: 1.4),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 20),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: surfaceRaised,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      dividerTheme: DividerThemeData(
        color: Colors.white.withValues(alpha: 0.08),
        thickness: 1,
      ),
    );
  }
}
