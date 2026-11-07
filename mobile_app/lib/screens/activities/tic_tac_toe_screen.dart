import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:nymix_mobile/core/app_theme.dart';
import 'package:nymix_mobile/services/api_service.dart';

class TicTacToeScreen extends StatefulWidget {
  const TicTacToeScreen({super.key, required this.game});

  final Map<String, dynamic> game;

  @override
  State<TicTacToeScreen> createState() => _TicTacToeScreenState();
}

class _TicTacToeScreenState extends State<TicTacToeScreen> {
  final _api = ApiService();
  late Map<String, dynamic> _game = widget.game;
  Timer? _timer;
  String? _error;
  bool _busy = false;

  String get _code => _game['code'].toString();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  Future<void> _refresh() async {
    try {
      final game = await _api.game(_code);
      if (mounted)
        setState(() {
          _game = game;
          _error = null;
        });
      if (mounted && (game['status'] == 'done' || game['status'] == 'draw')) {
        _timer?.cancel();
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _move(int index) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final game = await _api.makeMove(_code, index);
      if (mounted)
        setState(() {
          _game = game;
          _error = null;
        });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
        _refresh();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _statusText() {
    switch (_game['status']) {
      case 'waiting':
        return 'Waiting for a friend · Code: $_code';
      case 'done':
        return _game['winner'] == ApiService().currentUser?.id
            ? 'You won!'
            : 'Game over';
      case 'draw':
        return 'It is a draw';
      default:
        final members = (_game['members'] as List? ?? const [])
            .whereType<Map<String, dynamic>>();
        final current = members.where((m) => m['id'] == _game['turn']);
        return current.isEmpty
            ? 'Tic-tac-toe'
            : '${current.first['name']}’s turn';
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final board = (_game['board'] as List? ?? List.filled(9, null)).toList();
    final members = (_game['members'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    final myTurn = _game['turn'] == ApiService().currentUser?.id;
    final playable = _game['status'] == 'playing' && myTurn && !_busy;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tic-tac-toe'),
        actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const SizedBox(height: 18),
            Text(
              _statusText(),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              members
                  .map((member) => '${member['name']} (${member['symbol']})')
                  .join('   •   '),
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.muted),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(8),
                child:
                    Text(_error!, style: const TextStyle(color: AppTheme.red)),
              ),
            const Spacer(),
            AspectRatio(
              aspectRatio: 1,
              child: GridView.builder(
                itemCount: 9,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                ),
                itemBuilder: (_, index) {
                  final value = board[index]?.toString() ?? '';
                  return FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.surface,
                      foregroundColor:
                          value == 'X' ? AppTheme.accent : Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                    onPressed:
                        playable && value.isEmpty ? () => _move(index) : null,
                    child: Text(
                      value,
                      style: const TextStyle(
                        fontSize: 48,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  );
                },
              ),
            ),
            const Spacer(),
            if (_game['status'] == 'waiting')
              OutlinedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: _code));
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                          content:
                              Text('Share this code with a friend: $_code')),
                    );
                  }
                },
                icon: const Icon(Icons.share),
                label: Text('Share code: $_code'),
              ),
          ],
        ),
      ),
    );
  }
}
