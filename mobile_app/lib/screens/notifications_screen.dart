import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/screens/activities_screen.dart';
import 'package:nymix_mobile/screens/friends/friends_screen.dart';
import 'package:nymix_mobile/screens/social/chat_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _api = ApiService();
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _api.notifications();
      if (mounted) setState(() => _items = items);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> item) async {
    final type = item['type'];
    if (type == 'message' && item['friendId'] != null) {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ChatScreen(friend: {
            'id': item['friendId'],
            'name': item['title'] ?? 'Friend',
          }),
        ),
      );
    } else if (type == 'game' || type == 'room') {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ActivitiesScreen(
            inviteCode: item['code']?.toString(),
            inviteType: type.toString(),
          ),
        ),
      );
    } else {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => const FriendsScreen(initialTab: 2),
        ),
      );
    }
    if (mounted) _load();
  }

  IconData _icon(String type) => switch (type) {
        'friend' => Icons.person_add_alt_1,
        'game' => Icons.grid_3x3,
        'room' => Icons.headphones,
        'message' => Icons.chat_bubble_outline,
        _ => Icons.notifications,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: AppNavigation.openDrawer,
          icon: const Icon(Icons.menu),
        ),
        title: const Text('Notifications'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh))
        ],
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
              : _items.isEmpty
                  ? Center(
                      child: Text(
                        'You are all caught up',
                        style: TextStyle(color: AppTheme.muted),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        itemCount: _items.length,
                        itemBuilder: (_, index) {
                          final item = _items[index];
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  AppTheme.primary.withValues(alpha: 0.18),
                              child:
                                  Icon(_icon(item['type']?.toString() ?? '')),
                            ),
                            title: Text(item['title']?.toString() ?? ''),
                            subtitle: Text(item['body']?.toString() ?? ''),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _open(item),
                          );
                        },
                      ),
                    ),
    );
  }
}
