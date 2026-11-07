import 'dart:async';
import 'dart:math';

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:nymix_mobile/services/api_service.dart';

enum AudioCallStatus { idle, outgoing, incoming, connecting, active }

class AudioCallService {
  AudioCallService(this._api, this._onChanged);

  final ApiService _api;
  final void Function() _onChanged;
  final Set<void Function()> _listeners = {};
  final Set<String> _seenSignals = {};
  final List<Map<String, dynamic>> _pendingCandidates = [];
  final List<Map<String, dynamic>> _outgoingCandidates = [];

  RTCPeerConnection? _peer;
  MediaStream? _localStream;
  RTCSessionDescription? _offer;
  Timer? _timeout;
  bool _signalReady = false;
  bool _muted = false;

  AudioCallStatus status = AudioCallStatus.idle;
  String? friendId;
  String? sessionId;

  bool get muted => _muted;
  bool get busy => status != AudioCallStatus.idle;

  void addListener(void Function() listener) => _listeners.add(listener);

  void removeListener(void Function() listener) => _listeners.remove(listener);

  Future<void> start(String id) async {
    if (busy) return;
    friendId = id;
    sessionId = _newSessionId();
    status = AudioCallStatus.outgoing;
    _notify();
    _timeout = Timer(const Duration(seconds: 60), () {
      if (status == AudioCallStatus.outgoing) {
        unawaited(end(notifyFriend: true));
      }
    });
    try {
      await _openPeer();
      final offer = await _peer!.createOffer();
      await _peer!.setLocalDescription(offer);
      await _send('offer', description: offer.toMap());
      _signalReady = true;
      await _flushCandidates();
    } catch (error) {
      await end(notifyFriend: false);
      rethrow;
    }
  }

  Future<void> accept() async {
    if (status != AudioCallStatus.incoming || _offer == null) return;
    status = AudioCallStatus.connecting;
    _notify();
    try {
      await _openPeer();
      await _peer!.setRemoteDescription(_offer!);
      await _applyPendingCandidates();
      final answer = await _peer!.createAnswer();
      await _peer!.setLocalDescription(answer);
      await _send('answer', description: answer.toMap());
      _signalReady = true;
      await _flushCandidates();
    } catch (error) {
      await end(notifyFriend: true);
      rethrow;
    }
  }

  Future<void> handleSignals(
    List<Map<String, dynamic>> signals, {
    String? activeFriendId,
  }) async {
    for (final signal in signals) {
      final signalKey = signal['id']?.toString() ?? '';
      if (signalKey.isEmpty || !_seenSignals.add(signalKey)) continue;
      if (_seenSignals.length > 500) _seenSignals.clear();

      final senderId = signal['from']?.toString();
      final type = signal['type']?.toString();
      final incomingSessionId = signal['sessionId']?.toString();
      if (senderId == null ||
          (activeFriendId != null && senderId != activeFriendId) ||
          incomingSessionId == null) {
        continue;
      }

      if (type == 'offer') {
        final timestamp = (signal['ts'] as num?)?.toInt() ?? 0;
        if (DateTime.now().millisecondsSinceEpoch - timestamp > 90000) {
          await _sendFor(
            senderId,
            incomingSessionId,
            'reject',
          );
          continue;
        }
        if (busy) {
          if (sessionId != incomingSessionId) {
            await _sendFor(senderId, incomingSessionId, 'reject');
          }
          continue;
        }
        final description = signal['description'] as Map<String, dynamic>?;
        if (description == null) continue;
        friendId = senderId;
        sessionId = incomingSessionId;
        _offer = RTCSessionDescription(
          description['sdp']?.toString(),
          description['type']?.toString(),
        );
        status = AudioCallStatus.incoming;
        _notify();
        _timeout = Timer(const Duration(seconds: 60), () {
          if (status == AudioCallStatus.incoming) {
            unawaited(end(notifyFriend: true));
          }
        });
        continue;
      }

      if (senderId != friendId || incomingSessionId != sessionId) continue;
      if (type == 'answer' &&
          _peer != null &&
          status == AudioCallStatus.outgoing) {
        final description = signal['description'] as Map<String, dynamic>?;
        if (description == null) continue;
        await _peer!.setRemoteDescription(
          RTCSessionDescription(
            description['sdp']?.toString(),
            description['type']?.toString(),
          ),
        );
        await _applyPendingCandidates();
        status = AudioCallStatus.connecting;
        _notify();
      } else if (type == 'ice') {
        final candidate = signal['candidate'] as Map<String, dynamic>?;
        if (candidate == null) continue;
        final remoteDescription = await _peer?.getRemoteDescription();
        if (remoteDescription != null) {
          await _addCandidate(candidate);
        } else {
          _pendingCandidates.add(candidate);
        }
      } else if (type == 'reject' || type == 'end') {
        await _cleanup();
      }
    }
  }

  Future<void> toggleMute() async {
    _muted = !_muted;
    for (final track
        in _localStream?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      track.enabled = !_muted;
    }
    _notify();
  }

  Future<void> end({required bool notifyFriend}) async {
    final oldFriendId = friendId;
    final oldSessionId = sessionId;
    final outgoingType = status == AudioCallStatus.incoming ? 'reject' : 'end';
    await _cleanup();
    if (notifyFriend && oldFriendId != null && oldSessionId != null) {
      await _sendFor(oldFriendId, oldSessionId, outgoingType);
    }
  }

  Future<void> _openPeer() async {
    final config = await _api.callConfig();
    final iceServers = config['iceServers'];
    if (iceServers is! List) {
      throw const ApiException('The server returned invalid call settings.');
    }
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': false,
    });
    _peer = await createPeerConnection({'iceServers': iceServers});
    for (final track in _localStream!.getTracks()) {
      await _peer!.addTrack(track, _localStream!);
    }
    final peer = _peer!;
    peer.onIceCandidate = (candidate) {
      final data = candidate.toMap();
      if (data is! Map) return;
      final mapped = Map<String, dynamic>.from(data);
      if (!_signalReady) {
        _outgoingCandidates.add(mapped);
      } else {
        unawaited(_send('ice', candidate: mapped));
      }
    };
    peer.onTrack = (_) {};
    peer.onConnectionState = (connectionState) {
      if (_peer != peer) return;
      if (connectionState ==
          RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _timeout?.cancel();
        unawaited(Helper.setSpeakerphoneOn(true));
        status = AudioCallStatus.active;
        _notify();
      } else if (connectionState ==
          RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        unawaited(_cleanup());
      }
    };
  }

  Future<void> _flushCandidates() async {
    final pending = List<Map<String, dynamic>>.from(_outgoingCandidates);
    _outgoingCandidates.clear();
    for (final candidate in pending) {
      await _send('ice', candidate: candidate);
    }
  }

  Future<void> _applyPendingCandidates() async {
    final pending = List<Map<String, dynamic>>.from(_pendingCandidates);
    _pendingCandidates.clear();
    for (final candidate in pending) {
      await _addCandidate(candidate);
    }
  }

  Future<void> _addCandidate(Map<String, dynamic> candidate) async {
    final index = candidate['sdpMLineIndex'];
    await _peer?.addCandidate(
      RTCIceCandidate(
        candidate['candidate']?.toString(),
        candidate['sdpMid']?.toString(),
        index is num ? index.toInt() : null,
      ),
    );
  }

  Future<void> _send(
    String type, {
    Map<String, dynamic>? description,
    Map<String, dynamic>? candidate,
  }) async {
    final currentFriendId = friendId;
    final currentSessionId = sessionId;
    if (currentFriendId == null || currentSessionId == null) {
      throw const ApiException('There is no active call.');
    }
    await _sendFor(
      currentFriendId,
      currentSessionId,
      type,
      description: description,
      candidate: candidate,
    );
  }

  Future<void> _sendFor(
    String toFriendId,
    String callSessionId,
    String type, {
    Map<String, dynamic>? description,
    Map<String, dynamic>? candidate,
  }) =>
      _api.sendCallSignal(
        toFriendId,
        type: type,
        sessionId: callSessionId,
        description: description,
        candidate: candidate,
      );

  Future<void> _cleanup() async {
    _timeout?.cancel();
    _timeout = null;
    final peer = _peer;
    _peer = null;
    await peer?.close();
    final stream = _localStream;
    _localStream = null;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        await track.stop();
      }
      await stream.dispose();
    }
    status = AudioCallStatus.idle;
    friendId = null;
    sessionId = null;
    _offer = null;
    _signalReady = false;
    _muted = false;
    _pendingCandidates.clear();
    _outgoingCandidates.clear();
    _notify();
  }

  void _notify() {
    _onChanged();
    for (final listener in _listeners.toList()) {
      listener();
    }
  }

  String _newSessionId() {
    final random = Random.secure();
    return List.generate(32, (_) => random.nextInt(16).toRadixString(16))
        .join();
  }

  Future<void> dispose() async {
    await end(notifyFriend: status == AudioCallStatus.active);
  }
}
