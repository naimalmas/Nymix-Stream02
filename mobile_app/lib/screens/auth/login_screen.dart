import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/core/nymix_logo.dart';
import 'package:nymix_mobile/models/user_session.dart';
import 'package:nymix_mobile/screens/main_shell.dart';
import 'package:nymix_mobile/services/api_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isRegister = false;
  bool _isLoading = false;
  bool _obscurePassword = true;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      final api = ApiService();
      final UserSession user = _isRegister
          ? await api.register(
              name: _nameController.text,
              email: _emailController.text,
              password: _passwordController.text,
            )
          : await api.login(
              email: _emailController.text,
              password: _passwordController.text,
            );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => MainShell(user: user)),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.message),
          backgroundColor: AppTheme.red,
        ),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF1E1040),
              AppTheme.background,
              Color(0xFF0B1730),
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 430),
                child: Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: AppTheme.surface.withValues(alpha: .88),
                    borderRadius: BorderRadius.circular(28),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: .09),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primary.withValues(alpha: .16),
                        blurRadius: 40,
                        offset: const Offset(0, 18),
                      ),
                    ],
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 20),
                        const Center(child: NymixLogo(size: 76)),
                        const SizedBox(height: 20),
                        const Text(
                          'Nymix',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.8,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Your music, your world',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppTheme.muted),
                        ),
                        const SizedBox(height: 28),
                        SegmentedButton<bool>(
                          segments: const [
                            ButtonSegment(value: false, label: Text('Sign in')),
                            ButtonSegment(
                                value: true, label: Text('Create account')),
                          ],
                          selected: {_isRegister},
                          onSelectionChanged: _isLoading
                              ? null
                              : (selection) => setState(
                                    () => _isRegister = selection.first,
                                  ),
                        ),
                        const SizedBox(height: 22),
                        if (_isRegister) ...[
                          TextFormField(
                            controller: _nameController,
                            textCapitalization: TextCapitalization.words,
                            decoration: const InputDecoration(
                              labelText: 'Name',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                            validator: (value) => _isRegister &&
                                    (value == null || value.trim().isEmpty)
                                ? 'Enter your name'
                                : null,
                          ),
                          const SizedBox(height: 16),
                        ],
                        TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.email_outlined),
                          ),
                          validator: (value) {
                            final email = value?.trim() ?? '';
                            if (email.isEmpty || !email.contains('@')) {
                              return 'Enter a valid email address';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          autofillHints: _isRegister
                              ? const [AutofillHints.newPassword]
                              : const [AutofillHints.password],
                          decoration: InputDecoration(
                            labelText: 'Password',
                            prefixIcon: const Icon(Icons.lock_outline),
                            suffixIcon: IconButton(
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                            ),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Enter your password';
                            }
                            if (_isRegister && value.length < 6) {
                              return 'Password must be at least 6 characters';
                            }
                            return null;
                          },
                          onFieldSubmitted: (_) => _submit(),
                        ),
                        const SizedBox(height: 22),
                        ElevatedButton(
                          onPressed: _isLoading ? null : _submit,
                          child: _isLoading
                              ? const SizedBox(
                                  height: 22,
                                  width: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : Text(
                                  _isRegister ? 'Create account' : 'Sign in'),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          _isRegister
                              ? 'Your account and music library are shared with Nymix on the web.'
                              : 'Sign in with the same account you use on Nymix web.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppTheme.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
