import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/services/api_service.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({super.key});

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  final _api = ApiService();
  final _picker = ImagePicker();
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  bool _posting = false;
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
      final posts = await _api.feed();
      if (mounted) setState(() => _posts = posts);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sharePhoto() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1000,
      imageQuality: 35,
    );
    if (image == null || !mounted) return;
    final captionController = TextEditingController();
    final caption = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Share a photo'),
        content: TextField(
          controller: captionController,
          maxLength: 150,
          decoration: const InputDecoration(hintText: 'Caption (optional)'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, captionController.text),
            child: const Text('Share'),
          ),
        ],
      ),
    );
    captionController.dispose();
    if (caption == null || !mounted) return;

    final bytes = await image.readAsBytes();
    if (bytes.length > 64 * 1024) {
      _notice('This image is over 64 KB. Choose a smaller image.');
      return;
    }
    setState(() => _posting = true);
    try {
      final extension = image.name.toLowerCase().split('.').last;
      final mime = extension == 'png'
          ? 'png'
          : extension == 'webp'
              ? 'webp'
              : 'jpeg';
      await _api.createPhotoPost(
        'data:image/$mime;base64,${base64Encode(bytes)}',
        caption.trim(),
      );
      await _load();
      _notice('Photo shared to your feed');
    } on ApiException catch (error) {
      _notice(error.message);
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _toggleLike(Map<String, dynamic> post) async {
    try {
      await _api.likePhoto(post['id'].toString());
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  void _notice(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Widget _postImage(String value) {
    if (value.startsWith('data:image/')) {
      final base64Data = value.substring(value.indexOf(',') + 1);
      return Image.memory(
        base64Decode(base64Data),
        width: double.infinity,
        height: 280,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => const SizedBox(
          height: 180,
          child: Center(child: Icon(Icons.broken_image_outlined)),
        ),
      );
    }
    return Image.network(
      value,
      width: double.infinity,
      height: 280,
      fit: BoxFit.cover,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: AppNavigation.openDrawer,
          icon: const Icon(Icons.menu),
        ),
        title: const Text('Nymix Feed'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
          IconButton(
            onPressed: _posting ? null : _sharePhoto,
            icon: _posting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add_a_photo_outlined),
          ),
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
              : _posts.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'Your feed is empty. Share a photo or check back when your friends post.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppTheme.muted),
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _posts.length,
                        itemBuilder: (_, index) {
                          final post = _posts[index];
                          final author =
                              post['author'] as Map<String, dynamic>? ?? {};
                          return Card(
                            clipBehavior: Clip.antiAlias,
                            margin: const EdgeInsets.only(bottom: 14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: AppTheme.primary,
                                    child: Text(
                                      (author['name']?.toString() ?? 'N')
                                          .characters
                                          .first
                                          .toUpperCase(),
                                    ),
                                  ),
                                  title: Text(author['name'] ?? 'Nymix member'),
                                  subtitle:
                                      Text(post['createdAt']?.toString() ?? ''),
                                ),
                                _postImage(post['image']?.toString() ?? ''),
                                if ((post['caption']?.toString() ?? '')
                                    .isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                        16, 12, 16, 0),
                                    child: Text(post['caption'].toString()),
                                  ),
                                Row(
                                  children: [
                                    IconButton(
                                      onPressed: () => _toggleLike(post),
                                      icon: Icon(
                                        post['liked'] == true
                                            ? Icons.favorite
                                            : Icons.favorite_border,
                                        color: post['liked'] == true
                                            ? AppTheme.red
                                            : null,
                                      ),
                                    ),
                                    Text('${post['likes'] ?? 0}'),
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
