# Nymix Stream

Nymix is an Express-backed music app with separate User, Admin, and Super Admin dashboards.

## Messages and friends

Signed-in members get friend suggestions ranked by mutual connections, can search for members by name or email, and can send or accept friend requests. Profiles can be opened from discovery, friend lists, chats, and the sidebar; members can update their name, bio, and profile photo, and share up to 100 arranged photos to their profile and the community feed. Feed photos can be liked, deleted by their owner, or shared to one friend's chat; shared photos appear in the conversation and show as unavailable if the original photo is deleted. Profile photos are center-cropped and resized in the browser; avatar photos are limited to 128 KB and feed photos to 64 KB each. The separate Reels feed searches recent, embeddable YouTube Shorts with the configured topic and displays them using YouTube's privacy-enhanced embed player. A Super Admin can set the YouTube API key and Reels topic in platform settings; YouTube API quota applies and the key is never returned to user-facing APIs. Messages opens inside the music app, keeping the profile and navigation sidebar in place. From a friend's chat, members can send text or up-to-60-second voice messages, react to messages, send a Tic-tac-toe challenge, or invite the friend into synced playback without leaving the chat. Audio calls use the browser's microphone and WebRTC; users must accept microphone access and incoming calls. The music app, discovery, inbox, and profile editor adapt to mobile screens. Conversation data is stored with the app state in PostgreSQL on Vercel and in ignored local JSON files during development; updates use short-interval polling.

The app header's notification bell refreshes every four seconds while the app is open and shows incoming friend requests, unread chat messages, game challenges, and listening invitations. Opening a conversation marks its incoming messages as read.

Open **Messages** or **Add friend** from the Nymix sidebar, or go directly to `/social.html`. A friend relationship is required before private chats, listening rooms, games, or calls can be started.

The Nymix home page features recent videos from the [Naim Almas Official YouTube channel](https://www.youtube.com/@naimalmasofficial). The server uses the configured YouTube Data API key and caches the channel playlist for 15 minutes.

The home page also rotates between Nymix Picks and Prokash Hits featured music packs, using uploads from the [Prokash YouTube channel](https://www.youtube.com/channel/UCh0udHXRXh-wxmX65ZOzVZw). The banner's arrows and dots let listeners switch packs manually; the song list and Play button follow the selected pack.

## Watch together

Open `/movies.html` to start a private Watch Together room. Sign in, select 1–7 accepted friends, and create a room; only those invited friends can join. Room chat, membership, playback selection, and WebRTC signaling are stored in the existing local JSON state or PostgreSQL state on Vercel.

The room host can share a browser tab/screen, paste a YouTube or Google Drive playback link, or play a local video from their device and relay it directly to room members. Screen/file sharing uses browser WebRTC peer connections rather than uploading the movie to the server; peer connectivity depends on the participants' networks, and restrictive networks may need a TURN service. Audio/video calling is not included in this watch-room version. Google Drive/YouTube embeds use each provider's official player and do not provide synchronized transport controls. Only use videos you own or have permission to share; protected third-party streams are not extracted or bypassed.

## Local development

```sh
npm install
npm start
```

Open `http://localhost:3000`. Local development stores data in ignored `data/*.json` files. The first run prints a generated Super Admin password unless `SUPER_ADMIN_PASSWORD` is set.

## Vercel deployment

Deploy the GitHub repository as an Express project. Vercel serves files from `public/` and runs the Express app as a Node.js Function. App data is stored in PostgreSQL as one JSONB state row and is initialized from the sanitized `data/*.example.json` files on the first API request.

Configure these environment variables for Production, Preview, and Development as needed:

- `DATABASE_URL`: PostgreSQL connection string. The database role must be allowed to create a table and read/write rows.
- `JWT_SECRET`: a private, persistent random secret (at least 32 random bytes recommended).
- `SUPER_ADMIN_PASSWORD`: initial Super Admin password, at least 12 characters.
- `YOUTUBE_API_KEY`: YouTube Data API key for full search. Search returns up to 50 songs per page with a “Load more songs” button. Without a key, only matching featured songs are available.
- `TURN_URLS` (optional): comma-separated TURN server URLs for audio calls. Without a TURN server, calls rely on STUN and may not connect on restrictive networks.
- `TURN_SECRET` (optional): shared secret for Coturn REST API credentials. Configure it with `TURN_URLS` to issue short-lived TURN credentials to signed-in users.

Never commit database URLs, API keys, JWT secrets, or live `data/*.json` files. The Super Admin account is seeded once when the database state is first initialized; later deployments do not overwrite existing accounts.
