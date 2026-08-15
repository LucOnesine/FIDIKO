import 'package:flutter/material.dart';

void main() {
  runApp(const FidikoApp());
}

/// Dynamic Theme Palette Definition (Bleu Nuit & Warm Cream)
class FidikoTheme {
  static const Color navyDark = Color(0xFF0B132B);
  static const Color navyLight = Color(0xFF1C2541);
  static const Color creamLight = Color(0xFFF4F1EA);
  static const Color creamDark = Color(0xFFEAE5D9);
  static const Color pureWhite = Color(0xFFFFFFFF);
  static const Color redDisqualified = Color(0xFFD90429);
  static const Color greenSuccess = Color(0xFF06D6A0);

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: navyDark,
      primaryColor: navyLight,
      colorScheme: const ColorScheme.dark(
        primary: navyLight,
        secondary: creamDark,
        surface: navyDark,
        onPrimary: pureWhite,
        onSurface: pureWhite,
        error: redDisqualified,
      ),
      cardTheme: CardTheme(
        color: navyLight,
        elevation: 6,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: navyDark,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(color: pureWhite, fontSize: 20, fontWeight: FontWeight.bold),
      ),
    );
  }

  static ThemeData get lightTheme {
    return ThemeData(
      brightness: Brightness.light,
      scaffoldBackgroundColor: creamLight,
      primaryColor: navyDark,
      colorScheme: const ColorScheme.light(
        primary: navyDark,
        secondary: navyLight,
        surface: creamDark,
        onPrimary: pureWhite,
        onSurface: navyDark,
        error: redDisqualified,
      ),
      cardTheme: CardTheme(
        color: Colors.white,
        elevation: 4,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: creamLight,
        elevation: 0,
        centerTitle: true,
        iconTheme: IconThemeData(color: navyDark),
        titleTextStyle: TextStyle(color: navyDark, fontSize: 20, fontWeight: FontWeight.bold),
      ),
    );
  }
}

class FidikoApp extends StatefulWidget {
  const FidikoApp({super.key});

  @override
  State<FidikoApp> createState() => _FidikoAppState();
}

class _FidikoAppState extends State<FidikoApp> {
  bool _isDarkMode = true;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FIDIKO - Vote Local et à Distance',
      debugShowCheckedModeBanner: false,
      theme: FidikoTheme.lightTheme,
      darkTheme: FidikoTheme.darkTheme,
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,
      home: HomeScreen(
        onToggleTheme: () => setState(() => _isDarkMode = !_isDarkMode),
        isDarkMode: _isDarkMode,
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  final VoidCallback onToggleTheme;
  final bool isDarkMode;

  const HomeScreen({
    super.key,
    required onToggleTheme,
    required isDarkMode,
  })  : onToggleTheme = onToggleTheme,
        isDarkMode = isDarkMode;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TextEditingController _codeController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final isDesktop = MediaQuery.of(context).size.width > 768;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: const [
            Icon(Icons.how_to_vote, color: FidikoTheme.greenSuccess),
            SizedBox(width: 8),
            Text('FIDIKO', style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.2)),
          ],
        ),
        actions: [
          IconButton(
            icon: Icon(widget.isDarkMode ? Icons.wb_sunny : Icons.nightlight_round),
            onPressed: widget.onToggleTheme,
            tooltip: 'Basculer Thème (Bleu Nuit / Warm Cream)',
          )
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            constraints: BoxConstraints(maxWidth: isDesktop ? 600 : double.infinity),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(32.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: FidikoTheme.greenSuccess.withOpacity(0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.shield_outlined, size: 48, color: FidikoTheme.greenSuccess),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Rejoindre un Salon de Vote',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Entrez le code unique fourni par l\'administrateur du scrutin (PostgreSQL Real-time Sync).',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey),
                    ),
                    const SizedBox(height: 32),
                    TextField(
                      controller: _codeController,
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 22, letterSpacing: 4, fontWeight: FontWeight.bold),
                      decoration: InputDecoration(
                        hintText: '829147',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        contentPadding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton.icon(
                        onPressed: () {
                          if (_codeController.text.isNotEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Connexion au salon ${_codeController.text}...')),
                            );
                          }
                        },
                        icon: const Icon(Icons.door_open_outlined),
                        label: const Text('Accéder au Salon', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: FidikoTheme.navyLight,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
