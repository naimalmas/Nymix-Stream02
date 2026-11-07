import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/models/user_session.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ApiService {
  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
  );
  static final String _baseUrl = _configuredBaseUrl.isNotEmpty
      ? _configuredBaseUrl
      : defaultTargetPlatform == TargetPlatform.android
          ? 'http://10.0.2.2:3000/api'
          : 'http://localhost:3000/api';

  static final ApiService _instance = ApiService._internal();

  factory ApiService() => _instance;

  ApiService._internal();

  String? _token;
  UserSession? currentUser;

  String? get token => _token;

  Future<UserSession?> restoreSession() async {
    final preferences = await SharedPreferences.getInstance();
    _token = preferences.getString('nx_token');
    if (_token == null) return null;
    try {
      return await me();
    } on ApiException catch (error) {
      if (error.message == 'Please sign in again.') {
        await logout();
        return null;
      }
      rethrow;
    }
  }

  Future<UserSession> login({
    required String email,
    required String password,
  }) async {
    final body = await _request(
      '/auth/login',
      method: 'POST',
      authenticated: false,
      payload: {'email': email.trim(), 'password': password},
    );
    return _saveSession(body as Map<String, dynamic>);
  }

  Future<UserSession> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final body = await _request(
      '/auth/register',
      method: 'POST',
      authenticated: false,
      payload: {
        'name': name.trim(),
        'email': email.trim(),
        'password': password
      },
    );
    return _saveSession(body as Map<String, dynamic>);
  }

  Future<UserSession> _saveSession(Map<String, dynamic> body) async {
    final token = body['token'];
    if (token is! String || body['user'] is! Map<String, dynamic>) {
      throw const ApiException(
          'The server returned an invalid sign-in response.');
    }
    _token = token;
    currentUser = UserSession.fromJson(body['user'] as Map<String, dynamic>);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('nx_token', token);
    return currentUser!;
  }

  Future<UserSession> me() async {
    final body = await _request('/auth/me');
    currentUser = UserSession.fromJson(body as Map<String, dynamic>);
    return currentUser!;
  }

  Future<void> logout() async {
    _token = null;
    currentUser = null;
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('nx_token');
  }

  Future<List<Song>> featuredSongs() async {
    final body = await _request('/songs');
    return _songs(body);
  }

  Future<List<Song>> searchSongs(String query) async {
    final body = await _request(
      '/search?q=${Uri.encodeQueryComponent(query)}',
    );
    if (body is! Map<String, dynamic>) {
      throw const ApiException('The search response is invalid.');
    }
    return _songs(body['items']);
  }

  Future<void> recordPlay(Song song) async {
    await _request(
      '/play',
      method: 'POST',
      payload: {
        'songId': song.id,
        'songTitle': song.title,
        'songArtist': song.artist,
        'thumb': song.thumbnail,
      },
    );
  }

  Future<List<Song>> likedSongs() async =>
      _songs(await _request('/user/liked'));

  Future<bool> toggleLiked(Song song) async {
    final result = await _request(
      '/user/liked/${Uri.encodeComponent(song.id)}',
      method: 'POST',
      payload: song.toJson(),
    );
    return result['liked'] == true;
  }

  Future<List<Map<String, dynamic>>> playHistory() async {
    return _maps(await _request('/user/history'));
  }

  Future<Map<String, dynamic>> updateProfile({
    required String name,
    required String bio,
    String? avatar,
  }) =>
      _requestMap(
        '/user/profile',
        method: 'PUT',
        payload: {
          'name': name,
          'bio': bio,
          if (avatar != null) 'avatar': avatar,
        },
      );

  Future<List<Map<String, dynamic>>> socialOverview() async => _maps(
      await _request('/social/overview').then((value) => value['friends']));

  Future<Map<String, dynamic>> socialData() => _requestMap('/social/overview');

  Future<List<Map<String, dynamic>>> suggestions() async =>
      _maps(await _request('/users/suggestions'));

  Future<List<Map<String, dynamic>>> searchUsers(String query) async =>
      _maps(await _request(
        '/users/search?q=${Uri.encodeQueryComponent(query)}',
      ));

  Future<void> sendFriendRequest(String userId) async {
    await _request(
      '/friends/request/${Uri.encodeComponent(userId)}',
      method: 'POST',
    );
  }

  Future<void> updateFriendRequest(String requestId, String status) async {
    await _request(
      '/friends/${Uri.encodeComponent(requestId)}',
      method: 'PUT',
      payload: {'status': status},
    );
  }

  Future<void> removeFriend(String relationId) async {
    await _request('/friends/${Uri.encodeComponent(relationId)}',
        method: 'DELETE');
  }

  Future<List<Map<String, dynamic>>> messages(
    String friendId, {
    int after = 0,
  }) async =>
      _maps(await _request(
        '/chat/${Uri.encodeComponent(friendId)}?after=$after',
      ));

  Future<Map<String, dynamic>> sendMessage(
          String friendId, String text) async =>
      _requestMap(
        '/chat/${Uri.encodeComponent(friendId)}',
        method: 'POST',
        payload: {'text': text},
      );

  Future<Map<String, dynamic>> sendVoiceMessage(
    String friendId, {
    required String audioData,
    required String mimeType,
    required double duration,
  }) =>
      _requestMap(
        '/chat/${Uri.encodeComponent(friendId)}',
        method: 'POST',
        payload: {
          'type': 'audio',
          'audioData': audioData,
          'mimeType': mimeType,
          'duration': duration,
        },
      );

  String voiceMessageUrl(String friendId, String messageId) =>
      '$_baseUrl/chat/${Uri.encodeComponent(friendId)}/${Uri.encodeComponent(messageId)}/audio';

  Future<Map<String, dynamic>> sendPhotoMessage(
    String friendId,
    String photoId,
  ) =>
      _requestMap(
        '/chat/${Uri.encodeComponent(friendId)}',
        method: 'POST',
        payload: {'type': 'photo', 'photoId': photoId},
      );

  Future<Map<String, dynamic>> reactToMessage(
    String friendId,
    String messageId,
    String reaction,
  ) =>
      _requestMap(
        '/chat/${Uri.encodeComponent(friendId)}/${Uri.encodeComponent(messageId)}/reaction',
        method: 'PUT',
        payload: {'reaction': reaction},
      );

  Future<Map<String, dynamic>> callConfig() => _requestMap('/calls/config');

  Future<List<Map<String, dynamic>>> callSignals() async =>
      _maps(await _request('/calls/signals'));

  Future<void> sendCallSignal(
    String friendId, {
    required String type,
    required String sessionId,
    Map<String, dynamic>? description,
    Map<String, dynamic>? candidate,
  }) async {
    await _request(
      '/calls/${Uri.encodeComponent(friendId)}/signal',
      method: 'POST',
      payload: {
        'type': type,
        'sessionId': sessionId,
        if (description != null) 'description': description,
        if (candidate != null) 'candidate': candidate,
      },
    );
  }

  Future<List<Map<String, dynamic>>> feed() async =>
      _maps(await _request('/social/feed'));

  Future<Map<String, dynamic>> userProfile(String userId) =>
      _requestMap('/users/${Uri.encodeComponent(userId)}/profile');

  Future<void> likePhoto(String photoId) async {
    await _request(
      '/user/photos/${Uri.encodeComponent(photoId)}/like',
      method: 'POST',
    );
  }

  Future<Map<String, dynamic>> createPhotoPost(String image, String caption) =>
      _requestMap(
        '/user/photos',
        method: 'POST',
        payload: {'image': image, 'caption': caption},
      );

  Future<void> deletePhoto(String photoId) async {
    await _request(
      '/user/photos/${Uri.encodeComponent(photoId)}',
      method: 'DELETE',
    );
  }

  Future<List<Map<String, dynamic>>> notifications() async {
    final result = await _request('/notifications');
    return _maps(result['notifications']);
  }

  Future<void> markNotificationsRead(String friendId) async {
    await _request(
      '/notifications/read/${Uri.encodeComponent(friendId)}',
      method: 'POST',
    );
  }

  Future<Map<String, dynamic>> reels({String? pageToken}) => _requestMap(
        '/social/reels${pageToken == null ? '' : '?pageToken=${Uri.encodeQueryComponent(pageToken)}'}',
      );

  Future<List<Map<String, dynamic>>> listenRooms() async =>
      _maps(await _request('/listen-rooms'));

  Future<Map<String, dynamic>> createListenRoom(
    Song song, {
    String? inviteeId,
  }) =>
      _requestMap(
        '/listen-rooms',
        method: 'POST',
        payload: {
          'song': song.toJson(),
          if (inviteeId != null) 'inviteeId': inviteeId,
        },
      );

  Future<Map<String, dynamic>> joinListenRoom(String code) => _requestMap(
        '/listen-rooms/${Uri.encodeComponent(code)}/join',
        method: 'POST',
      );

  Future<Map<String, dynamic>> listenRoom(String code) =>
      _requestMap('/listen-rooms/${Uri.encodeComponent(code)}');

  Future<Map<String, dynamic>> updateListenRoom(
    String code,
    String action, {
    double position = 0,
    Song? song,
  }) =>
      _requestMap(
        '/listen-rooms/${Uri.encodeComponent(code)}',
        method: 'PUT',
        payload: {
          'action': action,
          if (action == 'seek' || action == 'pause') 'position': position,
          if (action == 'song' && song != null) 'song': song.toJson(),
        },
      );

  Future<void> sendRoomMessage(String code, String text) async {
    await _request(
      '/listen-rooms/${Uri.encodeComponent(code)}/chat',
      method: 'POST',
      payload: {'text': text},
    );
  }

  Future<void> leaveListenRoom(String code) async {
    await _request(
      '/listen-rooms/${Uri.encodeComponent(code)}',
      method: 'DELETE',
    );
  }

  Future<List<Map<String, dynamic>>> games() async =>
      _maps(await _request('/games'));

  Future<Map<String, dynamic>> createGame({String? inviteeId}) => _requestMap(
        '/games',
        method: 'POST',
        payload: {if (inviteeId != null) 'inviteeId': inviteeId},
      );

  Future<Map<String, dynamic>> joinGame(String code) => _requestMap(
        '/games/${Uri.encodeComponent(code)}/join',
        method: 'POST',
      );

  Future<void> declineGame(String code) async {
    await _request(
      '/games/${Uri.encodeComponent(code)}/decline',
      method: 'POST',
    );
  }

  Future<Map<String, dynamic>> game(String code) =>
      _requestMap('/games/${Uri.encodeComponent(code)}');

  Future<Map<String, dynamic>> makeMove(String code, int index) => _requestMap(
        '/games/${Uri.encodeComponent(code)}/moves',
        method: 'POST',
        payload: {'index': index},
      );

  Future<List<Song>> _songs(dynamic value) {
    if (value is! List) {
      throw const ApiException(
          'The song list returned by the server is invalid.');
    }
    return Future.value(
        value.whereType<Map<String, dynamic>>().map(Song.fromJson).toList());
  }

  List<Map<String, dynamic>> _maps(dynamic value) {
    if (value is! List) {
      throw const ApiException('The server returned an invalid list response.');
    }
    return value.whereType<Map<String, dynamic>>().toList();
  }

  Future<Map<String, dynamic>> _requestMap(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? payload,
    bool authenticated = true,
  }) async {
    final response = await _request(
      path,
      method: method,
      payload: payload,
      authenticated: authenticated,
    );
    if (response is! Map<String, dynamic>) {
      throw const ApiException('The server returned an invalid response.');
    }
    return response;
  }

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? payload,
    bool authenticated = true,
  }) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (authenticated && _token != null) {
      headers['Authorization'] = 'Bearer $_token';
    }

    final uri = Uri.parse('$_baseUrl$path');
    late final http.Response response;
    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (payload != null) request.body = jsonEncode(payload);
      final streamed =
          await request.send().timeout(const Duration(seconds: 20));
      response = await http.Response.fromStream(streamed);
    } on SocketException {
      throw const ApiException(
        'The server is unavailable. Make sure the backend is running.',
      );
    } on http.ClientException {
      throw const ApiException(
        'Could not connect to the server. Check your network and backend.',
      );
    } on TimeoutException {
      throw const ApiException('The server timed out. Please try again.');
    }

    dynamic decoded;
    try {
      decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
    } on FormatException {
      throw ApiException(
          'The server returned an unreadable response (${response.statusCode}).');
    }
    if (decoded is! Map<String, dynamic>) {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return decoded;
      }
      throw ApiException('Request failed (${response.statusCode}).');
    }
    if (response.statusCode == 401 && authenticated) {
      await logout();
      throw const ApiException('Please sign in again.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        decoded['error']?.toString() ??
            'Request failed (${response.statusCode}).',
      );
    }
    return decoded;
  }
}
