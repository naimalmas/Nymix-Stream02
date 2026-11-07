class Song {
  const Song({
    required this.id,
    required this.title,
    required this.artist,
    required this.thumbnail,
    this.album,
    this.duration,
  });

  final String id;
  final String title;
  final String artist;
  final String thumbnail;
  final String? album;
  final String? duration;

  factory Song.fromJson(Map<String, dynamic> json) {
    final image = json['thumb'] ?? json['thumbnail'] ?? json['image'] ?? '';
    return Song(
      id: json['id']?.toString() ?? '',
      title: json['title'] ?? 'Untitled',
      artist: json['artist'] ?? 'Unknown Artist',
      thumbnail: image,
      album: json['album'],
      duration: json['dur'] ?? json['duration'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'artist': artist,
      'thumb': thumbnail,
      'album': album,
      'dur': duration,
    };
  }
}
