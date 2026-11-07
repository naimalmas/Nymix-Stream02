import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/screens/music/player_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/widgets/song_tile.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, this.initialQuery = ''});

  final String initialQuery;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  List<Song> _songs = [];
  bool _isLoading = false;
  String? _error;
  Timer? _debounce;

  static const _radioQueries = <String, String>{
    'Chill': 'chill lo-fi music',
    'Top hits': 'top music hits',
    'Workout': 'workout music',
    'Late night': 'late night music',
    'Bangla': 'bangla song',
    'Acoustic': 'acoustic songs',
  };

  @override
  void initState() {
    super.initState();
    _controller.text = widget.initialQuery;
    if (widget.initialQuery.isNotEmpty) {
      _search(widget.initialQuery);
    }
  }

  Future<void> _search(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() {
        _songs = [];
        _error = null;
        _isLoading = false;
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final songs = await ApiService().searchSongs(trimmed);
      if (!mounted || _controller.text.trim() != trimmed) return;
      setState(() => _songs = songs);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted && _controller.text.trim() == trimmed) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _onQueryChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 400),
      () => _search(query),
    );
  }

  Future<void> _play(Song song) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PlayerScreen(song: song, queue: _songs),
      ),
    );
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search & Radio')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _controller,
              textInputAction: TextInputAction.search,
              onChanged: _onQueryChanged,
              onSubmitted: _search,
              decoration: InputDecoration(
                hintText: 'Search songs or artists',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  onPressed: () => _search(_controller.text),
                  icon: const Icon(Icons.arrow_forward),
                ),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Radio stations',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 42,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: _radioQueries.entries.map((station) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ActionChip(
                      avatar: const Icon(Icons.radio, size: 17),
                      label: Text(station.key),
                      onPressed: () {
                        _controller.text = station.value;
                        _search(station.value);
                      },
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.muted),
                          ),
                        )
                      : _songs.isEmpty
                          ? Center(
                              child: Text(
                                'Search for a song or artist to get started',
                                style: TextStyle(color: AppTheme.muted),
                              ),
                            )
                          : ListView.separated(
                              itemCount: _songs.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 6),
                              itemBuilder: (context, index) {
                                final song = _songs[index];
                                return SongTile(
                                  song: song,
                                  onTap: () => _play(song),
                                );
                              },
                            ),
            ),
          ],
        ),
      ),
    );
  }
}
