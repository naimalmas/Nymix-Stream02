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

const app  = express();
const PORT = 3000;
const isVercel = Boolean(process.env.VERCEL);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data Helpers ──────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!isVercel) fs.mkdirSync(dataDir, { recursive: true });
const dp  = f  => path.join(dataDir, f);
const requestState = new AsyncLocalStorage();
const rd = f => {
  const state = requestState.getStore();
  return state ? state[f] : JSON.parse(fs.readFileSync(dp(f), 'utf8'));
};
const wd = (f, data) => {
  const state = requestState.getStore();
  if (state) state[f] = data;
  else fs.writeFileSync(dp(f), JSON.stringify(data, null, 2));
};

if (!isVercel) {
  [['config.json', 'config.example.json'], ['users.json', 'users.example.json'], ['liked.json', 'liked.example.json'], ['plays.json', 'plays.example.json']]
    .forEach(([file, example]) => { if (!fs.existsSync(dp(file))) fs.copyFileSync(dp(example), dp(file)); });
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
        plays jsonb NOT NULL
      )`);
      const existing = await database.query('SELECT id FROM nymix_state WHERE id = 1');
      if (existing.rowCount) return;
      if (!process.env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD.length < 12) {
        throw new Error('SUPER_ADMIN_PASSWORD (at least 12 characters) must be configured in Vercel');
      }
      const seed = name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      const config = seed('config.example.json');
      if (process.env.YOUTUBE_API_KEY) config.ytApiKey = process.env.YOUTUBE_API_KEY;
      const users = seed('users.example.json');
      const superAdmin = users.find(user => user.id === 'admin_001');
      superAdmin.role = 'super_admin';
      superAdmin.password = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 10);
      await database.query(
        'INSERT INTO nymix_state (id, config, users, liked, plays) VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb) ON CONFLICT (id) DO NOTHING',
        [JSON.stringify(config), JSON.stringify(users), JSON.stringify(seed('liked.example.json')), JSON.stringify(seed('plays.example.json'))],
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
    const result = await client.query('SELECT config, users, liked, plays FROM nymix_state WHERE id = 1 FOR UPDATE');
    if (!result.rowCount) throw new Error('Application database state is not initialized');
    const state = {
      'config.json': result.rows[0].config,
      'users.json': result.rows[0].users,
      'liked.json': result.rows[0].liked,
      'plays.json': result.rows[0].plays,
    };
    let finished = false;
    const sendJson = res.json.bind(res);
    res.json = body => {
      if (finished) return res;
      finished = true;
      (async () => {
        try {
          await client.query(
            'UPDATE nymix_state SET config = $1::jsonb, users = $2::jsonb, liked = $3::jsonb, plays = $4::jsonb WHERE id = 1',
            [JSON.stringify(state['config.json']), JSON.stringify(state['users.json']), JSON.stringify(state['liked.json']), JSON.stringify(state['plays.json'])],
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
const adminAuth = roleAuth('admin', 'super_admin');
const superAdminAuth = roleAuth('super_admin');

// ══════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });

    const users = rd('users.json');
    if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: 'u_' + Date.now(),
      name, email,
      password: hash,
      role: 'user',
      avatar: '',
      createdAt: new Date().toISOString(),
      banned: false,
      totalPlays: 0,
    };
    users.push(user);
    wd('users.json', users);

    const liked = rd('liked.json');
    liked[user.id] = [];
    wd('liked.json', liked);

    const token = jwt.sign({ id: user.id, name, email, role: 'user' }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name, email, role: 'user', avatar: '' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = rd('users.json');
    const user  = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.banned) return res.status(403).json({ error: 'Account banned' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, name: user.name, email, role: user.role }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, avatar: user.avatar } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const users = rd('users.json');
  const user  = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar, createdAt: user.createdAt, totalPlays: user.totalPlays });
});

// ══════════════════════════════════════════════════════
//  MUSIC ROUTES
// ══════════════════════════════════════════════════════

// GET /api/search?q=...
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'Query required' });
  const { pageToken } = req.query;
  if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 500)) {
    return res.status(400).json({ error: 'Invalid page token' });
  }
  try {
    const cfg = rd('config.json');
    const key = cfg.ytApiKey || process.env.YOUTUBE_API_KEY;
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
    const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
    const r   = await fetch(url);
    const d   = await r.json();
    if (d.error) throw new Error(d.error.message);

    const songs = (d.items || []).map(it => ({
      id:     it.id.videoId,
      title:  it.snippet.title.replace(/\s*[\(\[].*?[\)\]]/g,'').trim(),
      artist: it.snippet.channelTitle.replace(' - Topic','').replace('VEVO','').trim(),
      thumb:  it.snippet.thumbnails.medium?.url,
      dur:    '',
      album:  'YouTube',
    }));
    res.json({ items: songs, nextPageToken: d.nextPageToken || null, searchLimited: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/songs  → featured playlist
app.get('/api/songs', (req, res) => {
  const cfg = rd('config.json');
  res.json(cfg.featuredSongs);
});

// POST /api/play  → start a listening session
app.post('/api/play', userAuth, (req, res) => {
  try {
    const { songId, songTitle, songArtist, thumb } = req.body;
    if (!songId || !songTitle) return res.status(400).json({ error: 'Song ID and title required' });
    const plays = rd('plays.json');
    const now = Date.now();
    const sessionId = crypto.randomBytes(16).toString('hex');
    plays.push({
      sessionId, userId: req.user.id, userName: req.user.name,
      songId, songTitle, songArtist, thumb, timestamp: now,
      startedAt: now, lastHeartbeatAt: now, durationSeconds: 0, stoppedAt: null,
    });
    wd('plays.json', plays);

    // Increment user totalPlays
    const users = rd('users.json');
    const u = users.find(u => u.id === req.user.id);
    if (u) { u.totalPlays = (u.totalPlays||0)+1; wd('users.json', users); }

    res.json({ ok: true, sessionId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/play/:sessionId  → account for playback time and stop a session
app.patch('/api/play/:sessionId', userAuth, (req, res) => {
  try {
    const plays = rd('plays.json');
    const session = plays.find(p => p.sessionId === req.params.sessionId && p.userId === req.user.id);
    if (!session) return res.status(404).json({ error: 'Playback session not found' });
    if (session.stoppedAt) return res.json({ ok: true });

    const now = Date.now();
    const previous = session.lastHeartbeatAt || session.startedAt || session.timestamp;
    session.durationSeconds = (session.durationSeconds || 0) + Math.min(30, Math.max(0, (now - previous) / 1000));
    session.lastHeartbeatAt = now;
    if (req.body.stopped) session.stoppedAt = now;
    wd('plays.json', plays);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
//  USER ROUTES
// ══════════════════════════════════════════════════════

// GET /api/user/liked
app.get('/api/user/liked', userAuth, (req, res) => {
  const liked = rd('liked.json');
  res.json(liked[req.user.id] || []);
});

// POST /api/user/liked/:songId  → toggle like
app.post('/api/user/liked/:songId', userAuth, (req, res) => {
  const liked = rd('liked.json');
  if (!liked[req.user.id]) liked[req.user.id] = [];
  const idx = liked[req.user.id].findIndex(s => s.id === req.params.songId);
  if (idx >= 0) {
    liked[req.user.id].splice(idx, 1);
    wd('liked.json', liked);
    res.json({ liked: false });
  } else {
    liked[req.user.id].unshift({ ...req.body, likedAt: Date.now() });
    wd('liked.json', liked);
    res.json({ liked: true });
  }
});

// GET /api/user/history
app.get('/api/user/history', userAuth, (req, res) => {
  const plays = rd('plays.json');
  const mine  = plays.filter(p => p.userId === req.user.id).reverse().slice(0, 50);
  res.json(mine);
});

// PUT /api/user/profile
app.put('/api/user/profile', userAuth, async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const users = rd('users.json');
    const u = users.find(u => u.id === req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (name)   u.name   = name;
    if (avatar !== undefined) u.avatar = avatar;
    wd('users.json', users);
    res.json({ ok: true, name: u.name, avatar: u.avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════

app.get('/api/super-admin/overview', superAdminAuth, (req, res) => {
  const users = rd('users.json');
  const plays = rd('plays.json');
  res.json({
    users: users.filter(user => user.role === 'user').length,
    admins: users.filter(user => user.role === 'admin').length,
    plays: plays.length,
    bannedUsers: users.filter(user => user.role === 'user' && user.banned).length,
  });
});

app.get('/api/super-admin/admins', superAdminAuth, (req, res) => {
  res.json(rd('users.json').filter(user => user.role === 'admin').map(user => ({
    id: user.id, name: user.name, email: user.email, role: user.role,
    createdAt: user.createdAt, banned: user.banned,
  })));
});

app.post('/api/super-admin/admins', superAdminAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required' });

    const users = rd('users.json');
    if (users.some(user => user.email.toLowerCase() === email)) return res.status(409).json({ error: 'Email already exists' });
    const admin = {
      id: 'a_' + crypto.randomBytes(12).toString('hex'), name, email,
      password: await bcrypt.hash(password, 10), role: 'admin', avatar: '',
      createdAt: new Date().toISOString(), banned: false, totalPlays: 0,
    };
    users.push(admin);
    wd('users.json', users);
    res.status(201).json({ id: admin.id, name, email, role: admin.role, createdAt: admin.createdAt, banned: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/super-admin/admins/:id', superAdminAuth, (req, res) => {
  const users = rd('users.json');
  const admin = users.find(user => user.id === req.params.id && user.role === 'admin');
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  if (typeof req.body.banned !== 'boolean') return res.status(400).json({ error: 'Banned status is required' });
  admin.banned = req.body.banned;
  wd('users.json', users);
  res.json({ ok: true });
});

app.delete('/api/super-admin/admins/:id', superAdminAuth, (req, res) => {
  const users = rd('users.json');
  if (!users.some(user => user.id === req.params.id && user.role === 'admin')) return res.status(404).json({ error: 'Admin not found' });
  wd('users.json', users.filter(user => user.id !== req.params.id));
  const liked = rd('liked.json');
  delete liked[req.params.id];
  wd('liked.json', liked);
  res.json({ ok: true });
});

// GET /api/admin/stats
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const users  = rd('users.json');
  const plays  = rd('plays.json');
  const liked  = rd('liked.json');
  const config = rd('config.json');

  const totalUsers  = users.filter(u => u.role === 'user').length;
  const totalPlays  = plays.length;
  const totalLikes  = Object.values(liked).reduce((a,b) => a + b.length, 0);
  const bannedUsers = users.filter(u => u.banned).length;
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const weekStart = todayStart - 6 * 86400000;
  const previousWeekStart = weekStart - 7 * 86400000;
  const newUsersToday = users.filter(u => u.role === 'user' && new Date(u.createdAt).getTime() >= todayStart).length;
  const newUsersWeek = users.filter(u => u.role === 'user' && new Date(u.createdAt).getTime() >= weekStart).length;
  const previousWeekUsers = users.filter(u => u.role === 'user' && new Date(u.createdAt).getTime() >= previousWeekStart && new Date(u.createdAt).getTime() < weekStart).length;
  const playsToday = plays.filter(p => p.timestamp >= todayStart).length;
  const likesToday = Object.values(liked).reduce((count, items) => count + items.filter(item => item.likedAt >= todayStart).length, 0);
  const listeningByUser = {};
  plays.forEach(p => {
    if (!p.userId) return;
    listeningByUser[p.userId] = (listeningByUser[p.userId] || 0) + (p.durationSeconds || 0);
  });
  const activeByUser = {};
  plays.filter(p => !p.stoppedAt && p.lastHeartbeatAt && now - p.lastHeartbeatAt < 45000)
    .forEach(p => { activeByUser[p.userId] = p; });
  const listeners = users.filter(u => u.role === 'user').map(u => ({
    id: u.id, name: u.name, email: u.email,
    listenSeconds: Math.floor(listeningByUser[u.id] || 0),
    totalPlays: u.totalPlays || 0,
    currentlyListening: Boolean(activeByUser[u.id]),
    currentSong: activeByUser[u.id]?.songTitle || '',
  })).sort((a, b) => b.listenSeconds - a.listenSeconds);

  // Top songs
  const songCount = {};
  plays.forEach(p => { songCount[p.songId] = (songCount[p.songId]||{ count:0, title:p.songTitle, artist:p.songArtist, thumb:p.thumb }); songCount[p.songId].count++; });
  const topSongs = Object.entries(songCount).sort((a,b)=>b[1].count-a[1].count).slice(0,5).map(([id,v])=>({id,...v}));

  // Plays per day (last 7 local days)
  const playsPerDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - i));
    const start = date.getTime();
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: plays.filter(p => p.timestamp >= start && p.timestamp < start + 86400000).length,
    };
  });

  // Recent activity
  const recentActivity = plays.slice(-10).reverse().map(p => ({
    user: users.find(u=>u.id===p.userId)?.name || 'Unknown',
    song: p.songTitle, artist: p.songArtist,
    time: p.timestamp,
    listenSeconds: Math.floor(p.durationSeconds || 0),
  }));

  res.json({
    totalUsers, totalPlays, totalLikes, bannedUsers, topSongs, playsPerDay,
    recentActivity, listeners, currentlyListening: Object.keys(activeByUser).length,
    totalListenSeconds: Object.values(listeningByUser).reduce((sum, seconds) => sum + seconds, 0),
    totalSongs: config.featuredSongs.length, newUsersToday, playsToday, likesToday,
    newUsersWeek,
    growthRate: previousWeekUsers ? (newUsersWeek - previousWeekUsers) / previousWeekUsers : 0,
  });
});

// GET /api/admin/users
app.get('/api/admin/users', adminAuth, (req, res) => {
  const plays = rd('plays.json');
  const users = rd('users.json').filter(u => u.role === 'user').map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    createdAt: u.createdAt, banned: u.banned, totalPlays: u.totalPlays||0,
    listenSeconds: Math.floor(plays.filter(p => p.userId === u.id).reduce((sum, p) => sum + (p.durationSeconds || 0), 0)),
    currentSong: plays.slice().reverse().find(p => p.userId === u.id && !p.stoppedAt && p.lastHeartbeatAt && Date.now() - p.lastHeartbeatAt < 45000)?.songTitle || '',
  }));
  res.json(users);
});

// PUT /api/admin/users/:id  → ban/unban or change role
app.put('/api/admin/users/:id', adminAuth, (req, res) => {
  const users = rd('users.json');
  const u = users.find(u => u.id === req.params.id);
  if (!u || u.role !== 'user') return res.status(404).json({ error: 'User not found' });
  if (req.body.role !== undefined) return res.status(403).json({ error: 'Only a Super Admin can change account roles' });
  if (req.body.banned !== undefined) u.banned = req.body.banned;
  wd('users.json', users);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  let users = rd('users.json');
  if (!users.some(u => u.id === req.params.id && u.role === 'user')) return res.status(404).json({ error: 'User not found' });
  users = users.filter(u => u.id !== req.params.id);
  wd('users.json', users);
  const liked = rd('liked.json');
  delete liked[req.params.id];
  wd('liked.json', liked);
  res.json({ ok: true });
});

// GET /api/admin/plays
app.get('/api/admin/plays', adminAuth, (req, res) => {
  res.json(rd('plays.json').reverse().slice(0,100));
});

// GET /api/admin/songs
app.get('/api/admin/songs', adminAuth, (req, res) => {
  const config = rd('config.json');
  const plays = rd('plays.json');
  const liked = rd('liked.json');
  const songs = config.featuredSongs.map(song => ({
    ...song,
    plays: plays.filter(play => play.songId === song.id).length,
    likes: Object.values(liked).reduce((count, items) => count + items.filter(item => item.id === song.id).length, 0),
  }));
  res.json(songs);
});

// POST /api/admin/songs
app.post('/api/admin/songs', adminAuth, (req, res) => {
  const rawId = String(req.body.id || req.body.youtubeUrl || '').trim();
  const match = rawId.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)?([A-Za-z0-9_-]{11})(?:[?&/].*)?$/);
  const { title, artist } = req.body;
  if (!match || !title || !artist) return res.status(400).json({ error: 'Valid YouTube video URL/ID, title, and artist are required' });

  const config = rd('config.json');
  const id = match[1];
  if (config.featuredSongs.some(song => song.id === id)) return res.status(409).json({ error: 'Song already exists' });
  const song = {
    id, title: String(title).trim(), artist: String(artist).trim(),
    dur: String(req.body.dur || ''), album: String(req.body.album || 'YouTube'),
    thumb: `https://img.youtube.com/vi/${id}/mqdefault.jpg`, createdAt: new Date().toISOString(),
  };
  if (!song.title || !song.artist) return res.status(400).json({ error: 'Title and artist are required' });
  config.featuredSongs.unshift(song);
  wd('config.json', config);
  res.status(201).json(song);
});

// DELETE /api/admin/songs/:id
app.delete('/api/admin/songs/:id', adminAuth, (req, res) => {
  const config = rd('config.json');
  const songs = config.featuredSongs.filter(song => song.id !== req.params.id);
  if (songs.length === config.featuredSongs.length) return res.status(404).json({ error: 'Song not found' });
  config.featuredSongs = songs;
  wd('config.json', config);
  res.json({ ok: true });
});

// PUT /api/admin/config  → update API key / featured songs
app.put('/api/admin/config', superAdminAuth, (req, res) => {
  const cfg = rd('config.json');
  if (req.body.ytApiKey) cfg.ytApiKey = req.body.ytApiKey;
  if (req.body.featuredSongs) cfg.featuredSongs = req.body.featuredSongs;
  wd('config.json', cfg);
  res.json({ ok: true });
});

// GET /api/admin/config
app.get('/api/admin/config', superAdminAuth, (req, res) => {
  const config = rd('config.json');
  res.json({ ytApiKeyConfigured: Boolean(config.ytApiKey || process.env.YOUTUBE_API_KEY) });
});

// ── Catch all → serve index.html ─────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n🎵  NYMIX Music Platform');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🌐  App:     http://localhost:${PORT}`);
  console.log(`👑  Super Admin: http://localhost:${PORT}/super-admin`);
  console.log(`🛡️  Admin:   http://localhost:${PORT}/admin`);
  console.log(`👤  User:    http://localhost:${PORT}/user`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧  Super Admin: admin@nymix.com');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
