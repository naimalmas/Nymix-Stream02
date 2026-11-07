import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:youtube_player_iframe/youtube_player_iframe.dart';

class ListenRoomScreen extends StatefulWidget {
  const ListenRoomScreen({super.key, required this.room});

  final Map<String, dynamic> room;

  @override
  State<ListenRoomScreen> createState() => _ListenRoomScreenState();
}

class _ListenRoomScreenState extends State<ListenRoomScreen> {
  final _api = ApiService();
  final _messageController = TextEditingController();
  late Map<String, dynamic> _room = widget.room;
  Timer? _timer;
  bool _sending = false;
  String? _error;
  YoutubePlayerController? _player;
  String? _loadedVideoId;

  String get _code => _room['code'].toString();

  @override
  void initState() {
    super.initState();
    _syncPlayer();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) => _refresh());
  }

  Future<void> _refresh() async {
    try {
      final room = await _api.listenRoom(_code);
      if (mounted) {
        setState(() => _room = room);
        _syncPlayer();
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _togglePlayback() async {
    final playing = _room['playing'] == true;
    try {
      await _api.updateListenRoom(_code, playing ? 'pause' : 'play');
      await _refresh();
      if (playing) {
        await _player?.pauseVideo();
      } else {
        await _player?.playVideo();
      }
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  void _syncPlayer() {
    final song = _room['song'] as Map<String, dynamic>?;
    final videoId = song?['id']?.toString();
    if (videoId == null || videoId.isEmpty || videoId == _loadedVideoId) return;
    _loadedVideoId = videoId;
    final oldPlayer = _player;
    _player = YoutubePlayerController.fromVideoId(
      videoId: videoId,
      autoPlay: _room['playing'] == true,
      params: const YoutubePlayerParams(
        showControls: true,
        showFullscreenButton: true,
        strictRelatedVideos: true,
        enableCaption: false,
        interfaceLanguage: 'en',
        playsInline: true,
      ),
    );
    oldPlayer?.close();
  }

  Future<void> _selectSong() async {
    try {
      final songs = await _api.featuredSongs();
      if (!mounted) return;
      final song = await showModalBottomSheet<Song>(
        context: context,
        builder: (context) => SafeArea(
          child: ListView(
            children: [
              const ListTile(title: Text('Choose a song')),
              ...songs.map(
                (item) => ListTile(
                  title: Text(item.title),
                  subtitle: Text(item.artist),
                  onTap: () => Navigator.pop(context, item),
                ),
              ),
            ],
          ),
        ),
      );
      if (song == null) return;
      await _api.updateListenRoom(_code, 'song', song: song);
      await _refresh();
      _syncPlayer();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _api.sendRoomMessage(_code, text);
      _messageController.clear();
      await _refresh();
    } on ApiException catch (error) {
      _notice(error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _leave() async {
    try {
      await _api.leaveListenRoom(_code);
      if (mounted) Navigator.pop(context);
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  void _notice(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _player?.close();
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final song = _room['song'] as Map<String, dynamic>? ?? {};
    final messages = (_room['messages'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    final members = (_room['members'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Listening room'),
        actions: [
          IconButton(
            tooltip: 'Copy room code',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: _code));
              _notice('Room code copied: $_code');
            },
            icon: const Icon(Icons.copy),
          ),
          IconButton(onPressed: _leave, icon: const Icon(Icons.exit_to_app)),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(onPressed: _refresh, child: const Text('Retry')),
              ],
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      'Room code: $_code',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${members.length} listening · ${members.map((m) => m['name']).join(', ')}',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppTheme.muted),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      song['title']?.toString() ?? 'No song selected',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800),
                    ),
                    Text(song['artist']?.toString() ?? ''),
                    const SizedBox(height: 14),
                    if (_player != null)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(14),
                        child: AspectRatio(
                          aspectRatio: 16 / 9,
                          child: YoutubePlayer(controller: _player!),
                        ),
                      ),
                    const SizedBox(height: 14),
                    Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 10,
                      children: [
                        FilledButton.icon(
                          onPressed: _togglePlayback,
                          icon: Icon(_room['playing'] == true
                              ? Icons.pause
                              : Icons.play_arrow),
                          label:
                              Text(_room['playing'] == true ? 'Pause' : 'Play'),
                        ),
                        OutlinedButton.icon(
                          onPressed: _selectSong,
                          icon: const Icon(Icons.queue_music),
                          label: const Text('Change song'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: messages.isEmpty
                ? Center(
                    child: Text(
                      'Start the room conversation',
                      style: TextStyle(color: AppTheme.muted),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    children: messages
                        .map(
                          (message) => ListTile(
                            title: Text(message['fromName'] ?? 'Member'),
                            subtitle: Text(message['text'] ?? ''),
                            dense: true,
                          ),
                        )
                        .toList(),
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      maxLength: 500,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendMessage(),
                      decoration: const InputDecoration(
                        hintText: 'Message the room',
                        counterText: '',
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _sending ? null : _sendMessage,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
