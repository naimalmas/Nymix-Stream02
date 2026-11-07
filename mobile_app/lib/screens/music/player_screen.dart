import 'dart:math';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:youtube_player_iframe/youtube_player_iframe.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.song, this.queue = const []});

  final Song song;
  final List<Song> queue;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  late final YoutubePlayerController _player;
  late final StreamSubscription<YoutubePlayerValue> _playerSubscription;
  late final List<Song> _queue;
  int _queueIndex = 0;
  bool _endHandled = false;
  bool _isLiked = false;
  bool _isLoadingLike = false;
  bool _shuffle = false;
  bool _repeat = false;
  String? _error;

  Song get _song => _queue[_queueIndex];

  @override
  void initState() {
    super.initState();
    _queue = widget.queue.isEmpty ? [widget.song] : List.of(widget.queue);
    final songIndex = _queue.indexWhere((song) => song.id == widget.song.id);
    if (songIndex >= 0) _queueIndex = songIndex;
    _player = YoutubePlayerController.fromVideoId(
      videoId: _song.id,
      autoPlay: true,
      params: const YoutubePlayerParams(
        showControls: true,
        showFullscreenButton: true,
        strictRelatedVideos: true,
        enableCaption: false,
        interfaceLanguage: 'en',
        playsInline: true,
      ),
    );
    _playerSubscription = _player.stream.listen(_handlePlayerValue);
    _startPlaybackSession();
    _loadLikeStatus();
  }

  void _handlePlayerValue(YoutubePlayerValue value) {
    if (value.playerState == PlayerState.ended && !_endHandled) {
      _endHandled = true;
      unawaited(_next());
    } else if (value.playerState != PlayerState.ended) {
      _endHandled = false;
    }
  }

  Future<void> _startPlaybackSession() async {
    try {
      await ApiService().recordPlay(_song);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _loadLikeStatus() async {
    try {
      final liked = await ApiService().likedSongs();
      if (mounted) {
        setState(() => _isLiked = liked.any((song) => song.id == _song.id));
      }
    } on ApiException {
      // Liking remains available if this optional initial lookup fails.
    }
  }

  Future<void> _toggleLike() async {
    setState(() => _isLoadingLike = true);
    try {
      final liked = await ApiService().toggleLiked(_song);
      if (mounted) setState(() => _isLiked = liked);
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoadingLike = false);
    }
  }

  Future<void> _playQueueIndex(int index) async {
    if (index < 0 || index >= _queue.length) return;
    setState(() {
      _queueIndex = index;
      _isLiked = false;
      _error = null;
    });
    await _player.loadVideoById(videoId: _song.id);
    await _startPlaybackSession();
    await _loadLikeStatus();
  }

  Future<void> _next() async {
    if (_queue.length < 2) {
      if (_repeat) await _playQueueIndex(0);
      return;
    }
    if (_shuffle) {
      var index = _queueIndex;
      while (index == _queueIndex) {
        index = Random().nextInt(_queue.length);
      }
      await _playQueueIndex(index);
      return;
    }
    if (_queueIndex + 1 < _queue.length) {
      await _playQueueIndex(_queueIndex + 1);
    } else if (_repeat) {
      await _playQueueIndex(0);
    }
  }

  Future<void> _previous() async {
    if (_queueIndex > 0) {
      await _playQueueIndex(_queueIndex - 1);
    } else {
      await _player.seekTo(seconds: 0);
    }
  }

  @override
  void dispose() {
    _playerSubscription.cancel();
    _player.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return YoutubePlayerScaffold(
      controller: _player,
      autoFullScreen: true,
      builder: (context, player) => Scaffold(
        appBar: AppBar(
          title: const Text('Now playing'),
          actions: [
            IconButton(
              tooltip:
                  _isLiked ? 'Remove from liked songs' : 'Add to liked songs',
              onPressed: _isLoadingLike ? null : _toggleLike,
              icon: Icon(_isLiked ? Icons.favorite : Icons.favorite_border),
              color: _isLiked ? AppTheme.red : null,
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(22),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: player,
                ),
              ),
              const SizedBox(height: 22),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _song.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 24,
                            height: 1.15,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.4,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _song.artist,
                          style: TextStyle(color: AppTheme.muted, fontSize: 15),
                        ),
                      ],
                    ),
                  ),
                  IconButton.filledTonal(
                    onPressed: _isLoadingLike ? null : _toggleLike,
                    icon: Icon(
                      _isLiked ? Icons.favorite : Icons.favorite_border,
                      color: _isLiked ? AppTheme.red : null,
                    ),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(
                  'Play history could not be updated: $_error',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
              ],
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(18),
                  border:
                      Border.all(color: Colors.white.withValues(alpha: .06)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline_rounded,
                        color: AppTheme.accent),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Playing inside Nymix with the official YouTube player.',
                        style: TextStyle(color: AppTheme.muted, fontSize: 13),
                      ),
                    ),
                    if (_queue.length > 1) ...[
                      const SizedBox(height: 22),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Up next · ${_queue.length - _queueIndex - 1} songs',
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: _shuffle ? 'Turn shuffle off' : 'Shuffle',
                            onPressed: () =>
                                setState(() => _shuffle = !_shuffle),
                            color: _shuffle ? AppTheme.accent : AppTheme.muted,
                            icon: const Icon(Icons.shuffle_rounded),
                          ),
                          IconButton(
                            tooltip: _repeat ? 'Repeat is on' : 'Repeat queue',
                            onPressed: () => setState(() => _repeat = !_repeat),
                            color: _repeat ? AppTheme.accent : AppTheme.muted,
                            icon: const Icon(Icons.repeat_rounded),
                          ),
                        ],
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          IconButton(
                            tooltip: 'Previous song',
                            onPressed: _previous,
                            icon: const Icon(Icons.skip_previous_rounded,
                                size: 34),
                          ),
                          YoutubeValueBuilder(
                            controller: _player,
                            builder: (context, value) => IconButton.filled(
                              tooltip: value.playerState == PlayerState.playing
                                  ? 'Pause'
                                  : 'Play',
                              onPressed:
                                  value.playerState == PlayerState.unknown
                                      ? null
                                      : () {
                                          if (value.playerState ==
                                              PlayerState.playing) {
                                            _player.pauseVideo();
                                          } else {
                                            _player.playVideo();
                                          }
                                        },
                              icon: Icon(
                                value.playerState == PlayerState.playing
                                    ? Icons.pause_rounded
                                    : Icons.play_arrow_rounded,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Next song',
                            onPressed: _next,
                            icon: const Icon(Icons.skip_next_rounded, size: 34),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      ..._queue.skip(_queueIndex + 1).take(6).map((song) {
                        final index = _queue.indexOf(song);
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: ClipRRect(
                            borderRadius: BorderRadius.circular(9),
                            child: Image.network(
                              song.thumbnail,
                              width: 42,
                              height: 42,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                width: 42,
                                height: 42,
                                color: AppTheme.surfaceRaised,
                                child: const Icon(Icons.music_note_rounded),
                              ),
                            ),
                          ),
                          title: Text(song.title,
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text(song.artist,
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          onTap: () => _playQueueIndex(index),
                        );
                      }),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
