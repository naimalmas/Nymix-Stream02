import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/screens/music/player_screen.dart';

class ReelsScreen extends StatefulWidget {
  const ReelsScreen({super.key});

  @override
  State<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends State<ReelsScreen> {
  final _api = ApiService();
  List<Map<String, dynamic>> _items = [];
  String? _nextPage;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await _api.reels(pageToken: more ? _nextPage : null);
      if (!mounted) return;
      setState(() {
        final items = (result['items'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        _items = more ? [..._items, ...items] : items;
        _nextPage = result['nextPageToken']?.toString();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> reel) async {
    final song = Song(
      id: reel['id']?.toString() ?? '',
      title: reel['title']?.toString() ?? 'Music Reel',
      artist: reel['channel']?.toString() ?? 'YouTube',
      thumbnail: reel['thumbnail']?.toString() ?? '',
    );
    if (song.id.isEmpty) return;
    final queue = _items
        .map(
          (item) => Song(
            id: item['id']?.toString() ?? '',
            title: item['title']?.toString() ?? 'Music Reel',
            artist: item['channel']?.toString() ?? 'YouTube',
            thumbnail: item['thumbnail']?.toString() ?? '',
          ),
        )
        .where((item) => item.id.isNotEmpty)
        .toList();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PlayerScreen(song: song, queue: queue),
      ),
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
        title: const Text('Music Reels'),
        actions: [
          IconButton(onPressed: () => _load(), icon: const Icon(Icons.refresh))
        ],
      ),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error!, textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    TextButton(
                        onPressed: () => _load(), child: const Text('Retry')),
                  ],
                ),
              ),
            )
          : _loading && _items.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  padding: const EdgeInsets.all(14),
                  itemCount: _items.length + (_nextPage == null ? 0 : 1),
                  itemBuilder: (_, index) {
                    if (index == _items.length) {
                      return Center(
                        child: TextButton(
                          onPressed: _loading ? null : () => _load(more: true),
                          child: const Text('Load more reels'),
                        ),
                      );
                    }
                    final reel = _items[index];
                    final thumbnail = reel['thumbnail']?.toString() ?? '';
                    return Card(
                      clipBehavior: Clip.antiAlias,
                      margin: const EdgeInsets.only(bottom: 12),
                      child: InkWell(
                        onTap: () => _open(reel),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (thumbnail.isNotEmpty)
                              Image.network(
                                thumbnail,
                                width: double.infinity,
                                height: 190,
                                fit: BoxFit.cover,
                              )
                            else
                              const SizedBox(
                                height: 150,
                                child: Center(
                                    child: Icon(Icons.play_circle, size: 50)),
                              ),
                            ListTile(
                              leading: Icon(Icons.play_circle,
                                  color: AppTheme.primary),
                              title: Text(
                                reel['title']?.toString() ?? 'Music Reel',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(reel['channel']?.toString() ?? ''),
                              trailing: const Icon(Icons.open_in_new),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
