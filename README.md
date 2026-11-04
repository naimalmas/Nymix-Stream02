# Nymix Stream

Nymix is an Express-backed music app with separate User, Admin, and Super Admin dashboards.

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
- `YOUTUBE_API_KEY`: optional YouTube Data API key for live search. Without it, search uses featured songs.

Never commit database URLs, API keys, JWT secrets, or live `data/*.json` files. The Super Admin account is seeded once when the database state is first initialized; later deployments do not overwrite existing accounts.
