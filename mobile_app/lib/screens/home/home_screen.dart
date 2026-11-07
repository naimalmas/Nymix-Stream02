import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_navigation.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/core/nymix_logo.dart';
import 'package:nymix_mobile/models/song.dart';
import 'package:nymix_mobile/models/user_session.dart';
import 'package:nymix_mobile/screens/music/player_screen.dart';
import 'package:nymix_mobile/services/api_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.user});

  final UserSession user;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Future<List<Song>>? _songsFuture;

  @override
  void initState() {
    super.initState();
    _songsFuture = ApiService().featuredSongs();
  }

  Future<void> _refresh() async {
    final future = ApiService().featuredSongs();
    setState(() {
      _songsFuture = future;
    });
    await future;
  }

  Future<void> _openSong(Song song, {List<Song> queue = const []}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PlayerScreen(song: song, queue: queue)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final firstName = widget.user.name.trim().split(RegExp(r'\s+')).first;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: AppNavigation.openDrawer,
          icon: const Icon(Icons.menu_rounded),
        ),
        title: const Row(
          children: [
            NymixLogo(size: 32),
            SizedBox(width: 10),
            Text('Nymix'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh music',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: FutureBuilder<List<Song>>(
        future: _songsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError && !snapshot.hasData) {
            return _LoadError(
                message: snapshot.error.toString(), onRetry: _refresh);
          }
          final songs = snapshot.data ?? const <Song>[];
          final featured = songs.isEmpty ? null : songs.first;
          return RefreshIndicator(
            onRefresh: _refresh,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Good ${_greeting()},',
                                  style: TextStyle(
                                    color:
                                        AppTheme.muted.withValues(alpha: .85),
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  firstName,
                                  style: const TextStyle(
                                    fontSize: 30,
                                    height: 1.12,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: -.8,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          CircleAvatar(
                            radius: 23,
                            backgroundColor: AppTheme.surfaceRaised,
                            child: Text(
                              firstName.isEmpty
                                  ? 'N'
                                  : firstName.characters.first.toUpperCase(),
                              style: const TextStyle(
                                color: AppTheme.accent,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      _FeaturedBanner(
                        song: featured,
                        onPlay: (song) => _openSong(song, queue: songs),
                      ),
                      const SizedBox(height: 26),
                      _SectionHeading(
                        title: 'Made for you',
                        subtitle: 'Fresh picks from Nymix',
                      ),
                      const SizedBox(height: 14),
                      if (songs.isEmpty)
                        const _EmptyMusic()
                      else
                        SizedBox(
                          height: 224,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: songs.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(width: 13),
                            itemBuilder: (_, index) => _SongCard(
                              song: songs[index],
                              onTap: () =>
                                  _openSong(songs[index], queue: songs),
                            ),
                          ),
                        ),
                      const SizedBox(height: 27),
                      _SectionHeading(
                        title: 'Popular right now',
                        subtitle: 'Listen and find your next favorite',
                      ),
                      const SizedBox(height: 10),
                      ...songs.skip(1).take(8).toList().asMap().entries.map(
                            (entry) => _SongRow(
                              index: entry.key + 1,
                              song: entry.value,
                              onTap: () =>
                                  _openSong(entry.value, queue: songs),
                            ),
                          ),
                      const SizedBox(height: 22),
                    ]),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }
}

class _FeaturedBanner extends StatelessWidget {
  const _FeaturedBanner({required this.song, required this.onPlay});

  final Song? song;
  final ValueChanged<Song> onPlay;

  @override
  Widget build(BuildContext context) {
    final track = song;
    return Container(
      height: 230,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: const LinearGradient(
          colors: [Color(0xFF5424B8), Color(0xFF8A37D6), Color(0xFF275E82)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primary.withValues(alpha: .22),
            blurRadius: 28,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (track != null && track.thumbnail.isNotEmpty)
            Image.network(
              track.thumbnail,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  const Color(0xFF140A2D).withValues(alpha: .18),
                  const Color(0xFF140A2D).withValues(alpha: .9),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(21),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .16),
                    borderRadius: BorderRadius.circular(20),
                    border:
                        Border.all(color: Colors.white.withValues(alpha: .12)),
                  ),
                  child: const Text(
                    'NYMIX PICKS',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.3,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  track?.title ?? 'Your music, your world',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 25,
                    height: 1.08,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.4,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  track?.artist ?? 'Discover something new',
                  style: TextStyle(color: Colors.white.withValues(alpha: .82)),
                ),
                const SizedBox(height: 15),
                FilledButton.icon(
                  onPressed: track == null ? null : () => onPlay(track),
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppTheme.primary,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 19, vertical: 12),
                  ),
                  icon: const Icon(Icons.play_arrow_rounded, size: 21),
                  label: const Text('Play now'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 19, fontWeight: FontWeight.w900)),
                const SizedBox(height: 3),
                Text(subtitle,
                    style: TextStyle(fontSize: 12, color: AppTheme.muted)),
              ],
            ),
          ),
        ],
      );
}

class _SongCard extends StatelessWidget {
  const _SongCard({required this.song, required this.onTap});

  final Song song;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 156,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(19),
                      child: Image.network(
                        song.thumbnail.isNotEmpty
                            ? song.thumbnail
                            : 'https://img.youtube.com/vi/${song.id}/mqdefault.jpg',
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: AppTheme.surfaceRaised,
                          child: const Icon(Icons.music_note_rounded, size: 42),
                        ),
                      ),
                    ),
                    Positioned(
                      right: 9,
                      bottom: 9,
                      child: CircleAvatar(
                        radius: 19,
                        backgroundColor: AppTheme.primary,
                        child: const Icon(Icons.play_arrow_rounded, size: 24),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Text(
                song.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 3),
              Text(
                song.artist,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
            ],
          ),
        ),
      );
}

class _SongRow extends StatelessWidget {
  const _SongRow({
    required this.index,
    required this.song,
    required this.onTap,
  });

  final int index;
  final Song song;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: const EdgeInsets.symmetric(vertical: 2),
        leading: SizedBox(
          width: 43,
          child: Row(
            children: [
              Text('$index',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              const SizedBox(width: 7),
              ClipRRect(
                borderRadius: BorderRadius.circular(9),
                child: Image.network(
                  song.thumbnail,
                  width: 36,
                  height: 36,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 36,
                    height: 36,
                    color: AppTheme.surfaceRaised,
                    child: const Icon(Icons.music_note, size: 18),
                  ),
                ),
              ),
            ],
          ),
        ),
        title: Text(song.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle:
            Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: IconButton(
          onPressed: onTap,
          icon: const Icon(Icons.play_circle_outline_rounded),
        ),
        onTap: onTap,
      );
}

class _EmptyMusic extends StatelessWidget {
  const _EmptyMusic();

  @override
  Widget build(BuildContext context) => Container(
        height: 160,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text('No songs available yet',
            style: TextStyle(color: AppTheme.muted)),
      );
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 42),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton.tonal(
                  onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        ),
      );
}
