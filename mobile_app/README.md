# Nymix Mobile

Flutter client for the Nymix API. The web application and admin panel remain
available in the existing repository; the mobile app shares the Node backend.

## Run locally

1. Install Flutter and Android Studio, then open a terminal in `mobile_app`.
2. Resolve packages:

   ```sh
   flutter pub get
   ```

3. From the repository root, start the backend:

   ```sh
   npm install
   npm start
   ```

4. Start an Android emulator and run the app:

   ```sh
   flutter run -d <emulator-id>
   ```

The Android emulator connects to the host machine through
`http://10.0.2.2:3000/api`. For other targets the default is
`http://localhost:3000/api`. Override it with
`--dart-define=API_BASE_URL=https://your-api.example/api`.

Create an account from the app's registration form, or sign in with an existing
Nymix account. Login and account-backed features require the backend to be
running and reachable.

## Mobile features

- Registration, login, and saved-session restoration
- Featured music, search, radio queries, likes, and listening history
- In-app YouTube player for songs and reels; playback stays inside Nymix
- Friends, friend requests, text/photo/voice messages, reactions, and audio calls
- Feed, photo posts, profile editing/photos, and notifications
- Notifications, profile editing/photos, listening rooms, and Tic-tac-toe

The mobile app and web app use the same Node API and account/data store. Music
uses the official embedded YouTube player rather than opening the YouTube app.
An internet connection is required for YouTube playback. Audio calls use the
shared signaling API; reliable calls between different networks require TURN
configuration on the backend.

Build a debug APK with `flutter build apk --debug`.
