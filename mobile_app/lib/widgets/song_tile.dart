import 'package:flutter/material.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/models/song.dart';

class SongTile extends StatelessWidget {
  const SongTile({
    super.key,
    required this.song,
    required this.onTap,
    this.trailing,
  });

  final Song song;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final image = song.thumbnail.isNotEmpty
        ? song.thumbnail
        : 'https://img.youtube.com/vi/${song.id}/mqdefault.jpg';
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.network(
            image,
            width: 52,
            height: 52,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Container(
              width: 52,
              height: 52,
              color: AppTheme.primary.withValues(alpha: 0.2),
              child: const Icon(Icons.music_note),
            ),
          ),
        ),
        title: Text(
          song.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${song.artist}${song.duration == null ? '' : ' · ${song.duration}'}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: trailing ?? const Icon(Icons.play_circle_outline),
        onTap: onTap,
      ),
    );
  }
}
