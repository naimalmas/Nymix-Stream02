import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/screens/activities/tic_tac_toe_screen.dart';
import 'package:nymix_mobile/screens/activities/listen_room_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';

class ActivitiesScreen extends StatefulWidget {
  const ActivitiesScreen({
    super.key,
    this.inviteCode,
    this.inviteType,
  });

  final String? inviteCode;
  final String? inviteType;

  @override
  State<ActivitiesScreen> createState() => _ActivitiesScreenState();
}

class _ActivitiesScreenState extends State<ActivitiesScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  final _codeController = TextEditingController();
  late final TabController _tabs;
  List<Map<String, dynamic>> _rooms = [];
  List<Map<String, dynamic>> _games = [];
  List<Map<String, dynamic>> _roomInvites = [];
  List<Map<String, dynamic>> _gameInvites = [];
  bool _loading = true;
  bool _creating = false;
  String? _error;
  bool _handlingInvite = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _load();
    if (widget.inviteCode != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _acceptInvite());
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final values = await Future.wait([
        _api.socialData(),
        _api.listenRooms(),
        _api.games(),
      ]);
      final overview = values[0] as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _rooms = values[1] as List<Map<String, dynamic>>;
        _games = values[2] as List<Map<String, dynamic>>;
        _roomInvites = (overview['roomInvites'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        _gameInvites = (overview['gameInvites'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createRoom() async {
    setState(() => _creating = true);
    try {
      final songs = await _api.featuredSongs();
      if (!mounted || songs.isEmpty) return;
      final selected = await showModalBottomSheet<Song>(
        context: context,
        builder: (context) => SafeArea(
          child: ListView(
            children: [
              const ListTile(
                  title: Text('Choose a song for your listening room')),
              ...songs.take(12).map(
                    (song) => ListTile(
                      title: Text(song.title),
                      subtitle: Text(song.artist),
                      onTap: () => Navigator.pop(context, song),
                    ),
                  ),
            ],
          ),
        ),
      );
      if (selected == null) return;
      final room = await _api.createListenRoom(selected);
      if (!mounted) return;
      await _openRoom(room);
    } on ApiException catch (error) {
      _notice(error.message);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _createGame() async {
    final overview = await _api.socialData();
    final friends = (overview['friends'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    if (!mounted) return;
    final friend = friends.isEmpty
        ? null
        : await showModalBottomSheet<Map<String, dynamic>>(
            context: context,
            builder: (context) => SafeArea(
              child: ListView(
                children: [
                  const ListTile(
                      title: Text('Challenge a friend to Tic-tac-toe')),
                  ...friends.map(
                    (item) => ListTile(
                      title: Text(item['name']?.toString() ?? 'Friend'),
                      onTap: () => Navigator.pop(context, item),
                    ),
                  ),
                ],
              ),
            ),
          );
    if (!mounted) return;
    try {
      final game = await _api.createGame(
        inviteeId: friend?['id']?.toString(),
      );
      if (mounted) await _openGame(game);
    } on ApiException catch (error) {
      _notice(error.message);
    }
  }

  Future<void> _joinByCode() async {
    final code = _codeController.text.trim().toUpperCase();
    if (code.isEmpty) return;
    try {
      final room = await _api.joinListenRoom(code);
      if (mounted) await _openRoom(room);
    } on ApiException {
      try {
        final game = await _api.joinGame(code);
        if (mounted) await _openGame(game);
      } on ApiException catch (error) {
        _notice(error.message);
      }
    }
  }

  Future<void> _acceptInvite() async {
    if (_handlingInvite) return;
    _handlingInvite = true;
    try {
      final code = widget.inviteCode!;
      if (widget.inviteType == 'game') {
        final game = await _api.joinGame(code);
        if (mounted) await _openGame(game);
      } else {
        final room = await _api.joinListenRoom(code);
        if (mounted) await _openRoom(room);
      }
    } on ApiException catch (error) {
      _notice(error.message);
    } finally {
      _handlingInvite = false;
    }
  }

  Future<void> _openRoom(Map<String, dynamic> room) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ListenRoomScreen(room: room),
      ),
    );
    if (mounted) _load();
  }

  Future<void> _openGame(Map<String, dynamic> game) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TicTacToeScreen(game: game),
      ),
    );
    if (mounted) _load();
  }

  void _notice(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  Widget _roomList() {
    final all = [..._rooms, ..._roomInvites];
    if (all.isEmpty) {
      return Center(
        child: Text(
          'No active listening rooms',
          style: TextStyle(color: AppTheme.muted),
        ),
      );
    }
    return ListView.builder(
      itemCount: all.length,
      itemBuilder: (_, index) {
        final room = all[index];
        final invite = room['code'] != null &&
            room['hostId'] != null &&
            !_rooms.any((item) => item['code'] == room['code']);
        return Card(
          child: ListTile(
            leading: const Icon(Icons.headphones),
            title: Text(
              (room['song'] as Map<String, dynamic>?)?['title']?.toString() ??
                  'Listening room',
            ),
            subtitle: Text(
              '${room['hostName'] ?? 'Host'} · Code ${room['code'] ?? ''}${invite ? ' · Invite' : ''}',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              try {
                final joined = invite
                    ? await _api.joinListenRoom(room['code'].toString())
                    : await _api.listenRoom(room['code'].toString());
                if (mounted) await _openRoom(joined);
              } on ApiException catch (error) {
                _notice(error.message);
              }
            },
          ),
        );
      },
    );
  }

  Widget _gameList() {
    final all = [..._games, ..._gameInvites];
    if (all.isEmpty) {
      return Center(
        child: Text(
          'No active games',
          style: TextStyle(color: AppTheme.muted),
        ),
      );
    }
    return ListView.builder(
      itemCount: all.length,
      itemBuilder: (_, index) {
        final game = all[index];
        final invite = game['hostId'] != null &&
            !_games.any((item) => item['code'] == game['code']);
        return Card(
          child: ListTile(
            leading: const Icon(Icons.grid_3x3),
            title: Text('Tic-tac-toe · ${game['code'] ?? ''}'),
            subtitle: Text(
              '${game['hostName'] ?? 'Game'} · ${game['status'] ?? 'Invitation'}',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              try {
                final joined = invite
                    ? await _api.joinGame(game['code'].toString())
                    : await _api.game(game['code'].toString());
                if (mounted) await _openGame(joined);
              } on ApiException catch (error) {
                _notice(error.message);
              }
            },
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    _codeController.dispose();
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
        title: const Text('Listen together & games'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh))
        ],
        bottom: TabBar(
          controller: _tabs,
          tabs: const [
            Tab(text: 'Listen rooms'),
            Tab(text: 'Tic-tac-toe'),
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
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _codeController,
                              textCapitalization: TextCapitalization.characters,
                              decoration: const InputDecoration(
                                hintText: 'Room or game code',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: _joinByCode,
                            child: const Text('Join'),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: TabBarView(
                        controller: _tabs,
                        children: [
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            child: _roomList(),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            child: _gameList(),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 8, 14, 18),
                      child: SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _creating
                              ? null
                              : () {
                                  if (_tabs.index == 0) {
                                    _createRoom();
                                  } else {
                                    _createGame();
                                  }
                                },
                          icon: Icon(
                            _tabs.index == 0
                                ? Icons.headphones
                                : Icons.grid_3x3,
                          ),
                          label: Text(
                            _tabs.index == 0
                                ? 'Create listening room'
                                : 'Start a Tic-tac-toe game',
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
    );
  }
}
