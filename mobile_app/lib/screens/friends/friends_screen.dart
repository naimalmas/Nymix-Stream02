import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/screens/social/chat_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/services/audio_call_service.dart';

class FriendsScreen extends StatefulWidget {
  const FriendsScreen({
    super.key,
    this.initialTab = 0,
    this.callService,
  });

  final int initialTab;
  final AudioCallService? callService;

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  final _searchController = TextEditingController();
  late final TabController _tabs;
  Map<String, dynamic> _overview = {};
  List<Map<String, dynamic>> _suggestions = [];
  List<Map<String, dynamic>> _searchResults = [];
  bool _loading = true;
  String? _error;
  Timer? _searchDebounce;

  List<Map<String, dynamic>> get _friends =>
      (_overview['friends'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();
  List<Map<String, dynamic>> get _requests =>
      (_overview['requests'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();

  @override
  void initState() {
    super.initState();
    _tabs = TabController(
      length: 4,
      vsync: this,
      initialIndex: widget.initialTab.clamp(0, 3),
    );
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Future.wait([
        _api.socialData(),
        _api.suggestions(),
      ]);
      if (!mounted) return;
      setState(() {
        _overview = result[0] as Map<String, dynamic>;
        _suggestions = result[1] as List<Map<String, dynamic>>;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _searchUsers(String query) {
    _searchDebounce?.cancel();
    if (query.trim().length < 2) {
      setState(() => _searchResults = []);
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 350), () async {
      try {
        final users = await _api.searchUsers(query.trim());
        if (mounted && _searchController.text.trim() == query.trim()) {
          setState(() => _searchResults = users);
        }
      } on ApiException catch (error) {
        if (mounted) _notice(error.message);
      }
    });
  }

  void _notice(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _request(String id) async {
    try {
      await _api.sendFriendRequest(id);
      _notice('Friend request sent');
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _updateRequest(String id, String status) async {
    try {
      await _api.updateFriendRequest(id, status);
      await _load();
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  void _openChat(Map<String, dynamic> friend) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          friend: friend,
          callService: widget.callService,
        ),
      ),
    );
  }

  Widget _person(Map<String, dynamic> person, {required String mode}) {
    final name = person['name']?.toString() ?? 'Nymix user';
    final avatar = person['avatar']?.toString() ?? '';
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: AppTheme.primary.withValues(alpha: 0.22),
          backgroundImage:
              avatar.startsWith('http') ? NetworkImage(avatar) : null,
          child: avatar.startsWith('http')
              ? null
              : Text(name.isEmpty ? '?' : name.characters.first.toUpperCase()),
        ),
        title: Text(name),
        subtitle: Text(
          mode == 'requests'
              ? (person['direction'] == 'incoming'
                  ? 'Incoming request'
                  : 'Request sent')
              : mode == 'friends'
                  ? 'Friend'
                  : (person['mutualFriends'] == null
                      ? 'Nymix member'
                      : '${person['mutualFriends']} mutual friends'),
        ),
        trailing: mode == 'friends'
            ? PopupMenuButton<String>(
                onSelected: (action) async {
                  if (action == 'message') _openChat(person);
                  if (action == 'remove') {
                    final relation = person['relationId']?.toString();
                    if (relation != null) {
                      try {
                        await _api.removeFriend(relation);
                        await _load();
                      } on ApiException catch (error) {
                        _notice(error.message);
                      }
                    }
                  }
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'message', child: Text('Message')),
                  PopupMenuItem(value: 'remove', child: Text('Remove friend')),
                ],
              )
            : mode == 'requests'
                ? person['direction'] == 'incoming'
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: 'Accept',
                            onPressed: () => _updateRequest(
                              person['id'].toString(),
                              'accepted',
                            ),
                            icon: const Icon(Icons.check_circle_outline),
                          ),
                          IconButton(
                            tooltip: 'Decline',
                            onPressed: () => _updateRequest(
                              person['id'].toString(),
                              'rejected',
                            ),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      )
                    : const Icon(Icons.hourglass_top)
                : person['relation'] == 'sent'
                    ? const Icon(Icons.hourglass_top)
                    : IconButton(
                        tooltip: 'Add friend',
                        onPressed: () => _request(person['id'].toString()),
                        icon: const Icon(Icons.person_add_alt_1),
                      ),
        onTap: mode == 'friends' ? () => _openChat(person) : null,
      ),
    );
  }

  Widget _list(List<Map<String, dynamic>> people, String mode, String empty) {
    if (people.isEmpty) return Center(child: Text(empty));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(14),
        itemCount: people.length,
        itemBuilder: (_, index) => _person(people[index], mode: mode),
      ),
    );
  }

  Widget _discover() {
    final people = _searchController.text.trim().length >= 2
        ? _searchResults
        : _suggestions;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(14),
          child: TextField(
            controller: _searchController,
            onChanged: _searchUsers,
            decoration: const InputDecoration(
              hintText: 'Search by name or email',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: _list(
            people,
            'suggestions',
            _searchController.text.trim().length >= 2
                ? 'No users found'
                : 'No suggestions right now',
          ),
        ),
      ],
    );
  }

  Widget _messages() {
    final sorted = [..._friends];
    sorted.sort((a, b) {
      final messages = _overview['lastMessages'] as Map? ?? {};
      final at = messages[a['id']]?['ts'] ?? 0;
      final bt = messages[b['id']]?['ts'] ?? 0;
      return (bt as num).compareTo(at as num);
    });
    return _list(sorted, 'friends', 'Add friends to start a conversation');
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
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
        title: const Text('Friends & messages'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh))
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Friends'),
            Tab(text: 'Discover'),
            Tab(text: 'Requests'),
            Tab(text: 'Messages'),
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
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _list(_friends, 'friends', 'Your friends will appear here'),
                    _discover(),
                    _list(_requests, 'requests', 'No pending requests'),
                    _messages(),
                  ],
                ),
    );
  }
}
