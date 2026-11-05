# Nymix Stream

Nymix is an Express-backed music app with separate User, Admin, and Super Admin dashboards.

## Social features

Signed-in members get friend suggestions ranked by mutual connections, can search for members by name or email, and can send or accept friend requests. The direct-message inbox is the social home: from a friend's conversation, members can send a Tic-tac-toe challenge, play on an embedded board, search for a song, and invite the friend into synced playback without leaving the chat. Friends can also join a listening room and use its room chat. Social data is stored with the app state in PostgreSQL on Vercel and in ignored local JSON files during development; updates use short-interval polling.

Open **Friends & Games** in the music app, or go directly to `/social.html`. A friend relationship is required before private chats, listening rooms, or games can be joined.

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

Never commit database URLs, API keys, JWT secrets, or live `data/*.json` files. The Super Admin account is seeded once when the database state is first initialized; later deployments do not overwrite existing accounts.
