import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/screens/auth/login_screen.dart';
import 'package:nymix_mobile/screens/main_shell.dart';
import 'package:nymix_mobile/services/api_service.dart';

class NymixApp extends StatelessWidget {
  const NymixApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nymix',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const _SessionGate(),
    );
  }
}

class _SessionGate extends StatefulWidget {
  const _SessionGate();

  @override
  State<_SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<_SessionGate> {
  late Future<dynamic> _session;

  @override
  void initState() {
    super.initState();
    _session = ApiService().restoreSession();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<dynamic>(
      future: _session,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Unable to connect to the server.'),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () => setState(
                        () => _session = ApiService().restoreSession(),
                      ),
                      child: const Text('Try again'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(context).pushReplacement(
                        MaterialPageRoute(
                          builder: (_) => const LoginScreen(),
                        ),
                      ),
                      child: const Text('Go to sign in'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
        final user = snapshot.data;
        if (user == null) return const LoginScreen();
        return MainShell(user: user);
      },
    );
  }
}
