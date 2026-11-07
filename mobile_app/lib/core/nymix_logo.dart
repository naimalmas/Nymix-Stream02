import 'package:flutter/material.dart';

class NymixLogo extends StatelessWidget {
  const NymixLogo({super.key, this.size = 52});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF6D28D9), Color(0xFFA855F7), Color(0xFF22D3EE)],
        ),
        borderRadius: BorderRadius.circular(size * 0.29),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF7C3AED).withValues(alpha: 0.38),
            blurRadius: size * 0.34,
            offset: Offset(0, size * 0.09),
          ),
        ],
      ),
      child: CustomPaint(painter: _NymixLogoPainter()),
    );
  }
}

class _NymixLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width;
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 0.105
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final mark = Path()
      ..moveTo(scale * 0.27, scale * 0.70)
      ..lineTo(scale * 0.27, scale * 0.32)
      ..lineTo(scale * 0.60, scale * 0.68)
      ..lineTo(scale * 0.60, scale * 0.30)
      ..lineTo(scale * 0.76, scale * 0.30);
    canvas.drawPath(mark, paint);

    final note = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(Offset(scale * 0.69, scale * 0.67), scale * 0.085, note);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
