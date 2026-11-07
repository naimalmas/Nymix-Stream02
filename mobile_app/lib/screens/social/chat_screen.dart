import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/services/audio_call_service.dart';
import 'package:record/record.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.friend,
    this.callService,
  });

  final Map<String, dynamic> friend;
  final AudioCallService? callService;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _api = ApiService();
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _recorder = AudioRecorder();
  final _voicePlayer = AudioPlayer();
  final _picker = ImagePicker();
  late final AudioCallService _call;
  late final bool _ownsCallService;
  final List<Map<String, dynamic>> _messages = [];

  Timer? _timer;
  Timer? _recordTimer;
  StreamSubscription<PlayerState>? _audioStateSubscription;
  int _after = 0;
  int _recordingSeconds = 0;
  bool _sending = false;
  bool _recording = false;
  bool _uploadingVoice = false;
  bool _sharingPhoto = false;
  String? _error;
  String? _recordPath;
  String? _playingVoiceId;
  DateTime? _recordStartedAt;

  String get _friendId => widget.friend['id'].toString();
  String get _friendName => widget.friend['name']?.toString() ?? 'Friend';

  @override
  void initState() {
    super.initState();
    _ownsCallService = widget.callService == null;
    _call = widget.callService ?? AudioCallService(_api, _onCallChanged);
    if (!_ownsCallService) _call.addListener(_onCallChanged);
    _audioStateSubscription = _voicePlayer.playerStateStream.listen((_) {
      if (mounted) setState(() {});
    });
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      _refresh();
      if (_ownsCallService) _pollCallSignals();
    });
  }

  void _onCallChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _refresh() async {
    try {
      final result = await _api.messages(_friendId, after: _after);
      if (!mounted) return;
      if (result.isNotEmpty) {
        setState(() {
          _messages.addAll(result);
          _after = result.fold<int>(
            _after,
            (latest, message) => (message['ts'] as num?)?.toInt() != null
                ? ((message['ts'] as num).toInt() > latest
                    ? (message['ts'] as num).toInt()
                    : latest)
                : latest,
          );
          _error = null;
        });
        _scrollToBottom();
      } else if (_error != null) {
        setState(() => _error = null);
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _pollCallSignals() async {
    try {
      final signals = await _api.callSignals();
      if (mounted) {
        await _call.handleSignals(signals, activeFriendId: _friendId);
      }
    } on ApiException catch (error) {
      if (mounted && _call.busy) _notice(error.message);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _appendMessage(Map<String, dynamic> message) {
    setState(() {
      _messages.add(message);
      _after = (message['ts'] as num?)?.toInt() ?? _after;
      _error = null;
    });
    _scrollToBottom();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final sent = await _api.sendMessage(_friendId, text);
      if (!mounted) return;
      _controller.clear();
      _appendMessage(sent);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _toggleRecording() async {
    if (_recording) {
      await _stopRecording();
      return;
    }
    if (_uploadingVoice) return;
    try {
      if (!await _recorder.hasPermission()) {
        _notice('Microphone permission is required to record a voice message.');
        return;
      }
      final path =
          '${Directory.systemTemp.path}${Platform.pathSeparator}nymix_voice_${DateTime.now().microsecondsSinceEpoch}.wav';
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.wav,
          sampleRate: 8000,
          numChannels: 1,
        ),
        path: path,
      );
      _recordPath = path;
      _recordStartedAt = DateTime.now();
      setState(() {
        _recording = true;
        _recordingSeconds = 0;
      });
      _recordTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || !_recording || _recordStartedAt == null) return;
        final elapsed = DateTime.now().difference(_recordStartedAt!).inSeconds;
        setState(() => _recordingSeconds = elapsed);
        if (elapsed >= 60) unawaited(_stopRecording());
      });
    } on Exception catch (error) {
      _notice('Could not start recording: $error');
    }
  }

  Future<void> _stopRecording() async {
    if (!_recording) return;
    _recordTimer?.cancel();
    final duration = DateTime.now()
            .difference(_recordStartedAt ?? DateTime.now())
            .inMilliseconds /
        1000;
    final path = _recordPath;
    setState(() => _recording = false);
    try {
      final stoppedPath = await _recorder.stop();
      final filePath = stoppedPath ?? path;
      if (filePath == null) {
        throw const ApiException('The recording could not be saved.');
      }
      final file = File(filePath);
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty || bytes.length > 1024 * 1024) {
        throw const ApiException('Voice messages must be 1 MB or smaller.');
      }
      setState(() => _uploadingVoice = true);
      final message = await _api.sendVoiceMessage(
        _friendId,
        audioData: base64Encode(bytes),
        mimeType: 'audio/wav',
        duration: duration.clamp(0.1, 60).toDouble(),
      );
      if (mounted) _appendMessage(message);
    } on ApiException catch (error) {
      _notice(error.message);
    } on FileSystemException catch (error) {
      _notice('Could not read the voice recording: ${error.message}');
    } finally {
      if (path != null) {
        final file = File(path);
        if (await file.exists()) await file.delete();
      }
      _recordPath = null;
      _recordStartedAt = null;
      if (mounted) setState(() => _uploadingVoice = false);
    }
  }

  Future<void> _sharePhoto() async {
    if (_sharingPhoto) return;
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 800,
      imageQuality: 30,
    );
    if (image == null || !mounted) return;
    setState(() => _sharingPhoto = true);
    try {
      final bytes = await image.readAsBytes();
      if (bytes.isEmpty || bytes.length > 64 * 1024) {
        throw const ApiException('Chat photos must be 64 KB or smaller.');
      }
      final extension = image.name.toLowerCase().split('.').last;
      final mime = extension == 'png'
          ? 'png'
          : extension == 'webp'
              ? 'webp'
              : 'jpeg';
      final photo = await _api.createPhotoPost(
        'data:image/$mime;base64,${base64Encode(bytes)}',
        '',
      );
      final photoId = photo['id']?.toString();
      if (photoId == null || photoId.isEmpty) {
        throw const ApiException('The uploaded photo has no ID.');
      }
      final message = await _api.sendPhotoMessage(_friendId, photoId);
      if (mounted) _appendMessage(message);
    } on ApiException catch (error) {
      _notice(error.message);
    } on FileSystemException catch (error) {
      _notice('Could not read the selected photo: ${error.message}');
    } finally {
      if (mounted) setState(() => _sharingPhoto = false);
    }
  }

  Future<void> _playVoiceMessage(Map<String, dynamic> message) async {
    final id = message['id']?.toString() ?? '';
    if (id.isEmpty) return;
    try {
      if (_playingVoiceId == id && _voicePlayer.playing) {
        await _voicePlayer.pause();
        return;
      }
      await _voicePlayer.setUrl(
        _api.voiceMessageUrl(_friendId, id),
        headers: {
          if (_api.token != null) 'Authorization': 'Bearer ${_api.token}',
        },
      );
      setState(() => _playingVoiceId = id);
      unawaited(_voicePlayer.play());
    } on Exception catch (error) {
      _notice('Could not play this voice message: $error');
    }
  }

  Future<void> _react(Map<String, dynamic> message) async {
    final reaction = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Wrap(
            alignment: WrapAlignment.spaceEvenly,
            children: const [
              _ReactionChoice(value: 'heart', emoji: '❤️'),
              _ReactionChoice(value: 'laugh', emoji: '😂'),
              _ReactionChoice(value: 'thumb-up', emoji: '👍'),
              _ReactionChoice(value: 'surprised', emoji: '😮'),
              _ReactionChoice(value: 'sad', emoji: '😢'),
            ],
          ),
        ),
      ),
    );
    if (reaction == null) return;
    try {
      final result = await _api.reactToMessage(
        _friendId,
        message['id'].toString(),
        reaction,
      );
      if (!mounted) return;
      final index = _messages.indexWhere((item) => item['id'] == message['id']);
      if (index >= 0) {
        setState(() => _messages[index] = {
              ..._messages[index],
              'reactions': result['reactions'],
            });
      }
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _startCall() async {
    try {
      await _call.start(_friendId);
    } on Exception catch (error) {
      if (mounted) _notice('Could not start the audio call: $error');
    }
  }

  Future<void> _acceptCall() async {
    try {
      await _call.accept();
    } on Exception catch (error) {
      if (mounted) _notice('Could not join the audio call: $error');
    }
  }

  Future<void> _endCall() async {
    try {
      await _call.end(notifyFriend: true);
    } on ApiException catch (error) {
      if (mounted) _notice(error.message);
    }
  }

  Widget _callPanel() {
    final statusText = switch (_call.status) {
      AudioCallStatus.outgoing => 'Calling $_friendName…',
      AudioCallStatus.incoming => 'Incoming audio call from $_friendName',
      AudioCallStatus.connecting => 'Connecting audio call…',
      AudioCallStatus.active => 'Audio call with $_friendName',
      AudioCallStatus.idle => '',
    };
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceRaised,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(
            _call.status == AudioCallStatus.incoming
                ? Icons.call_received_rounded
                : Icons.call_rounded,
            color: AppTheme.accent,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(statusText,
                maxLines: 2,
                style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
          if (_call.status == AudioCallStatus.incoming) ...[
            IconButton.filled(
              tooltip: 'Accept call',
              onPressed: _acceptCall,
              icon: const Icon(Icons.call_rounded),
              style: IconButton.styleFrom(backgroundColor: Colors.green),
            ),
            IconButton.filled(
              tooltip: 'Decline call',
              onPressed: _endCall,
              icon: const Icon(Icons.call_end_rounded),
              style: IconButton.styleFrom(backgroundColor: AppTheme.red),
            ),
          ] else ...[
            if (_call.status == AudioCallStatus.active)
              IconButton(
                tooltip: _call.muted ? 'Unmute microphone' : 'Mute microphone',
                onPressed: _call.toggleMute,
                icon: Icon(_call.muted ? Icons.mic_off_rounded : Icons.mic),
              ),
            IconButton.filled(
              tooltip: 'End call',
              onPressed: _endCall,
              icon: const Icon(Icons.call_end_rounded),
              style: IconButton.styleFrom(backgroundColor: AppTheme.red),
            ),
          ],
        ],
      ),
    );
  }

  Widget _messageBody(Map<String, dynamic> message) {
    final type = message['type']?.toString() ?? 'text';
    if (type == 'audio') {
      final id = message['id']?.toString() ?? '';
      final isPlaying =
          _playingVoiceId == id && _voicePlayer.playerState.playing;
      final duration = ((message['duration'] as num?)?.round() ?? 0);
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: () => _playVoiceMessage(message),
            icon: Icon(
                isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded),
          ),
          Text('Voice message · ${duration}s'),
        ],
      );
    }
    if (type == 'photo') {
      final photo = message['photo'] as Map<String, dynamic>?;
      final image = photo?['image']?.toString() ?? '';
      if (image.startsWith('data:image/')) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.memory(
            base64Decode(image.substring(image.indexOf(',') + 1)),
            width: 220,
            height: 190,
            fit: BoxFit.cover,
          ),
        );
      }
      if (image.isNotEmpty) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.network(
            image,
            width: 220,
            height: 190,
            fit: BoxFit.cover,
          ),
        );
      }
      return const Text('Photo is no longer available');
    }
    return Text(message['text']?.toString() ?? '');
  }

  Widget _messageTile(Map<String, dynamic> message) {
    final mine = message['from'] == _api.currentUser?.id;
    final reactions = message['reactions'] as Map? ?? {};
    final reactionCount = reactions.values
        .whereType<List>()
        .fold<int>(0, (total, users) => total + users.length);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _react(message),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 310),
          margin: const EdgeInsets.symmetric(vertical: 5),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: mine ? AppTheme.primary : AppTheme.surface,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(18),
              topRight: const Radius.circular(18),
              bottomLeft: Radius.circular(mine ? 18 : 5),
              bottomRight: Radius.circular(mine ? 5 : 18),
            ),
          ),
          child: Column(
            crossAxisAlignment:
                mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              _messageBody(message),
              if (reactionCount > 0) ...[
                const SizedBox(height: 4),
                Text('❤️  $reactionCount',
                    style: const TextStyle(fontSize: 11)),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _notice(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _deleteRecording(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _recordTimer?.cancel();
    _audioStateSubscription?.cancel();
    if (_recording) unawaited(_recorder.cancel());
    if (_recordPath != null) {
      unawaited(_deleteRecording(_recordPath!));
    }
    unawaited(_recorder.dispose());
    unawaited(_voicePlayer.dispose());
    if (_ownsCallService) {
      unawaited(_call.dispose());
    } else {
      _call.removeListener(_onCallChanged);
    }
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            CircleAvatar(
              radius: 19,
              backgroundColor: AppTheme.primary,
              child: Text(
                _friendName.isEmpty
                    ? 'F'
                    : _friendName.characters.first.toUpperCase(),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(_friendName,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Start audio call',
            onPressed: _call.busy ? null : _startCall,
            icon: const Icon(Icons.call_rounded),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(
        children: [
          if (_call.busy &&
              (_ownsCallService || _call.status != AudioCallStatus.incoming))
            _callPanel(),
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(onPressed: _refresh, child: const Text('Retry')),
              ],
            ),
          Expanded(
            child: _messages.isEmpty && _error == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.chat_bubble_outline_rounded,
                              size: 42, color: AppTheme.accent),
                          const SizedBox(height: 12),
                          Text(
                            'Start a conversation with $_friendName',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.muted),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
                    itemCount: _messages.length,
                    itemBuilder: (_, index) => _messageTile(_messages[index]),
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    tooltip: 'Share a photo',
                    onPressed: _sharingPhoto ? null : _sharePhoto,
                    icon: _sharingPhoto
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.add_photo_alternate_outlined),
                  ),
                  IconButton(
                    tooltip:
                        _recording ? 'Stop recording' : 'Record voice message',
                    onPressed: _toggleRecording,
                    color: _recording ? AppTheme.red : null,
                    icon: Icon(_recording
                        ? Icons.stop_circle_outlined
                        : Icons.mic_none_rounded),
                  ),
                  Expanded(
                    child: _recording
                        ? Container(
                            height: 54,
                            alignment: Alignment.centerLeft,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceRaised,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Text(
                              'Recording… ${_recordingSeconds}s / 60s',
                              style: const TextStyle(color: AppTheme.red),
                            ),
                          )
                        : TextField(
                            controller: _controller,
                            onChanged: (_) => setState(() {}),
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _send(),
                            maxLength: 1000,
                            decoration: InputDecoration(
                              hintText: _uploadingVoice
                                  ? 'Sending voice message…'
                                  : 'Write a message',
                              counterText: '',
                              suffixIcon: _controller.text.isEmpty
                                  ? null
                                  : IconButton(
                                      onPressed: _controller.clear,
                                      icon: const Icon(Icons.close),
                                    ),
                            ),
                          ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    onPressed: _sending || _recording || _uploadingVoice
                        ? null
                        : _send,
                    icon: _sending
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
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

class _ReactionChoice extends StatelessWidget {
  const _ReactionChoice({required this.value, required this.emoji});

  final String value;
  final String emoji;

  @override
  Widget build(BuildContext context) => IconButton(
        onPressed: () => Navigator.pop(context, value),
        icon: Text(emoji, style: const TextStyle(fontSize: 26)),
      );
}
