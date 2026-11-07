import 'package:flutter/material.dart';

class AppNavigation {
  static final scaffoldKey = GlobalKey<ScaffoldState>();

  static void openDrawer() => scaffoldKey.currentState?.openDrawer();
}
