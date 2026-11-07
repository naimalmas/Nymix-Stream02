import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/screens/music/player_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/widgets/song_tile.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _api = ApiService();
  List<Song> _songs = [];
  List<Song> _liked = [];
  List<Song> _history = [];
  bool _loading = true;
  String? _error;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _tabs = TabController(
      length: 3,
      vsync: this,
      initialIndex: widget.initialTab.clamp(0, 2),
    );
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final values = await Future.wait([
        _api.featuredSongs(),
        _api.likedSongs(),
        _api.playHistory(),
      ]);
      if (!mounted) return;
      setState(() {
        _songs = values[0] as List<Song>;
        _liked = values[1] as List<Song>;
        _history = (values[2] as List<Map<String, dynamic>>)
            .map((item) => Song.fromJson({
                  'id': item['songId'],
                  'title': item['songTitle'],
                  'artist': item['songArtist'],
                  'thumb': item['thumb'],
                }))
            .toList();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openSong(Song song) async {
    final queue = _filtered(
      _tabs.index == 1
          ? _liked
          : _tabs.index == 2
              ? _history
              : _songs,
    );
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PlayerScreen(song: song, queue: queue),
      ),
    );
  }

  List<Song> _filtered(List<Song> songs) {
    if (_filter.isEmpty) return songs;
    return songs
        .where((song) =>
            song.artist.toLowerCase().contains(_filter.toLowerCase()) ||
            (song.album ?? '').toLowerCase().contains(_filter.toLowerCase()))
        .toList();
  }

  Widget _songList(List<Song> songs) {
    final visible = _filtered(songs);
    if (visible.isEmpty) {
      return Center(
        child: Text(
          songs.isEmpty ? 'No songs here yet' : 'No matches found',
          style: TextStyle(color: AppTheme.muted),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: visible.length,
        separatorBuilder: (_, __) => const SizedBox(height: 6),
        itemBuilder: (_, index) => SongTile(
          song: visible[index],
          onTap: () => _openSong(visible[index]),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: AppNavigation.openDrawer,
          icon: const Icon(Icons.menu),
        ),
        title: const Text('Your library'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
        bottom: TabBar(
          controller: _tabs,
          tabs: const [
            Tab(text: 'Songs'),
            Tab(text: 'Liked'),
            Tab(text: 'History'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      TextButton(
                          onPressed: _load, child: const Text('Try again')),
                    ],
                  ),
                )
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 2),
                      child: TextField(
                        decoration: const InputDecoration(
                          hintText: 'Filter by album or artist',
                          prefixIcon: Icon(Icons.filter_list),
                        ),
                        onChanged: (value) => setState(() => _filter = value),
                      ),
                    ),
                    Expanded(
                      child: TabBarView(
                        controller: _tabs,
                        children: [
                          _songList(_songs),
                          _songList(_liked),
                          _songList(_history),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
