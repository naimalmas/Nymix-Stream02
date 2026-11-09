// =====================================================
//  NYMIX — Express Backend Server
// =====================================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const fetch    = require('node-fetch');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isVercel = Boolean(process.env.VERCEL);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Data Helpers ──────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!isVercel) fs.mkdirSync(dataDir, { recursive: true });
const dp = file => path.join(dataDir, file);
const requestState = new AsyncLocalStorage();
const rd = file => {
  const state = requestState.getStore();
  return state ? state[file] : JSON.parse(fs.readFileSync(dp(file), 'utf8'));
};
const wd = (file, value) => {
  const state = requestState.getStore();
  if (state) state[file] = value;
  else fs.writeFileSync(dp(file), JSON.stringify(value, null, 2));
};

if (!isVercel) {
  [
    ['config.json', 'config.example.json'],
    ['users.json', 'users.example.json'],
    ['liked.json', 'liked.example.json'],
    ['plays.json', 'plays.example.json'],
    ['friends.json', 'friends.example.json'],
    ['messages.json', 'messages.example.json'],
    ['social.json', 'social.example.json'],
  ].forEach(([file, example]) => {
    if (!fs.existsSync(dp(file))) fs.copyFileSync(dp(example), dp(file));
  });
}

if (isVercel && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be configured in Vercel');
const SECRET = process.env.JWT_SECRET || (() => {
  const secretPath = dp('jwt-secret');
  try { return fs.readFileSync(secretPath, 'utf8').trim(); }
  catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, secret);
    return secret;
  }
})();

if (!isVercel) {
  const users = rd('users.json');
  const seededSuperAdmin = users.find(user => user.id === 'admin_001');
  if (seededSuperAdmin && seededSuperAdmin.role === 'admin') {
    seededSuperAdmin.role = 'super_admin';
    wd('users.json', users);
  }
  if (seededSuperAdmin && seededSuperAdmin.password === '__GENERATE_ON_FIRST_START__') {
    const password = process.env.SUPER_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
    seededSuperAdmin.password = bcrypt.hashSync(password, 10);
    wd('users.json', users);
    if (!process.env.SUPER_ADMIN_PASSWORD) console.log(`Initial Super Admin password: ${password}`);
  }
}

const database = isVercel && process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
  : null;
let databaseInitialization;

async function initializeDatabase() {
  if (!database) throw new Error('DATABASE_URL must be configured in Vercel');
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      await database.query(`CREATE TABLE IF NOT EXISTS nymix_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        config jsonb NOT NULL,
        users jsonb NOT NULL,
        liked jsonb NOT NULL,
        plays jsonb NOT NULL,
        friends jsonb NOT NULL DEFAULT '[]'::jsonb,
        messages jsonb NOT NULL DEFAULT '{}'::jsonb,
        social jsonb NOT NULL DEFAULT '{"listenRooms":[],"games":[],"roomMessages":{}}'::jsonb
      )`);
      await database.query("ALTER TABLE nymix_state ADD COLUMN IF NOT EXISTS friends jsonb NOT NULL DEFAULT '[]'::jsonb");
      await database.query("ALTER TABLE nymix_state ADD COLUMN IF NOT EXISTS messages jsonb NOT NULL DEFAULT '{}'::jsonb");
      await database.query("ALTER TABLE nymix_state ADD COLUMN IF NOT EXISTS social jsonb NOT NULL DEFAULT '{\"listenRooms\":[],\"games\":[],\"roomMessages\":{}}'::jsonb");
      const existing = await database.query('SELECT id FROM nymix_state WHERE id = 1');
      if (existing.rowCount) return;
      if (!process.env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD.length < 12) {
        throw new Error('SUPER_ADMIN_PASSWORD (at least 12 characters) must be configured in Vercel');
      }
      const seed = name => JSON.parse(fs.readFileSync(dp(name), 'utf8'));
      const config = seed('config.example.json');
      if (process.env.YOUTUBE_API_KEY) config.ytApiKey = process.env.YOUTUBE_API_KEY;
      const users = seed('users.example.json');
      const superAdmin = users.find(user => user.id === 'admin_001');
      if (!superAdmin) throw new Error('Super Admin seed account is missing');
      superAdmin.role = 'super_admin';
      superAdmin.password = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 10);
      await database.query(
        'INSERT INTO nymix_state (id, config, users, liked, plays, friends, messages, social) VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb) ON CONFLICT (id) DO NOTHING',
        [
          JSON.stringify(config),
          JSON.stringify(users),
          JSON.stringify(seed('liked.example.json')),
          JSON.stringify(seed('plays.example.json')),
          JSON.stringify(seed('friends.example.json')),
          JSON.stringify(seed('messages.example.json')),
          JSON.stringify(seed('social.example.json')),
        ],
      );
    })();
  }
  return databaseInitialization;
}

async function persistentState(req, res, next) {
  if (!isVercel) return next();
  let client;
  try {
    await initializeDatabase();
    client = await database.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT config, users, liked, plays, friends, messages, social FROM nymix_state WHERE id = 1 FOR UPDATE');
    if (!result.rowCount) throw new Error('Application database state is not initialized');
    const state = {
      'config.json': result.rows[0].config,
      'users.json': result.rows[0].users,
      'liked.json': result.rows[0].liked,
      'plays.json': result.rows[0].plays,
      'friends.json': result.rows[0].friends,
      'messages.json': result.rows[0].messages,
      'social.json': result.rows[0].social,
    };
    let finished = false;
    const sendJson = res.json.bind(res);
    res.json = body => {
      if (finished) return res;
      finished = true;
      (async () => {
        try {
          await client.query(
            'UPDATE nymix_state SET config = $1::jsonb, users = $2::jsonb, liked = $3::jsonb, plays = $4::jsonb, friends = $5::jsonb, messages = $6::jsonb, social = $7::jsonb WHERE id = 1',
            [
              JSON.stringify(state['config.json']),
              JSON.stringify(state['users.json']),
              JSON.stringify(state['liked.json']),
              JSON.stringify(state['plays.json']),
              JSON.stringify(state['friends.json']),
              JSON.stringify(state['messages.json']),
              JSON.stringify(state['social.json']),
            ],
          );
          await client.query('COMMIT');
          sendJson(body);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          if (!res.headersSent) { res.status(500); sendJson({ error: 'Database transaction failed' }); }
        } finally { client.release(); }
      })();
      return res;
    };
    res.on('close', () => {
      if (!finished) {
        finished = true;
        client.query('ROLLBACK').catch(() => {}).finally(() => client.release());
      }
    });
    requestState.run(state, next);
  } catch (error) {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    console.error('Persistent storage unavailable:', error.message);
    res.status(503).json({ error: 'Persistent database is not configured or available' });
  }
}

app.use('/api', persistentState);

// ── Auth Middleware ───────────────────────────────────
const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    const claims = jwt.verify(h.split(' ')[1], SECRET);
    const account = rd('users.json').find(user => user.id === claims.id);
    if (!account || account.banned) return res.status(401).json({ error: 'Account unavailable' });
    req.user = { id: account.id, name: account.name, email: account.email, role: account.role };
    next();
  }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};
const roleAuth = (...roles) => (req, res, next) => auth(req, res, () => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
});
const userAuth = roleAuth('user');
const adminAuth = (req, res, next) => auth(req, res, () => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  next();
});
const superAdminAuth = roleAuth('super_admin');

app.get('/api/movies', (req, res) => {
  const catalog = rd('config.json').movieCatalog;
  res.set('Cache-Control', 'no-store');
  res.json(Array.isArray(catalog) ? catalog : []);
});

app.post('/api/admin/movies', adminAuth, (req, res) => {
  const { title, year, genre, description, libraryId, videoId } = req.body && typeof req.body === 'object' ? req.body : {};
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanGenre = typeof genre === 'string' ? genre.trim() : '';
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  const cleanLibraryId = typeof libraryId === 'string' ? libraryId.trim() : '';
  const cleanVideoId = typeof videoId === 'string' ? videoId.trim() : '';
  const allowedGenres = new Set(['ড্রামা', 'অ্যাডভেঞ্চার', 'কমেডি', 'থ্রিলার', 'ডকুমেন্টারি', 'অন্যান্য']);
  if (!cleanTitle || cleanTitle.length > 80) return res.status(400).json({ error: 'Movie title is required and must be 80 characters or fewer' });
  if (!Number.isInteger(year) || year < 1888 || year > 2100) return res.status(400).json({ error: 'Enter a valid release year' });
  if (!allowedGenres.has(cleanGenre)) return res.status(400).json({ error: 'Choose a supported movie genre' });
  if (cleanDescription.length > 240) return res.status(400).json({ error: 'Description must be 240 characters or fewer' });
  if (!/^[A-Za-z0-9_-]+$/.test(cleanLibraryId) || !/^[A-Za-z0-9_-]+$/.test(cleanVideoId)) {
    return res.status(400).json({ error: 'Enter valid Bunny Stream Library and Video IDs' });
  }
  const config = rd('config.json');
  const catalog = Array.isArray(config.movieCatalog) ? config.movieCatalog : [];
  if (catalog.length >= 500) return res.status(409).json({ error: 'Movie catalog is full' });
  const movie = {
    id: crypto.randomUUID(),
    title: cleanTitle,
    year,
    genre: cleanGenre,
    description: cleanDescription,
    embedUrl: `https://iframe.mediadelivery.net/embed/${encodeURIComponent(cleanLibraryId)}/${encodeURIComponent(cleanVideoId)}`,
    demo: false,
  };
  config.movieCatalog = [...catalog, movie];
  wd('config.json', config);
  res.status(201).json(movie);
});

app.delete('/api/admin/movies/:movieId', adminAuth, (req, res) => {
  const config = rd('config.json');
  const catalog = Array.isArray(config.movieCatalog) ? config.movieCatalog : [];
  const updated = catalog.filter(movie => movie.id !== req.params.movieId);
  if (updated.length === catalog.length) return res.status(404).json({ error: 'Movie not found' });
  config.movieCatalog = updated;
  wd('config.json', config);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const users = rd('users.json');
    if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: 'u_' + Date.now(), name, email, password: hash, role: 'user', avatar: '', createdAt: new Date().toISOString(), banned: false, totalPlays: 0, bio: '' };
    users.push(user);
    wd('users.json', users);
    const liked = rd('liked.json');
    liked[user.id] = [];
    wd('liked.json', liked);
    const token = jwt.sign({ id: user.id, name, email, role: 'user' }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name, email, role: 'user', avatar: '' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = rd('users.json');
    const user  = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.banned) return res.status(403).json({ error: 'Account banned' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, name: user.name, email, role: user.role }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, avatar: user.avatar } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  const users = rd('users.json');
  const user  = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar, createdAt: user.createdAt, totalPlays: user.totalPlays, bio: user.bio || '' });
});

// ══════════════════════════════════════════════════════
//  MUSIC
// ══════════════════════════════════════════════════════
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'Query required' });
  const { pageToken } = req.query;
  if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 500)) {
    return res.status(400).json({ error: 'Invalid page token' });
  }
  try {
    const cfg = rd('config.json');
    const key = process.env.YOUTUBE_API_KEY || cfg.ytApiKey;
    if (!key) {
      const query = q.trim().toLocaleLowerCase();
      const items = cfg.featuredSongs.filter(song =>
        [song.title, song.artist, song.album].some(value => value.toLocaleLowerCase().includes(query)),
      );
      return res.json({ items, nextPageToken: null, searchLimited: true });
    }
    const params = new URLSearchParams({
      part: 'snippet',
      q: `${q} song`,
      type: 'video',
      videoCategoryId: '10',
      maxResults: '50',
      key,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const songs = (d.items || []).map(it => ({
      id:     it.id.videoId,
      title:  it.snippet.title.replace(/\s*[\(\[].*?[\)\]]/g,'').trim(),
      artist: it.snippet.channelTitle.replace(' - Topic','').replace('VEVO','').trim(),
      thumb:  it.snippet.thumbnails.medium?.url,
      dur: '',
      album: 'YouTube',
    }));
    res.json({ items: songs, nextPageToken: d.nextPageToken || null, searchLimited: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/songs', (req, res) => res.json(rd('config.json').featuredSongs));

const promotedChannels = {
  nymix: {
    id: 'UCDXZVqwPXIO5ytEP7rDIjGQ',
    title: 'Nymix Picks',
    fallbackTitle: 'Naim Almas Official',
    url: 'https://www.youtube.com/@naimalmasofficial',
  },
  prokash: {
    id: 'UCh0udHXRXh-wxmX65ZOzVZw',
    title: 'Prokash Hits',
    fallbackTitle: 'Prokash Hits',
    url: 'https://www.youtube.com/channel/UCh0udHXRXh-wxmX65ZOzVZw',
  },
};
const promotedSongsCache = new Map();
app.get('/api/promoted-songs', async (req, res) => {
  const packId = typeof req.query.pack === 'string' ? req.query.pack : 'nymix';
  const promotedChannel = Object.prototype.hasOwnProperty.call(promotedChannels, packId)
    ? promotedChannels[packId]
    : null;
  if (!promotedChannel) return res.status(400).json({ error: 'Unknown featured music pack' });
  const cached = promotedSongsCache.get(packId);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);
  try {
    const config = rd('config.json');
    const key = process.env.YOUTUBE_API_KEY || config.ytApiKey;
    if (!key) return res.status(503).json({ error: 'YouTube API key is required to load the official channel songs' });
    const channelParams = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: promotedChannel.id,
      key,
    });
    const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`);
    const channelData = await channelResponse.json();
    if (!channelResponse.ok || channelData.error) {
      throw new Error(channelData.error?.message || 'Could not load the official YouTube channel');
    }
    const channel = channelData.items?.[0];
    if (!channel?.contentDetails?.relatedPlaylists?.uploads) {
      throw new Error('The official YouTube channel could not be found');
    }
    const playlistParams = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId: channel.contentDetails.relatedPlaylists.uploads,
      maxResults: '20',
      key,
    });
    const playlistResponse = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${playlistParams}`);
    const playlistData = await playlistResponse.json();
    if (!playlistResponse.ok || playlistData.error) {
      throw new Error(playlistData.error?.message || 'Could not load songs from the official YouTube channel');
    }
    const items = (playlistData.items || []).map(item => {
      const videoId = item.contentDetails?.videoId;
      if (!/^[\w-]{11}$/.test(videoId || '')) return null;
      const thumbnails = item.snippet?.thumbnails || {};
      return {
        id: videoId,
        title: item.snippet?.title || promotedChannel.fallbackTitle,
        artist: channel.snippet?.title || promotedChannel.fallbackTitle,
        album: promotedChannel.title,
        dur: '',
        thumb: thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      };
    }).filter(Boolean);
    const data = {
      packId,
      packTitle: promotedChannel.title,
      channelTitle: channel.snippet?.title || promotedChannel.fallbackTitle,
      channelUrl: promotedChannel.url,
      items,
    };
    promotedSongsCache.set(packId, { expiresAt: Date.now() + 15 * 60 * 1000, data });
    res.json(data);
  } catch (error) {
    console.error(`Unable to load ${promotedChannel.title} songs:`, error.message);
    res.status(502).json({ error: `Unable to load ${promotedChannel.title} songs right now` });
  }
});

app.post('/api/play', auth, (req, res) => {
  try {
    const { songId, songTitle, songArtist, thumb } = req.body;
    const plays = rd('plays.json');
    plays.push({ userId: req.user.id, userName: req.user.name, songId, songTitle, songArtist, thumb, timestamp: Date.now() });
    wd('plays.json', plays);
    const users = rd('users.json');
    const u = users.find(u => u.id === req.user.id);
    if (u) { u.totalPlays = (u.totalPlays || 0) + 1; wd('users.json', users); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
//  USER
// ══════════════════════════════════════════════════════
app.get('/api/user/liked', auth, (req, res) => {
  const liked = rd('liked.json');
  res.json(liked[req.user.id] || []);
});

app.post('/api/user/liked/:songId', auth, (req, res) => {
  const liked = rd('liked.json');
  if (!liked[req.user.id]) liked[req.user.id] = [];
  const idx = liked[req.user.id].findIndex(s => s.id === req.params.songId);
  if (idx >= 0) { liked[req.user.id].splice(idx, 1); wd('liked.json', liked); res.json({ liked: false }); }
  else { liked[req.user.id].unshift({ ...req.body, likedAt: Date.now() }); wd('liked.json', liked); res.json({ liked: true }); }
});

app.get('/api/user/history', auth, (req, res) => {
  const plays = rd('plays.json');
  res.json(plays.filter(p => p.userId === req.user.id).reverse().slice(0, 50));
});

function validProfileImage(dataUrl, maxBytes) {
  const photo = typeof dataUrl === 'string'
    ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    : null;
  if (!photo) return false;
  const image = Buffer.from(photo[2], 'base64');
  if (image.length > maxBytes || image.toString('base64').replace(/=+$/, '') !== photo[2].replace(/=+$/, '')) return false;
  const imageType = image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg'
    : image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
  return imageType === photo[1];
}

const MAX_PROFILE_PHOTOS = 100;

app.put('/api/user/profile', auth, async (req, res) => {
  try {
    const { name, avatar, bio } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 40)) {
      return res.status(400).json({ error: 'Name must be between 1 and 40 characters' });
    }
    if (bio !== undefined && (typeof bio !== 'string' || bio.trim().length > 160)) {
      return res.status(400).json({ error: 'About section must be 160 characters or fewer' });
    }
    if (avatar !== undefined && typeof avatar !== 'string') {
      return res.status(400).json({ error: 'Invalid profile photo' });
    }
    if (avatar && !validProfileImage(avatar, 128 * 1024)) {
      return res.status(400).json({ error: 'Profile photo must be a JPEG, PNG or WebP image under 128 KB' });
    }
    const users = rd('users.json');
    const u = users.find(u => u.id === req.user.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    if (name !== undefined) u.name = name.trim();
    if (avatar !== undefined) u.avatar = avatar;
    if (bio !== undefined) u.bio = bio.trim();
    wd('users.json', users);
    res.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar || '', bio: u.bio || '' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/photos', userAuth, (req, res) => {
  const { image, caption = '' } = req.body;
  if (!validProfileImage(image, 64 * 1024)) {
    return res.status(400).json({ error: 'Photo must be a JPEG, PNG or WebP image under 64 KB' });
  }
  if (typeof caption !== 'string' || caption.trim().length > 150) {
    return res.status(400).json({ error: 'Photo captions must be 150 characters or fewer' });
  }
  const users = rd('users.json');
  const account = users.find(user => user.id === req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  account.photos ||= [];
  if (account.photos.length >= MAX_PROFILE_PHOTOS) return res.status(409).json({ error: 'Your profile is full. Remove a photo before adding another.' });
  const photo = {
    id: crypto.randomBytes(12).toString('hex'),
    image,
    caption: caption.trim(),
    createdAt: new Date().toISOString(),
  };
  account.photos.push(photo);
  wd('users.json', users);
  res.status(201).json({ ...photo });
});

app.delete('/api/user/photos/:photoId', userAuth, (req, res) => {
  const users = rd('users.json');
  const account = users.find(user => user.id === req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  account.photos ||= [];
  const index = account.photos.findIndex(photo => photo.id === req.params.photoId);
  if (index < 0) return res.status(404).json({ error: 'Photo not found' });
  account.photos.splice(index, 1);
  wd('users.json', users);
  res.json({ ok: true });
});

app.post('/api/user/photos/:photoId/like', userAuth, (req, res) => {
  const users = rd('users.json');
  const photo = users
    .filter(account => account.role === 'user' && !account.banned)
    .flatMap(account => Array.isArray(account.photos) ? account.photos : [])
    .find(item => item.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  photo.likes = Array.isArray(photo.likes) ? photo.likes : [];
  const index = photo.likes.indexOf(req.user.id);
  if (index >= 0) photo.likes.splice(index, 1);
  else photo.likes.push(req.user.id);
  wd('users.json', users);
  res.json({ liked: index < 0, likes: photo.likes.length });
});

app.put('/api/user/photos/order', userAuth, (req, res) => {
  const { photoIds } = req.body;
  if (!Array.isArray(photoIds) || photoIds.length > MAX_PROFILE_PHOTOS || photoIds.some(id => typeof id !== 'string') ||
      new Set(photoIds).size !== photoIds.length) {
    return res.status(400).json({ error: 'Invalid photo order' });
  }
  const users = rd('users.json');
  const account = users.find(user => user.id === req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  account.photos ||= [];
  if (photoIds.length !== account.photos.length || photoIds.some(id => !account.photos.some(photo => photo.id === id))) {
    return res.status(400).json({ error: 'Photo order must include every profile photo exactly once' });
  }
  const photosById = new Map(account.photos.map(photo => [photo.id, photo]));
  account.photos = photoIds.map(id => photosById.get(id));
  wd('users.json', users);
  res.json({ photos: account.photos });
});

app.get('/api/social/feed', userAuth, (req, res) => {
  const posts = rd('users.json')
    .filter(account => account.role === 'user' && !account.banned)
    .flatMap(account => (Array.isArray(account.photos) ? account.photos : [])
      .filter(photo => photo && typeof photo.id === 'string' &&
        typeof photo.image === 'string' && photo.image.length <= 90000)
      .map(photo => ({
        id: photo.id,
        image: photo.image,
        caption: typeof photo.caption === 'string' ? photo.caption : '',
        createdAt: photo.createdAt || '',
        likes: Array.isArray(photo.likes) ? photo.likes.length : 0,
        liked: Array.isArray(photo.likes) && photo.likes.includes(req.user.id),
        author: safeProfile(account),
      })))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 60);
  res.json(posts);
});

const reelsCache = new Map();
app.get('/api/social/reels', userAuth, async (req, res) => {
  const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : '';
  if (pageToken.length > 500) return res.status(400).json({ error: 'Invalid page token' });
  try {
    const config = rd('config.json');
    const query = String(config.ytReelsQuery || 'music #shorts').trim().slice(0, 100);
    const cacheKey = `${query}:${pageToken}`;
    const cached = reelsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);
    const key = process.env.YOUTUBE_API_KEY || config.ytApiKey;
    if (!key) return res.status(503).json({ error: 'YouTube API key is required to load Reels. Ask the Super Admin to configure it.' });
    const params = new URLSearchParams({
      part: 'snippet',
      q: query.toLocaleLowerCase().includes('#shorts') ? query : `${query} #shorts`,
      type: 'video',
      videoDuration: 'short',
      videoEmbeddable: 'true',
      order: 'date',
      maxResults: '15',
      key,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Could not load YouTube Shorts');
    }
    const result = {
      items: (data.items || []).flatMap(item => {
        const id = item.id?.videoId;
        if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return [];
        return [{
          id,
          title: String(item.snippet?.title || 'YouTube Short').slice(0, 200),
          channel: String(item.snippet?.channelTitle || 'YouTube creator').slice(0, 120),
          publishedAt: item.snippet?.publishedAt || '',
          thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
        }];
      }),
      nextPageToken: data.nextPageToken || null,
    };
    if (reelsCache.size >= 100) reelsCache.delete(reelsCache.keys().next().value);
    reelsCache.set(cacheKey, { data: result, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json(result);
  } catch (error) {
    console.error('YouTube Reels request failed:', error.message);
    res.status(502).json({ error: 'Unable to load YouTube Reels right now. Please try again later.' });
  }
});

// ══════════════════════════════════════════════════════
//  FRIENDS
// ══════════════════════════════════════════════════════

const safeProfile = user => ({ id: user.id, name: user.name, avatar: user.avatar || '' });
const getFriendship = (friends, first, second) => friends.find(relation =>
  (relation.user1 === first && relation.user2 === second) ||
  (relation.user1 === second && relation.user2 === first),
);
const areFriends = (first, second) => rd('friends.json').some(relation =>
  relation.status === 'accepted' &&
  ((relation.user1 === first && relation.user2 === second) || (relation.user1 === second && relation.user2 === first)),
);
const getSocialState = () => {
  const state = rd('social.json');
  state.listenRooms ||= [];
  state.games ||= [];
  state.roomMessages ||= {};
  state.chatPlayback ||= {};
  state.notificationReads ||= {};
  state.callSignals ||= [];
  return state;
};
const randomCode = used => {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (used.has(code));
  return code;
};
const validSong = song => song && /^[\w-]{11}$/.test(song.id) && typeof song.title === 'string' && song.title.trim().length <= 160;
const cleanSong = song => ({
  id: song.id,
  title: song.title.trim(),
  artist: String(song.artist || 'YouTube').trim().slice(0, 120),
  thumb: `https://img.youtube.com/vi/${song.id}/mqdefault.jpg`,
});
const memberOf = (room, userId) => room.members.some(member => member.id === userId);

app.get('/api/social/overview', userAuth, (req, res) => {
  const users = rd('users.json');
  const relations = rd('friends.json');
  const friends = relations.filter(relation => relation.status === 'accepted' && (relation.user1 === req.user.id || relation.user2 === req.user.id))
    .map(relation => {
      const friendId = relation.user1 === req.user.id ? relation.user2 : relation.user1;
      const account = users.find(user => user.id === friendId && !user.banned);
      return account ? { ...safeProfile(account), relationId: relation.id } : null;
    }).filter(Boolean);
  const requests = relations.filter(relation => relation.status === 'pending' && (relation.user1 === req.user.id || relation.user2 === req.user.id))
    .map(relation => {
      const incoming = relation.user2 === req.user.id;
      const account = users.find(user => user.id === (incoming ? relation.user1 : relation.user2));
      return account ? { ...safeProfile(account), id: relation.id, userId: account.id, direction: incoming ? 'incoming' : 'outgoing' } : null;
    }).filter(Boolean);
  const social = getSocialState();
  const messages = rd('messages.json');
  const lastMessages = Object.fromEntries(friends.flatMap(friend => {
    const conversation = messages[chatRoomId(req.user.id, friend.id)] || [];
    const latest = conversation[conversation.length - 1];
    return latest ? [[friend.id, {
      from: latest.from,
      text: latest.type === 'audio' ? 'Voice message' : latest.type === 'photo' ? 'Photo' : latest.text,
      ts: latest.ts,
    }]] : [];
  }));
  const rooms = social.listenRooms.filter(room => memberOf(room, req.user.id))
    .map(room => ({ code: room.code, hostId: room.hostId, hostName: room.hostName, song: room.song, members: room.members }));
  const games = social.games.filter(game => memberOf(game, req.user.id) && game.status !== 'closed')
    .map(game => ({ code: game.code, hostName: game.hostName, status: game.status, members: game.members }));
  const gameInvites = social.games.filter(game =>
    game.invitedUserId === req.user.id && game.status === 'waiting' && game.createdAt > Date.now() - 86400000 &&
    areFriends(game.hostId, req.user.id),
  ).map(game => ({ code: game.code, hostId: game.hostId, hostName: game.hostName, createdAt: game.createdAt }));
  const roomInvites = social.listenRooms.filter(room =>
    room.invitedUserId === req.user.id && room.createdAt > Date.now() - 86400000 &&
    areFriends(room.hostId, req.user.id),
  ).map(room => ({ code: room.code, hostId: room.hostId, hostName: room.hostName, song: room.song, createdAt: room.createdAt }));
  res.json({ friends, requests, rooms, games, gameInvites, roomInvites, lastMessages });
});

app.get('/api/notifications', userAuth, (req, res) => {
  const users = rd('users.json');
  const relations = rd('friends.json');
  const social = getSocialState();
  const messages = rd('messages.json');
  const notifications = [];
  const friends = relations
    .filter(relation => relation.status === 'accepted' && (relation.user1 === req.user.id || relation.user2 === req.user.id))
    .map(relation => {
      const friendId = relation.user1 === req.user.id ? relation.user2 : relation.user1;
      const account = users.find(user => user.id === friendId && !user.banned);
      return account ? { id: friendId, name: account.name } : null;
    }).filter(Boolean);

  relations.filter(relation => relation.status === 'pending' && relation.user2 === req.user.id).forEach(relation => {
    const account = users.find(user => user.id === relation.user1 && !user.banned);
    if (account) notifications.push({
      id: `friend:${relation.id}`,
      type: 'friend',
      title: 'Friend request',
      body: `${account.name} sent you a friend request`,
      createdAt: relation.createdAt,
    });
  });

  social.games.filter(game =>
    game.invitedUserId === req.user.id && game.status === 'waiting' &&
    game.createdAt > Date.now() - 86400000 && areFriends(game.hostId, req.user.id),
  ).forEach(game => notifications.push({
    id: `game:${game.code}`,
    type: 'game',
    title: 'Game invitation',
    body: `${game.hostName} invited you to play`,
    friendId: game.hostId,
    code: game.code,
    createdAt: game.createdAt,
  }));

  social.listenRooms.filter(room =>
    room.invitedUserId === req.user.id && room.createdAt > Date.now() - 86400000 &&
    areFriends(room.hostId, req.user.id),
  ).forEach(room => notifications.push({
    id: `room:${room.code}`,
    type: 'room',
    title: 'Listening invitation',
    body: `${room.hostName} invited you to listen to ${room.song?.title || 'a song'}`,
    friendId: room.hostId,
    code: room.code,
    createdAt: room.createdAt,
  }));

  const readByFriend = social.notificationReads[req.user.id] || {};
  friends.forEach(friend => {
    const conversation = messages[chatRoomId(req.user.id, friend.id)] || [];
    const latestIncoming = [...conversation].reverse().find(message => message.from === friend.id);
    if (latestIncoming && latestIncoming.ts > (Number(readByFriend[friend.id]) || 0)) {
      const body = latestIncoming.type === 'audio' ? 'Sent you a voice message'
        : latestIncoming.type === 'photo' ? 'Shared a photo with you'
          : latestIncoming.text;
      notifications.push({
        id: `message:${friend.id}:${latestIncoming.id}`,
        type: 'message',
        title: friend.name,
        body,
        friendId: friend.id,
        createdAt: latestIncoming.ts,
      });
    }
  });

  notifications.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ notifications: notifications.slice(0, 50) });
});

app.post('/api/notifications/read/:friendId', userAuth, (req, res) => {
  const friendId = req.params.friendId;
  if (!areFriends(req.user.id, friendId)) return res.status(403).json({ error: 'Chat is available to friends only' });
  const room = chatRoomId(req.user.id, friendId);
  const latestIncoming = [...(rd('messages.json')[room] || [])].reverse()
    .find(message => message.from === friendId);
  if (latestIncoming) {
    const social = getSocialState();
    social.notificationReads[req.user.id] ||= {};
    social.notificationReads[req.user.id][friendId] = Math.max(
      Number(social.notificationReads[req.user.id][friendId]) || 0,
      latestIncoming.ts,
    );
    wd('social.json', social);
  }
  res.json({ ok: true });
});

app.get('/api/users/suggestions', userAuth, (req, res) => {
  const users = rd('users.json');
  const relations = rd('friends.json');
  const accepted = relations.filter(relation => relation.status === 'accepted');
  const friendsByUser = new Map();
  accepted.forEach(relation => {
    if (!friendsByUser.has(relation.user1)) friendsByUser.set(relation.user1, new Set());
    if (!friendsByUser.has(relation.user2)) friendsByUser.set(relation.user2, new Set());
    friendsByUser.get(relation.user1).add(relation.user2);
    friendsByUser.get(relation.user2).add(relation.user1);
  });
  const myFriends = friendsByUser.get(req.user.id) || new Set();
  const connected = new Set(relations
    .filter(relation => relation.user1 === req.user.id || relation.user2 === req.user.id)
    .map(relation => relation.user1 === req.user.id ? relation.user2 : relation.user1));
  const suggestions = users
    .filter(account => account.id !== req.user.id && !account.banned && account.role === 'user' && !connected.has(account.id))
    .map(account => {
      const friendIds = friendsByUser.get(account.id) || new Set();
      const mutualFriends = [...myFriends].filter(id => friendIds.has(id)).length;
      return { ...safeProfile(account), relation: 'none', mutualFriends, createdAt: account.createdAt || '' };
    })
    .sort((a, b) => b.mutualFriends - a.mutualFriends || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 12)
    .map(({ createdAt, ...profile }) => profile);
  res.json(suggestions);
});

app.get('/api/users/:userId/profile', userAuth, (req, res) => {
  const account = rd('users.json').find(user => user.id === req.params.userId && !user.banned && user.role === 'user');
  if (!account) return res.status(404).json({ error: 'Profile not found' });
  const relation = getFriendship(rd('friends.json'), req.user.id, account.id);
  res.json({
    ...safeProfile(account),
    bio: account.bio || '',
    photos: Array.isArray(account.photos) ? account.photos : [],
    createdAt: account.createdAt || '',
    totalPlays: account.totalPlays || 0,
    relation: relation?.status === 'accepted' ? 'friends'
      : relation?.status === 'pending' ? (relation.user1 === req.user.id ? 'sent' : 'received')
        : 'none',
  });
});

app.get('/api/users/search', userAuth, (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase() : '';
  if (query.length < 2) return res.json([]);
  const users = rd('users.json');
  const friends = rd('friends.json');
  const results = users
    .filter(account => account.id !== req.user.id && !account.banned && account.role === 'user' &&
      (String(account.name || '').toLocaleLowerCase().includes(query) || String(account.email || '').toLocaleLowerCase().includes(query)))
    .slice(0, 20)
    .map(account => {
      const relation = getFriendship(friends, req.user.id, account.id);
      return {
        ...safeProfile(account),
        relation: relation?.status === 'accepted' ? 'friends'
          : relation?.status === 'pending' ? (relation.user1 === req.user.id ? 'sent' : 'received')
            : 'none',
        requestId: relation?.status === 'pending' && relation.user2 === req.user.id ? relation.id : null,
      };
    });
  res.json(results);
});

app.get('/api/friends', userAuth, (req, res) => {
  const users = rd('users.json');
  const list = rd('friends.json')
    .filter(relation => relation.status === 'accepted' && (relation.user1 === req.user.id || relation.user2 === req.user.id))
    .map(relation => {
      const friendId = relation.user1 === req.user.id ? relation.user2 : relation.user1;
      const account = users.find(user => user.id === friendId && !user.banned);
      return account ? { ...safeProfile(account), relationId: relation.id } : null;
    })
    .filter(Boolean);
  res.json(list);
});

app.get('/api/friends/requests', userAuth, (req, res) => {
  const users = rd('users.json');
  const requests = rd('friends.json').filter(relation =>
    relation.status === 'pending' && (relation.user1 === req.user.id || relation.user2 === req.user.id),
  ).map(relation => {
    const incoming = relation.user2 === req.user.id;
    const account = users.find(user => user.id === (incoming ? relation.user1 : relation.user2));
    return account ? { ...safeProfile(account), id: relation.id, direction: incoming ? 'incoming' : 'outgoing' } : null;
  }).filter(Boolean);
  res.json(requests);
});

app.post('/api/friends/request/:toId', userAuth, (req, res) => {
  const target = rd('users.json').find(account => account.id === req.params.toId && account.role === 'user' && !account.banned);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself' });
  const friends = rd('friends.json');
  const existing = getFriendship(friends, req.user.id, target.id);
  if (existing) return res.status(409).json({ error: existing.status === 'accepted' ? 'Already friends' : 'A request already exists' });
  const relation = {
    id: `fr_${crypto.randomUUID()}`,
    user1: req.user.id,
    user1Name: req.user.name,
    user2: target.id,
    status: 'pending',
    createdAt: Date.now(),
  };
  friends.push(relation);
  wd('friends.json', friends);
  res.status(201).json({ ok: true, requestId: relation.id });
});

app.put('/api/friends/:id', userAuth, (req, res) => {
  if (!['accepted', 'rejected'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' });
  }
  const friends = rd('friends.json');
  const index = friends.findIndex(relation => relation.id === req.params.id);
  if (index < 0 || friends[index].user2 !== req.user.id || friends[index].status !== 'pending') {
    return res.status(404).json({ error: 'Friend request not found' });
  }
  if (req.body.status === 'rejected') friends.splice(index, 1);
  else friends[index].status = 'accepted';
  wd('friends.json', friends);
  res.json({ ok: true });
});

app.delete('/api/friends/:id', userAuth, (req, res) => {
  const friends = rd('friends.json');
  const relation = friends.find(item => item.id === req.params.id && item.status === 'accepted' &&
    (item.user1 === req.user.id || item.user2 === req.user.id));
  if (!relation) return res.status(404).json({ error: 'Friendship not found' });
  wd('friends.json', friends.filter(item => item.id !== relation.id));
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════════════════
function chatRoomId(a, b) { return [a, b].sort().join(':'); }

function currentChatPlayback(playback) {
  if (!playback) return null;
  return {
    ...playback,
    position: playback.position + (playback.playing ? (Date.now() - playback.stateChangedAt) / 1000 : 0),
  };
}

app.get('/api/chat/:friendId/playback', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Shared playback is available to friends only' });
  const playback = getSocialState().chatPlayback[chatRoomId(req.user.id, req.params.friendId)];
  res.json({ playback: playback && Date.now() - playback.updatedAt < 24 * 60 * 60 * 1000 ? currentChatPlayback(playback) : null });
});

app.put('/api/chat/:friendId/playback', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Shared playback is available to friends only' });
  const social = getSocialState();
  const roomId = chatRoomId(req.user.id, req.params.friendId);
  const action = req.body.action;
  if (!['song', 'play', 'pause', 'seek'].includes(action)) return res.status(400).json({ error: 'Invalid playback action' });
  let playback = social.chatPlayback[roomId];
  if (action === 'song') {
    if (!validSong(req.body.song)) return res.status(400).json({ error: 'Choose a valid song first' });
    playback = {
      song: cleanSong(req.body.song),
      playing: true,
      position: 0,
      stateChangedAt: Date.now(),
    };
  } else {
    if (!playback) return res.status(404).json({ error: 'Choose a song to start shared playback' });
    const position = Number(req.body.position);
    if (!Number.isFinite(position) || position < 0 || position > 86400) {
      return res.status(400).json({ error: 'Invalid playback position' });
    }
    const currentPosition = playback.position + (playback.playing ? (Date.now() - playback.stateChangedAt) / 1000 : 0);
    playback.position = action === 'pause' || action === 'seek' ? position : currentPosition;
    playback.playing = action === 'play';
    playback.stateChangedAt = Date.now();
  }
  playback.updatedAt = Date.now();
  playback.updatedBy = req.user.id;
  social.chatPlayback[roomId] = playback;
  wd('social.json', social);
  res.json({ playback: currentChatPlayback(playback) });
});

app.get('/api/chat/:friendId', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Chat is available to friends only' });
  const msgs = rd('messages.json');
  const users = rd('users.json');
  const photos = new Map(users.flatMap(account =>
    (Array.isArray(account.photos) ? account.photos : []).map(photo => [photo.id, { photo, account }]),
  ));
  const room = chatRoomId(req.user.id, req.params.friendId);
  const after = Number(req.query.after) || 0;
  const conversation = msgs[room] || [];
  const changedPhotos = conversation.filter(message => message.type === 'photo' && !photos.has(message.photoId));
  const recentMessages = conversation.filter(message => message.ts > after).slice(-100);
  const selectedMessages = [...new Map([...changedPhotos, ...recentMessages].map(message => [message.id, message])).values()]
    .sort((a, b) => a.ts - b.ts);
  res.json(selectedMessages.map(message => {
    if (message.type === 'audio') {
      const { audioData, ...metadata } = message;
      return metadata;
    }
    if (message.type === 'photo') {
      const owner = photos.get(message.photoId);
      return {
        ...message,
        photo: owner ? {
          id: owner.photo.id,
          image: owner.photo.image,
          caption: owner.photo.caption || '',
          author: safeProfile(owner.account),
        } : null,
      };
    }
    return message;
  }));
});

app.get('/api/chat/:friendId/:messageId/audio', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Chat is available to friends only' });
  const room = chatRoomId(req.user.id, req.params.friendId);
  const message = (rd('messages.json')[room] || []).find(item => item.id === req.params.messageId && item.type === 'audio');
  if (!message) return res.status(404).json({ error: 'Voice message not found' });
  res.set('Cache-Control', 'private, no-store');
  res.type(message.mimeType).send(Buffer.from(message.audioData, 'base64'));
});

app.post('/api/chat/:friendId', userAuth, (req, res) => {
  try {
    if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Chat is available to friends only' });
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    let messageContent;
    if (req.body.type === 'audio') {
      const { audioData, mimeType, duration } = req.body;
      const allowedTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac']);
      if (typeof audioData !== 'string' || audioData.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioData)) {
        return res.status(400).json({ error: 'Voice message is too large or invalid' });
      }
      if (!allowedTypes.has(mimeType)) return res.status(400).json({ error: 'Unsupported voice message format' });
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
        return res.status(400).json({ error: 'Voice messages must be 60 seconds or shorter' });
      }
      const decodedSize = Buffer.from(audioData, 'base64').length;
      if (!decodedSize || decodedSize > 1024 * 1024) return res.status(400).json({ error: 'Voice message must be 1 MB or smaller' });
      messageContent = { type: 'audio', audioData, mimeType, duration };
    } else if (req.body.type === 'photo') {
      const photoId = req.body.photoId;
      if (typeof photoId !== 'string' || !/^[a-f\d]{24}$/i.test(photoId)) {
        return res.status(400).json({ error: 'Choose a valid photo to share' });
      }
      const owner = rd('users.json').find(account =>
        !account.banned && account.role === 'user' &&
        (Array.isArray(account.photos) ? account.photos : []).some(photo => photo.id === photoId),
      );
      if (!owner) return res.status(404).json({ error: 'Photo not found' });
      messageContent = { type: 'photo', photoId };
    } else {
      if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
      if (text.length > 1000) return res.status(400).json({ error: 'Message must be 1000 characters or fewer' });
      messageContent = { type: 'text', text };
    }
    const msgs = rd('messages.json');
    const room = chatRoomId(req.user.id, req.params.friendId);
    if (!msgs[room]) msgs[room] = [];
    const msg = { id: `m_${crypto.randomUUID()}`, from: req.user.id, fromName: req.user.name, ...messageContent, ts: Date.now() };
    msgs[room].push(msg);
    if (msgs[room].length > 300) msgs[room] = msgs[room].slice(-300);
    wd('messages.json', msgs);
    if (msg.type === 'audio') {
      const { audioData, ...metadata } = msg;
      return res.status(201).json(metadata);
    }
    res.status(201).json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/chat/:friendId/:messageId/reaction', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Chat is available to friends only' });
  const allowedReactions = new Set(['heart', 'laugh', 'thumb-up', 'surprised', 'sad']);
  const reaction = req.body.reaction;
  if (!allowedReactions.has(reaction)) return res.status(400).json({ error: 'Choose a supported reaction' });
  const messages = rd('messages.json');
  const room = chatRoomId(req.user.id, req.params.friendId);
  const message = (messages[room] || []).find(item => item.id === req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  message.reactions ||= {};
  message.reactions[reaction] ||= [];
  const current = message.reactions[reaction];
  const index = current.indexOf(req.user.id);
  if (index >= 0) current.splice(index, 1);
  else current.push(req.user.id);
  if (!current.length) delete message.reactions[reaction];
  wd('messages.json', messages);
  res.json({ reactions: message.reactions });
});

app.get('/api/calls/signals', userAuth, (req, res) => {
  const social = getSocialState();
  const cutoff = Date.now() - 15 * 60 * 1000;
  social.callSignals = social.callSignals.filter(signal => signal.ts >= cutoff).slice(-500);
  res.json(social.callSignals.filter(signal => signal.to === req.user.id).slice(-100));
});

app.get('/api/calls/config', userAuth, (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || process.env.TURN_URL || '').split(',').map(url => url.trim()).filter(Boolean);
  if (turnUrls.length && process.env.TURN_SECRET) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const username = `${expiresAt}:${req.user.id}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  res.json({ iceServers });
});

app.post('/api/calls/:friendId/signal', userAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.friendId)) return res.status(403).json({ error: 'Calls are available to friends only' });
  const { type, sessionId, description, candidate } = req.body;
  if (!['offer', 'answer', 'ice', 'reject', 'end'].includes(type)) {
    return res.status(400).json({ error: 'Invalid call signal' });
  }
  if (typeof sessionId !== 'string' || !/^[\w-]{8,80}$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid call session' });
  }
  const event = {
    id: crypto.randomUUID(),
    from: req.user.id,
    to: req.params.friendId,
    type,
    sessionId,
    ts: Date.now(),
  };
  if (type === 'offer' || type === 'answer') {
    if (!description || description.type !== type || typeof description.sdp !== 'string' || description.sdp.length > 20000) {
      return res.status(400).json({ error: 'Invalid call description' });
    }
    event.description = { type: description.type, sdp: description.sdp };
  }
  if (type === 'ice') {
    if (candidate !== null && (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 2048)) {
      return res.status(400).json({ error: 'Invalid network candidate' });
    }
    if (candidate && (
      (candidate.sdpMid !== undefined && candidate.sdpMid !== null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) ||
      (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0)) ||
      (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null && (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256))
    )) return res.status(400).json({ error: 'Invalid network candidate' });
    event.candidate = candidate === null ? null : {
      candidate: candidate.candidate,
      ...(candidate.sdpMid !== undefined ? { sdpMid: candidate.sdpMid } : {}),
      ...(candidate.sdpMLineIndex !== undefined ? { sdpMLineIndex: candidate.sdpMLineIndex } : {}),
      ...(candidate.usernameFragment !== undefined ? { usernameFragment: candidate.usernameFragment } : {}),
    };
  }
  const social = getSocialState();
  social.callSignals = social.callSignals.filter(signal => signal.ts > Date.now() - 15 * 60 * 1000).slice(-499);
  social.callSignals.push(event);
  wd('social.json', social);
  res.status(201).json({ ok: true, id: event.id });
});

app.get('/api/listen-rooms', userAuth, (req, res) => {
  const rooms = getSocialState().listenRooms.filter(room => room.members.some(member => member.id === req.user.id));
  res.json(rooms.map(room => ({ code: room.code, hostId: room.hostId, hostName: room.hostName, song: room.song, members: room.members })));
});

app.post('/api/listen-rooms', userAuth, (req, res) => {
  if (!validSong(req.body.song)) return res.status(400).json({ error: 'Choose a valid song first' });
  const social = getSocialState();
  social.listenRooms = social.listenRooms.filter(room => Date.now() - room.createdAt < 86400000);
  if (social.listenRooms.length >= 100) return res.status(429).json({ error: 'There are too many active listening rooms; try again later' });
  const invitee = req.body.inviteeId
    ? rd('users.json').find(account => account.id === req.body.inviteeId && account.role === 'user' && !account.banned)
    : null;
  if (req.body.inviteeId && !invitee) return res.status(404).json({ error: 'Friend not found' });
  if (invitee && !areFriends(req.user.id, invitee.id)) {
    return res.status(403).json({ error: 'You must be friends before inviting someone to listen' });
  }
  if (invitee && social.listenRooms.some(room =>
    room.hostId === req.user.id && room.invitedUserId === invitee.id,
  )) {
    return res.status(409).json({ error: 'You already have a pending listening invite for this friend' });
  }
  const used = new Set(social.listenRooms.map(room => room.code));
  const room = {
    code: randomCode(used),
    hostId: req.user.id,
    hostName: req.user.name,
    ...(invitee ? { invitedUserId: invitee.id, invitedUserName: invitee.name } : {}),
    song: cleanSong(req.body.song),
    playing: false,
    position: 0,
    stateChangedAt: Date.now(),
    members: [{ id: req.user.id, name: req.user.name }],
    createdAt: Date.now(),
  };
  social.listenRooms.push(room);
  wd('social.json', social);
  res.status(201).json(room);
});

app.post('/api/listen-rooms/:code/join', userAuth, (req, res) => {
  const social = getSocialState();
  const room = social.listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Listening room not found' });
  if (room.invitedUserId && room.invitedUserId !== req.user.id) {
    return res.status(403).json({ error: 'This listening invite was sent to someone else' });
  }
  if (room.hostId !== req.user.id && !areFriends(room.hostId, req.user.id)) {
    return res.status(403).json({ error: 'You must be friends with the host to join' });
  }
  if (!memberOf(room, req.user.id)) {
    if (room.members.length >= 10) return res.status(409).json({ error: 'Listening room is full' });
    room.members.push({ id: req.user.id, name: req.user.name });
    delete room.invitedUserId;
    delete room.invitedUserName;
    wd('social.json', social);
  }
  res.json(room);
});

app.post('/api/listen-rooms/:code/decline', userAuth, (req, res) => {
  const social = getSocialState();
  const room = social.listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room || room.invitedUserId !== req.user.id) {
    return res.status(404).json({ error: 'Listening invite not found' });
  }
  delete room.invitedUserId;
  delete room.invitedUserName;
  wd('social.json', social);
  res.json({ ok: true });
});

app.get('/api/listen-rooms/:code', userAuth, (req, res) => {
  const room = getSocialState().listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room || !memberOf(room, req.user.id)) return res.status(404).json({ error: 'Listening room not found' });
  const position = room.position + (room.playing ? (Date.now() - room.stateChangedAt) / 1000 : 0);
  const messages = getSocialState().roomMessages[room.code] || [];
  res.json({ ...room, position, messages: messages.slice(-50) });
});

app.put('/api/listen-rooms/:code', userAuth, (req, res) => {
  const social = getSocialState();
  const room = social.listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room || room.hostId !== req.user.id) return res.status(404).json({ error: 'Listening room not found' });
  const action = req.body.action;
  if (!['play', 'pause', 'seek', 'song'].includes(action)) return res.status(400).json({ error: 'Invalid room action' });
  const currentPosition = room.position + (room.playing ? (Date.now() - room.stateChangedAt) / 1000 : 0);
  if (action === 'song') {
    if (!validSong(req.body.song)) return res.status(400).json({ error: 'Choose a valid song' });
    room.song = cleanSong(req.body.song);
    room.position = 0;
    room.playing = true;
  } else {
    const position = Number(req.body.position);
    if (!Number.isFinite(position) || position < 0 || position > 86400) {
      return res.status(400).json({ error: 'Invalid playback position' });
    }
    room.position = action === 'pause' ? position : action === 'seek' ? position : currentPosition;
    room.playing = action === 'play';
  }
  room.stateChangedAt = Date.now();
  wd('social.json', social);
  res.json({ ok: true });
});

app.post('/api/listen-rooms/:code/chat', userAuth, (req, res) => {
  const social = getSocialState();
  const room = social.listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room || !memberOf(room, req.user.id)) return res.status(404).json({ error: 'Listening room not found' });
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters' });
  const messages = social.roomMessages[room.code] || [];
  const message = { id: `m_${crypto.randomUUID()}`, from: req.user.id, fromName: req.user.name, text, ts: Date.now() };
  messages.push(message);
  social.roomMessages[room.code] = messages.slice(-100);
  wd('social.json', social);
  res.status(201).json(message);
});

app.delete('/api/listen-rooms/:code', userAuth, (req, res) => {
  const social = getSocialState();
  const room = social.listenRooms.find(item => item.code === req.params.code.toUpperCase());
  if (!room || !memberOf(room, req.user.id)) return res.status(404).json({ error: 'Listening room not found' });
  if (room.hostId === req.user.id) {
    social.listenRooms = social.listenRooms.filter(item => item.code !== room.code);
    delete social.roomMessages[room.code];
  } else {
    room.members = room.members.filter(member => member.id !== req.user.id);
  }
  wd('social.json', social);
  res.json({ ok: true });
});

const ticTacToeWins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

app.get('/api/games', userAuth, (req, res) => {
  const games = getSocialState().games.filter(game => game.members.some(member => member.id === req.user.id) && game.status !== 'closed');
  res.json(games.map(game => ({ code: game.code, hostName: game.hostName, status: game.status, members: game.members })));
});

app.post('/api/games', userAuth, (req, res) => {
  const social = getSocialState();
  social.games = social.games.filter(game => Date.now() - game.createdAt < 7 * 86400000);
  if (social.games.length >= 300) return res.status(429).json({ error: 'There are too many active games; try again later' });
  const invitee = req.body.inviteeId
    ? rd('users.json').find(account => account.id === req.body.inviteeId && account.role === 'user' && !account.banned)
    : null;
  if (req.body.inviteeId && !invitee) return res.status(404).json({ error: 'Friend not found' });
  if (invitee && !areFriends(req.user.id, invitee.id)) {
    return res.status(403).json({ error: 'You must be friends before sending a game challenge' });
  }
  if (invitee && social.games.some(game =>
    game.hostId === req.user.id && game.invitedUserId === invitee.id && game.status === 'waiting',
  )) {
    return res.status(409).json({ error: 'You already have a pending game challenge for this friend' });
  }
  const code = randomCode(new Set(social.games.map(game => game.code)));
  const game = {
    code,
    hostId: req.user.id,
    hostName: req.user.name,
    ...(invitee ? { invitedUserId: invitee.id, invitedUserName: invitee.name } : {}),
    members: [{ id: req.user.id, name: req.user.name, symbol: 'X' }],
    board: Array(9).fill(null),
    turn: req.user.id,
    winner: null,
    status: 'waiting',
    createdAt: Date.now(),
  };
  social.games.push(game);
  wd('social.json', social);
  res.status(201).json(game);
});

app.post('/api/games/:code/join', userAuth, (req, res) => {
  const social = getSocialState();
  const game = social.games.find(item => item.code === req.params.code.toUpperCase() && item.status !== 'closed');
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.hostId !== req.user.id && !areFriends(game.hostId, req.user.id)) {
    return res.status(403).json({ error: 'You must be friends with the host to join' });
  }
  if (game.invitedUserId && game.invitedUserId !== req.user.id) {
    return res.status(403).json({ error: 'This game challenge was sent to someone else' });
  }
  if (memberOf(game, req.user.id)) return res.json(game);
  if (game.status !== 'waiting' || game.members.length >= 2) return res.status(409).json({ error: 'Game is full or already started' });
  game.members.push({ id: req.user.id, name: req.user.name, symbol: 'O' });
  game.status = 'playing';
  delete game.invitedUserId;
  delete game.invitedUserName;
  wd('social.json', social);
  res.json(game);
});

app.post('/api/games/:code/decline', userAuth, (req, res) => {
  const social = getSocialState();
  const game = social.games.find(item => item.code === req.params.code.toUpperCase());
  if (!game || game.invitedUserId !== req.user.id || game.status !== 'waiting') {
    return res.status(404).json({ error: 'Game challenge not found' });
  }
  social.games = social.games.filter(item => item.code !== game.code);
  wd('social.json', social);
  res.json({ ok: true });
});

app.get('/api/games/:code', userAuth, (req, res) => {
  const game = getSocialState().games.find(item => item.code === req.params.code.toUpperCase() && item.status !== 'closed');
  if (!game || !memberOf(game, req.user.id)) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

app.post('/api/games/:code/moves', userAuth, (req, res) => {
  const social = getSocialState();
  const game = social.games.find(item => item.code === req.params.code.toUpperCase() && item.status !== 'closed');
  const index = req.body.index;
  if (!game || !memberOf(game, req.user.id)) return res.status(404).json({ error: 'Game not found' });
  if (game.status !== 'playing') return res.status(409).json({ error: 'Game is not in progress' });
  if (!Number.isInteger(index) || index < 0 || index > 8) return res.status(400).json({ error: 'Invalid move' });
  if (game.turn !== req.user.id) return res.status(409).json({ error: 'It is not your turn' });
  if (game.board[index] !== null) return res.status(409).json({ error: 'That square is already taken' });
  const player = game.members.find(member => member.id === req.user.id);
  game.board[index] = player.symbol;
  const winningLine = ticTacToeWins.find(([a, b, c]) => game.board[a] && game.board[a] === game.board[b] && game.board[a] === game.board[c]);
  if (winningLine) {
    game.winner = req.user.id;
    game.winningLine = winningLine;
    game.status = 'done';
  } else if (game.board.every(Boolean)) {
    game.status = 'draw';
  } else {
    game.turn = game.members.find(member => member.id !== req.user.id).id;
  }
  wd('social.json', social);
  res.json(game);
});

app.post('/api/games/:code/reset', userAuth, (req, res) => {
  const social = getSocialState();
  const game = social.games.find(item => item.code === req.params.code.toUpperCase());
  if (!game || game.hostId !== req.user.id) return res.status(404).json({ error: 'Game not found' });
  if (game.members.length !== 2) return res.status(409).json({ error: 'Wait for another player before restarting' });
  game.board = Array(9).fill(null);
  game.turn = game.hostId;
  game.winner = null;
  delete game.winningLine;
  game.status = 'playing';
  wd('social.json', social);
  res.json(game);
});

app.delete('/api/games/:code', userAuth, (req, res) => {
  const social = getSocialState();
  const game = social.games.find(item => item.code === req.params.code.toUpperCase());
  if (!game || !memberOf(game, req.user.id)) return res.status(404).json({ error: 'Game not found' });
  if (game.hostId === req.user.id) {
    social.games = social.games.filter(item => item.code !== game.code);
  } else {
    game.members = game.members.filter(member => member.id !== req.user.id);
    game.board = Array(9).fill(null);
    game.turn = game.hostId;
    game.winner = null;
    delete game.winningLine;
    game.status = 'waiting';
  }
  wd('social.json', social);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const users  = rd('users.json');
  const plays  = rd('plays.json');
  const liked  = rd('liked.json');
  const totalUsers  = users.filter(u => u.role !== 'admin').length;
  const totalPlays  = plays.length;
  const totalLikes  = Object.values(liked).reduce((a, b) => a + b.length, 0);
  const bannedUsers = users.filter(u => u.banned).length;
  const songCount = {};
  plays.forEach(p => {
    if (!songCount[p.songId]) songCount[p.songId] = { count: 0, title: p.songTitle, artist: p.songArtist, thumb: p.thumb };
    songCount[p.songId].count++;
  });
  const topSongs = Object.entries(songCount).sort((a,b)=>b[1].count-a[1].count).slice(0,10).map(([id,v])=>({id,...v}));
  const now = Date.now();
  const days = Array.from({length:7},(_,i)=>{
    const d = new Date(now - i*86400000);
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }).reverse();
  const playsPerDay = days.map(label => ({ label, count: plays.filter(p => new Date(p.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric'}) === label).length }));
  const recent = plays.slice(-10).reverse().map(p => ({ user: users.find(u=>u.id===p.userId)?.name||'Unknown', song: p.songTitle, artist: p.songArtist, time: new Date(p.timestamp).toLocaleTimeString() }));
  res.json({ totalUsers, totalPlays, totalLikes, bannedUsers, topSongs, playsPerDay, recent });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  res.json(rd('users.json').map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, banned: u.banned, totalPlays: u.totalPlays||0 })));
});

app.put('/api/admin/users/:id', adminAuth, (req, res) => {
  const users = rd('users.json');
  const u = users.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.body.banned !== undefined) u.banned = req.body.banned;
  if (req.body.role) u.role = req.body.role;
  wd('users.json', users);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  let users = rd('users.json');
  users = users.filter(u => u.id !== req.params.id);
  wd('users.json', users);
  const liked = rd('liked.json');
  delete liked[req.params.id];
  wd('liked.json', liked);
  res.json({ ok: true });
});

app.get('/api/admin/config', superAdminAuth, (req, res) => {
  const config = rd('config.json');
  res.json({
    ytApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY || config.ytApiKey),
    ytReelsQuery: config.ytReelsQuery || 'music #shorts',
    featuredSongs: config.featuredSongs,
  });
});

app.put('/api/admin/config', superAdminAuth, (req, res) => {
  const cfg = rd('config.json');
  if (req.body.ytApiKey) cfg.ytApiKey = req.body.ytApiKey;
  if (req.body.featuredSongs) cfg.featuredSongs = req.body.featuredSongs;
  if (req.body.ytReelsQuery !== undefined) {
    if (typeof req.body.ytReelsQuery !== 'string' || !req.body.ytReelsQuery.trim() || req.body.ytReelsQuery.trim().length > 100) {
      return res.status(400).json({ error: 'Reels topic must be between 1 and 100 characters' });
    }
    cfg.ytReelsQuery = req.body.ytReelsQuery.trim();
    reelsCache.clear();
  }
  wd('config.json', cfg);
  res.json({ ok: true });
});

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Nymix listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
