class UserSession {
  const UserSession({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.avatar,
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final String? avatar;

  factory UserSession.fromJson(Map<String, dynamic> json) {
    return UserSession(
      id: json['id'] ?? '',
      name: json['name'] ?? 'User',
      email: json['email'] ?? '',
      role: json['role'] ?? 'user',
      avatar: json['avatar'],
    );
  }
}
