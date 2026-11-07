import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/user_session.dart';
import 'package:nymix_mobile/screens/auth/login_screen.dart';
import 'package:nymix_mobile/screens/library_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.user});

  final UserSession user;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _api = ApiService();
  final _picker = ImagePicker();
  Map<String, dynamic> _profile = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final profile = widget.user.role == 'user'
          ? await _api.userProfile(widget.user.id)
          : <String, dynamic>{
              'name': widget.user.name,
              'email': widget.user.email,
              'role': widget.user.role,
              'avatar': widget.user.avatar,
            };
      if (mounted) setState(() => _profile = profile);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit() async {
    final name = TextEditingController(
      text: _profile['name']?.toString() ?? widget.user.name,
    );
    final bio = TextEditingController(text: _profile['bio']?.toString() ?? '');
    String? avatar;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Edit profile'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  maxLength: 40,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                TextField(
                  controller: bio,
                  maxLength: 160,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'About you'),
                ),
                TextButton.icon(
                  onPressed: () async {
                    final file = await _picker.pickImage(
                      source: ImageSource.gallery,
                      maxWidth: 700,
                      imageQuality: 35,
                    );
                    if (file == null) return;
                    final bytes = await file.readAsBytes();
                    if (bytes.length > 128 * 1024) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                                'Profile photos must be 128 KB or smaller'),
                          ),
                        );
                      }
                      return;
                    }
                    final ext = file.name.toLowerCase().split('.').last;
                    final mime = ext == 'png'
                        ? 'png'
                        : ext == 'webp'
                            ? 'webp'
                            : 'jpeg';
                    avatar = 'data:image/$mime;base64,${base64Encode(bytes)}';
                    setDialogState(() {});
                  },
                  icon: const Icon(Icons.photo_camera_outlined),
                  label:
                      Text(avatar == null ? 'Change photo' : 'Photo selected'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (result != true || !mounted) {
      name.dispose();
      bio.dispose();
      return;
    }
    try {
      await _api.updateProfile(
        name: name.text.trim(),
        bio: bio.text.trim(),
        avatar: avatar,
      );
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    } finally {
      name.dispose();
      bio.dispose();
    }
  }

  Future<void> _addPhoto() async {
    final file = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 700,
      imageQuality: 30,
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 64 * 1024) {
      _notice('This image is over 64 KB. Choose a smaller image.');
      return;
    }
    final ext = file.name.toLowerCase().split('.').last;
    final mime = ext == 'png'
        ? 'png'
        : ext == 'webp'
            ? 'webp'
            : 'jpeg';
    try {
      await _api.createPhotoPost(
        'data:image/$mime;base64,${base64Encode(bytes)}',
        '',
      );
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _deletePhoto(String id) async {
    try {
      await _api.deletePhoto(id);
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _logout() async {
    await _api.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  void _notice(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Widget _photo(Map<String, dynamic> photo) {
    final image = photo['image']?.toString() ?? '';
    Widget child;
    if (image.startsWith('data:image/')) {
      child = Image.memory(
        base64Decode(image.substring(image.indexOf(',') + 1)),
        fit: BoxFit.cover,
      );
    } else {
      child = Image.network(image, fit: BoxFit.cover);
    }
    return Stack(
      fit: StackFit.expand,
      children: [
        child,
        Positioned(
          top: 0,
          right: 0,
          child: IconButton(
            onPressed: () => _deletePhoto(photo['id'].toString()),
            icon: const Icon(Icons.delete_outline, color: Colors.white),
            style: IconButton.styleFrom(backgroundColor: Colors.black54),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = _profile['name']?.toString() ?? widget.user.name;
    final avatar = _profile['avatar']?.toString() ?? '';
    ImageProvider<Object>? avatarImage;
    if (avatar.startsWith('data:image/')) {
      avatarImage = MemoryImage(
        base64Decode(avatar.substring(avatar.indexOf(',') + 1)),
      );
    } else if (avatar.startsWith('http')) {
      avatarImage = NetworkImage(avatar);
    }
    final photos = (_profile['photos'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: AppNavigation.openDrawer,
          icon: const Icon(Icons.menu),
        ),
        title: const Text('Profile & dashboard'),
        actions: [
          IconButton(onPressed: _edit, icon: const Icon(Icons.edit_outlined)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      const SizedBox(height: 8),
                      Center(
                        child: CircleAvatar(
                          radius: 48,
                          backgroundColor: AppTheme.primary,
                          backgroundImage: avatarImage,
                          child: avatarImage != null
                              ? null
                              : Text(
                                  name.isEmpty
                                      ? 'N'
                                      : name.characters.first.toUpperCase(),
                                  style: const TextStyle(
                                    fontSize: 30,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        name,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        widget.user.email,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppTheme.muted),
                      ),
                      if ((_profile['bio']?.toString() ?? '').isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text(
                          _profile['bio'].toString(),
                          textAlign: TextAlign.center,
                        ),
                      ],
                      const SizedBox(height: 18),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _stat('Plays', '${_profile['totalPlays'] ?? 0}'),
                              _stat('Photos', '${photos.length}'),
                              _stat('Role', widget.user.role),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      OutlinedButton.icon(
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const LibraryScreen(initialTab: 1),
                          ),
                        ),
                        icon: const Icon(Icons.favorite_border),
                        label: const Text('Liked songs & listening history'),
                      ),
                      const SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Profile photos',
                            style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w800),
                          ),
                          if (widget.user.role == 'user')
                            IconButton(
                              onPressed: _addPhoto,
                              icon: const Icon(Icons.add_a_photo_outlined),
                            ),
                        ],
                      ),
                      if (photos.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 22),
                          child: Text(
                            'No profile photos yet',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.muted),
                          ),
                        )
                      else
                        GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: photos.length,
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 3,
                            crossAxisSpacing: 8,
                            mainAxisSpacing: 8,
                          ),
                          itemBuilder: (_, index) => ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: _photo(photos[index]),
                          ),
                        ),
                      const SizedBox(height: 22),
                      OutlinedButton.icon(
                        onPressed: _logout,
                        icon: const Icon(Icons.logout),
                        label: const Text('Log out'),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _stat(String label, String value) => Column(
        children: [
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 3),
          Text(label, style: TextStyle(color: AppTheme.muted, fontSize: 12)),
        ],
      );
}
