import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/core/nymix_logo.dart';
import 'package:nymix_mobile/models/user_session.dart';
import 'package:nymix_mobile/screens/activities_screen.dart';
import 'package:nymix_mobile/screens/friends/friends_screen.dart';
import 'package:nymix_mobile/screens/home/home_screen.dart';
import 'package:nymix_mobile/screens/library_screen.dart';
import 'package:nymix_mobile/screens/notifications_screen.dart';
import 'package:nymix_mobile/screens/profile/profile_screen.dart';
import 'package:nymix_mobile/screens/reels_screen.dart';
import 'package:nymix_mobile/screens/search/search_screen.dart';
import 'package:nymix_mobile/screens/social/feed_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';
import 'package:nymix_mobile/services/audio_call_service.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key, required this.user});

  final UserSession user;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _currentIndex = 0;
  late final AudioCallService _callService =
      AudioCallService(ApiService(), _onCallServiceChanged);
  Timer? _callPollTimer;
  bool _pollingCallSignals = false;
  bool _callPollErrorShown = false;
  bool _incomingDialogShowing = false;

  late final List<Widget> _pages = [
    HomeScreen(user: widget.user),
    const SearchScreen(),
    FriendsScreen(callService: _callService),
    const FeedScreen(),
    ProfileScreen(user: widget.user),
  ];

  @override
  void initState() {
    super.initState();
    _callPollTimer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => unawaited(_pollCallSignals()),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_pollCallSignals());
    });
  }

  void _onCallServiceChanged() {
    if (!mounted) return;
    setState(() {});
    if (_callService.status == AudioCallStatus.incoming) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            !_incomingDialogShowing &&
            _callService.status == AudioCallStatus.incoming) {
          unawaited(_showIncomingCallDialog());
        }
      });
    }
  }

  Future<void> _pollCallSignals() async {
    if (_pollingCallSignals) return;
    _pollingCallSignals = true;
    try {
      final signals = await ApiService().callSignals();
      _callPollErrorShown = false;
      if (mounted) await _callService.handleSignals(signals);
    } on ApiException catch (error) {
      if (mounted && !_callPollErrorShown) {
        _callPollErrorShown = true;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Call connection unavailable: ${error.message}'),
          ),
        );
      }
    } finally {
      _pollingCallSignals = false;
    }
  }

  Future<void> _showIncomingCallDialog() async {
    if (_incomingDialogShowing) return;
    _incomingDialogShowing = true;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Incoming audio call'),
        content: const Text('Someone is calling you.'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              unawaited(_endCall());
            },
            child: const Text('Decline'),
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              unawaited(_acceptCall());
            },
            icon: const Icon(Icons.call),
            label: const Text('Accept'),
          ),
        ],
      ),
    );
    _incomingDialogShowing = false;
  }

  Future<void> _acceptCall() async {
    try {
      await _callService.accept();
    } on Exception catch (error) {
      _showCallError(error);
    }
  }

  Future<void> _endCall() async {
    try {
      await _callService.end(notifyFriend: true);
    } on Exception catch (error) {
      _showCallError(error);
    }
  }

  void _showCallError(Object error) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Call failed: $error')),
      );
    }
  }

  Widget _callBanner() {
    final label = switch (_callService.status) {
      AudioCallStatus.outgoing => 'Calling…',
      AudioCallStatus.connecting => 'Connecting audio call…',
      AudioCallStatus.active => 'Audio call in progress',
      AudioCallStatus.idle || AudioCallStatus.incoming => '',
    };
    return Card(
      margin: const EdgeInsets.all(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Row(
          children: [
            const Icon(Icons.call, color: AppTheme.primary),
            const SizedBox(width: 10),
            Expanded(child: Text(label)),
            if (_callService.status == AudioCallStatus.active)
              IconButton(
                tooltip: _callService.muted
                    ? 'Unmute microphone'
                    : 'Mute microphone',
                onPressed: _callService.toggleMute,
                icon: Icon(
                  _callService.muted
                      ? Icons.mic_off_rounded
                      : Icons.mic_rounded,
                ),
              ),
            IconButton(
              tooltip: 'End call',
              onPressed: () => unawaited(_endCall()),
              icon: const Icon(Icons.call_end, color: Colors.redAccent),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _callPollTimer?.cancel();
    unawaited(_callService.dispose());
    super.dispose();
  }

  void _openPage(Widget page) {
    Navigator.of(context).pop();
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  void _selectTab(int index) {
    Navigator.of(context).pop();
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: AppNavigation.scaffoldKey,
      drawer: Drawer(
        backgroundColor: AppTheme.background,
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
                child: Row(
                  children: [
                    const NymixLogo(size: 46),
                    const SizedBox(width: 12),
                    const Text(
                      'Nymix',
                      style:
                          TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    _item(Icons.home_outlined, 'Home', () => _selectTab(0)),
                    _item(Icons.explore_outlined, 'Discover',
                        () => _selectTab(1)),
                    _item(Icons.search, 'Browse / Radio', () => _selectTab(1)),
                    _item(Icons.favorite_border, 'Liked songs', () {
                      _openPage(const LibraryScreen(initialTab: 1));
                    }),
                    _item(Icons.history, 'Recently played', () {
                      _openPage(const LibraryScreen(initialTab: 2));
                    }),
                    _item(Icons.album_outlined, 'Albums & artists', () {
                      _openPage(const LibraryScreen(initialTab: 0));
                    }),
                    const Divider(indent: 16, endIndent: 16),
                    _item(Icons.people_outline, 'Friends & messages',
                        () => _selectTab(2)),
                    _item(Icons.person_add_alt, 'Add friend', () {
                      _openPage(FriendsScreen(
                        initialTab: 1,
                        callService: _callService,
                      ));
                    }),
                    _item(Icons.dynamic_feed_outlined, 'Feed',
                        () => _selectTab(3)),
                    _item(Icons.video_library_outlined, 'Reels', () {
                      _openPage(const ReelsScreen());
                    }),
                    _item(Icons.notifications_none, 'Notifications', () {
                      _openPage(const NotificationsScreen());
                    }),
                    _item(Icons.headphones, 'Listening rooms & games', () {
                      _openPage(const ActivitiesScreen());
                    }),
                    const Divider(indent: 16, endIndent: 16),
                    _item(Icons.person_outline, 'Profile', () => _selectTab(4)),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Text(
                  'Signed in as ${widget.user.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
      body: Stack(
        children: [
          IndexedStack(index: _currentIndex, children: _pages),
          if (_callService.busy &&
              _callService.status != AudioCallStatus.incoming)
            Align(
              alignment: Alignment.bottomCenter,
              child: _callBanner(),
            ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: AppTheme.surface,
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) => setState(() => _currentIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.search_outlined),
            selectedIcon: Icon(Icons.search_rounded),
            label: 'Discover',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_alt_outlined),
            selectedIcon: Icon(Icons.people_alt_rounded),
            label: 'Friends',
          ),
          NavigationDestination(
            icon: Icon(Icons.dynamic_feed_outlined),
            selectedIcon: Icon(Icons.dynamic_feed_rounded),
            label: 'Feed',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _item(IconData icon, String title, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.muted),
      title: Text(title),
      onTap: onTap,
      dense: true,
    );
  }
}
