/* =====================================================
   NYMIX public/app.js — Fixed YouTube Playback
   ===================================================== */
const API = 'http://localhost:3000/api';
const token = () => localStorage.getItem('nx_token');
const user  = () => JSON.parse(localStorage.getItem('nx_user') || 'null');

const apiFetch = async (url, opts = {}) => {
  const t = token();
  const headers = { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
  const r = await fetch(API + url, { headers, ...opts });
  return r.json();
};

// ── State ──────────────────────────────────────────────
const S = {
  ytPlayer: null,
  ytReady: false,
  current: null,
  queue: [],
  qIdx: -1,
  playing: false,
  playSessionId: null,
  heartbeatTimer: null,
  sessionStarting: false,
  shuffle: false,
  repeat: false,
  volume: 80,
  liked: [],
};

// ── Auth Guard ────────────────────────────────────────
function requireAuth() {
  const currentUser = user();
  if (!token() || !currentUser) {
    window.location.href = '/login.html';
    return false;
  }
  if (currentUser.role === 'super_admin') { window.location.href = '/super-admin/'; return false; }
  if (currentUser.role === 'admin') { window.location.href = '/admin/'; return false; }
  if (currentUser.role !== 'user') { window.location.href = '/login.html'; return false; }
  return true;
}

// ── YouTube IFrame API ────────────────────────────────
window.onYouTubeIframeAPIReady = () => {
  S.ytPlayer = new YT.Player('yt-player', {
    height: '180',
    width: '320',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
    },
    events: {
      onReady: (e) => {
        S.ytReady = true;
        e.target.setVolume(S.volume);
        startPoller();
        console.log('%c✅ Nymix Player Ready', 'color:#a855f7;font-size:14px;font-weight:bold');
      },
      onStateChange: (e) => {
        const YTS = YT.PlayerState;
        if (e.data === YTS.PLAYING) {
          setPlaying(true);
          startListeningSession();
        } else if (e.data === YTS.PAUSED) {
          setPlaying(false);
          stopListeningSession();
        } else if (e.data === YTS.ENDED) {
          setPlaying(false);
          stopListeningSession();
          onEnd();
        }
        else if (e.data === YTS.CUED)    S.ytPlayer.playVideo(); // Auto-play when cued
      },
      onError: (e) => {
        console.warn('YT Error:', e.data);
        setPlaying(false);
        stopListeningSession();
        showPlayerError(e.data);
        setTimeout(() => next(), 2500);
      },
    },
  });
};

function showPlayerError(code) {
  const msgs = {
    2:   '❌ Invalid video',
    5:   '❌ HTML5 player error',
    100: '❌ Video not found',
    101: '⚠️ Embed not allowed — skipping',
    150: '⚠️ Embed not allowed — skipping',
  };
  console.warn(msgs[code] || `YT Error ${code}`);
}

// ── Progress Poller ───────────────────────────────────
function startPoller() {
  setInterval(() => {
    if (!S.ytReady || !S.ytPlayer || typeof S.ytPlayer.getCurrentTime !== 'function') return;
    try {
      const c = S.ytPlayer.getCurrentTime() || 0;
      const d = S.ytPlayer.getDuration()    || 0;
      const pct = d > 0 ? (c / d) * 100 : 0;
      $('progress-fill').style.width = pct + '%';
      $('progress-dot').style.left   = pct + '%';
      $('p-current').textContent = fmt(c);
      $('p-duration').textContent = fmt(d);
    } catch (_) {}
  }, 500);
}

// ── Playback ──────────────────────────────────────────
async function play(song) {
  if (S.current && S.current.id !== song.id) stopListeningSession();
  S.current = song;

  // Load video — CUED state triggers playVideo() automatically
  if (S.ytReady && S.ytPlayer && typeof S.ytPlayer.loadVideoById === 'function') {
    S.ytPlayer.loadVideoById({ videoId: song.id, startSeconds: 0 });
    // Fallback: also call playVideo after short delay
    setTimeout(() => {
      try { if (S.ytPlayer) S.ytPlayer.playVideo(); } catch (_) {}
    }, 800);
  }

  setPlaying(false);

  // Update right panel: Now Playing card
  const imgSrc = song.thumb || thumb(song.id);
  const npImg = $('np-card-img');
  const npPh  = $('np-placeholder');
  npImg.src = imgSrc;
  npImg.style.display = 'block';
  npPh.style.display  = 'none';
  $('np-card-title').textContent  = song.title;
  $('np-card-artist').textContent = song.artist;

  // Update hero banner
  $('hero-img').src = `https://img.youtube.com/vi/${song.id}/maxresdefault.jpg`;
  $('hero-title').textContent = song.title;
  $('hero-listeners').textContent = randListeners();

  // Page title
  document.title = `▶ ${song.title} — Nymix`;

  // Active row highlight
  document.querySelectorAll('.playlist-table tbody tr').forEach(tr => {
    tr.classList.toggle('active-row', tr.dataset.id === song.id);
  });
  document.querySelectorAll('.row-num').forEach(td => {
    const tr = td.closest('tr');
    if (tr && tr.dataset.id === song.id)
      td.innerHTML = `<div class="eq"><span></span><span></span><span></span></div>`;
    else
      td.textContent = td.dataset.n || '';
  });

  updateLikeBtn();

  // Local history
  let hist = JSON.parse(localStorage.getItem('nx_hist') || '[]');
  hist = hist.filter(s => s.id !== song.id);
  hist.unshift({ ...song, playedAt: Date.now() });
  if (hist.length > 30) hist.pop();
  localStorage.setItem('nx_hist', JSON.stringify(hist));
  renderPlayed();
}

async function startListeningSession() {
  if (!token() || !S.current || S.playSessionId || S.sessionStarting) return;
  S.sessionStarting = true;
  const song = S.current;
  try {
    const result = await apiFetch('/play', {
      method: 'POST',
      body: JSON.stringify({
        songId: song.id,
        songTitle: song.title,
        songArtist: song.artist,
        thumb: song.thumb || thumb(song.id),
      }),
    });
    if (!result.sessionId) return;
    if (!S.playing || S.current !== song) {
      await apiFetch(`/play/${result.sessionId}`, { method:'PATCH', body:JSON.stringify({ stopped:true }), keepalive:true }).catch(() => {});
      return;
    }
    S.playSessionId = result.sessionId;
    S.heartbeatTimer = setInterval(() => sendListeningHeartbeat(false), 15000);
  } catch (_) {
  } finally {
    const shouldRetry = S.current !== song && S.playing && !S.playSessionId;
    S.sessionStarting = false;
    if (shouldRetry) startListeningSession();
  }
}

function sendListeningHeartbeat(stopped) {
  if (!S.playSessionId) return;
  const sessionId = S.playSessionId;
  if (stopped) {
    clearInterval(S.heartbeatTimer);
    S.heartbeatTimer = null;
    S.playSessionId = null;
  }
  apiFetch(`/play/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stopped: Boolean(stopped) }),
    keepalive: Boolean(stopped),
  }).catch(() => {});
}

function stopListeningSession() { sendListeningHeartbeat(true); }
window.addEventListener('pagehide', stopListeningSession);

function togglePlay() {
  if (!S.ytReady || !S.ytPlayer) return;
  if (!S.current) return;
  S.playing ? S.ytPlayer.pauseVideo() : S.ytPlayer.playVideo();
}

function setPlaying(v) {
  S.playing = v;
  $('play-icon-main').style.display  = v ? 'none'  : 'block';
  $('pause-icon-main').style.display = v ? 'block' : 'none';
}

function next() {
  if (!S.queue.length) return;
  S.qIdx = S.shuffle
    ? Math.floor(Math.random() * S.queue.length)
    : (S.qIdx + 1) % S.queue.length;
  play(S.queue[S.qIdx]);
}

function prev() {
  if (!S.queue.length) return;
  if (S.ytReady && S.ytPlayer && S.ytPlayer.getCurrentTime() > 3) {
    S.ytPlayer.seekTo(0, true);
    return;
  }
  S.qIdx = (S.qIdx - 1 + S.queue.length) % S.queue.length;
  play(S.queue[S.qIdx]);
}

function onEnd() {
  if (S.repeat) {
    S.ytPlayer.seekTo(0, true);
    S.ytPlayer.playVideo();
  } else {
    next();
  }
}

function playQueue(songs, i) {
  S.queue = songs;
  S.qIdx  = i;
  play(songs[i]);
}

// ── Search ────────────────────────────────────────────
async function search(q) {
  if (!q.trim()) return;
  showView('discover');
  $('search-heading').textContent = `"${q}"`;
  $('search-status').textContent  = '';
  $('search-results-grid').innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <span>Searching YouTube...</span>
    </div>`;

  try {
    const d = await apiFetch(`/search?q=${encodeURIComponent(q)}`);
    if (d.error) throw new Error(d.error);
    renderGrid(d.items || [], q);
  } catch (e) {
    $('search-results-grid').innerHTML = `
      <div class="loading-wrap">
        <span style="font-size:36px">⚠️</span>
        <p style="color:#9ca3af">${e.message}</p>
      </div>`;
  }
}

function searchTag(tag) { $('search-input').value = tag; search(tag); }

function renderGrid(songs, q) {
  $('search-status').textContent = `${songs.length} results for "${q}"`;
  S.queue = songs;
  const grid = $('search-results-grid');
  grid.innerHTML = '';
  if (!songs.length) {
    grid.innerHTML = '<div class="loading-wrap"><span style="font-size:36px">🎵</span><p>No results found</p></div>';
    return;
  }
  songs.forEach((s, i) => {
    const c = document.createElement('div');
    c.className = 'sg-card';
    c.innerHTML = `
      <img src="${s.thumb || thumb(s.id)}" alt="${esc(s.title)}"
           onerror="this.src='${thumb(s.id)}'" />
      <div class="sg-play-btn">▶</div>
      <div class="sg-card-info">
        <div class="sg-card-title">${esc(s.title)}</div>
        <div class="sg-card-artist">${esc(s.artist)}</div>
      </div>`;
    c.addEventListener('click', () => playQueue(songs, i));
    grid.appendChild(c);
  });
}

// ── Liked ─────────────────────────────────────────────
async function loadLiked() {
  if (!token()) {
    S.liked = JSON.parse(localStorage.getItem('nx_liked') || '[]');
    return;
  }
  try {
    S.liked = await apiFetch('/user/liked');
  } catch {
    S.liked = JSON.parse(localStorage.getItem('nx_liked') || '[]');
  }
  renderLiked();
}

function isLiked(id) { return S.liked.some(s => s.id === id); }

async function toggleLike(song) {
  if (token()) {
    await apiFetch(`/user/liked/${song.id}`, {
      method: 'POST',
      body: JSON.stringify(song),
    });
    await loadLiked();
  } else {
    if (isLiked(song.id)) S.liked = S.liked.filter(s => s.id !== song.id);
    else S.liked.unshift(song);
    localStorage.setItem('nx_liked', JSON.stringify(S.liked));
    renderLiked();
  }
  updateLikeBtn();
}

function updateLikeBtn() {
  if (!S.current) return;
  const liked = isLiked(S.current.id);
  const btn = $('p-like-btn');
  btn.textContent = liked ? '♥' : '♡';
  btn.style.color = liked ? '#a855f7' : '';
}

function renderLiked() {
  const list = $('liked-list');
  if (!list) return;
  list.innerHTML = '';
  if (!S.liked.length) {
    list.innerHTML = '<div style="color:#9ca3af;padding:30px;text-align:center">No liked songs yet ♡</div>';
    return;
  }
  S.liked.forEach((s, i) => {
    const r = document.createElement('div');
    r.className = 'sl-row';
    r.innerHTML = `
      <img src="${s.thumb || thumb(s.id)}" onerror="this.src='${thumb(s.id)}'" />
      <div class="sl-info">
        <div class="sl-title">${esc(s.title)}</div>
        <div class="sl-artist">${esc(s.artist)}</div>
      </div>
      <button class="sl-like-btn" title="Unlike">♥</button>`;
    r.querySelector('.sl-like-btn').addEventListener('click', e => {
      e.stopPropagation();
      toggleLike(s);
    });
    r.addEventListener('click', () => playQueue(S.liked, i));
    list.appendChild(r);
  });
}

// ── Playlist Table ────────────────────────────────────
let featuredSongs = [];
async function buildPlaylist() {
  try { featuredSongs = await apiFetch('/songs'); }
  catch { featuredSongs = DEMO; }

  const tbody = $('playlist-body');
  tbody.innerHTML = '';
  featuredSongs.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.dataset.id = s.id;
    const liked = isLiked(s.id);
    tr.innerHTML = `
      <td class="row-num" data-n="${i + 1}">${i + 1}</td>
      <td class="td-title">${esc(s.title)}</td>
      <td class="td-artist">${esc(s.artist)}</td>
      <td class="td-time">${s.dur || '—'}</td>
      <td class="td-album">${s.album || '—'}</td>
      <td class="td-actions">
        <button class="row-like-btn ${liked ? 'liked' : ''}">${liked ? '♥' : '♡'}</button>
      </td>`;
    tr.querySelector('.row-like-btn').addEventListener('click', e => {
      e.stopPropagation();
      toggleLike(s);
      e.currentTarget.classList.toggle('liked', isLiked(s.id));
      e.currentTarget.textContent = isLiked(s.id) ? '♥' : '♡';
    });
    tr.addEventListener('click', () => playQueue(featuredSongs, i));
    tbody.appendChild(tr);
  });
  return featuredSongs;
}

// ── Genres & Radio ────────────────────────────────────
const GENRES = [
  { name: 'Pop',       color: 'linear-gradient(135deg,#7c3aed,#ec4899)', emoji: '🎵' },
  { name: 'Hip-Hop',   color: 'linear-gradient(135deg,#059669,#0d9488)', emoji: '🎤' },
  { name: 'Rock',      color: 'linear-gradient(135deg,#dc2626,#b45309)', emoji: '🎸' },
  { name: 'Jazz',      color: 'linear-gradient(135deg,#2563eb,#4f46e5)', emoji: '🎷' },
  { name: 'Lo-fi',     color: 'linear-gradient(135deg,#0f172a,#1e3a5f)', emoji: '🌙' },
  { name: 'Electronic',color: 'linear-gradient(135deg,#0891b2,#06b6d4)', emoji: '🎧' },
  { name: 'Classical', color: 'linear-gradient(135deg,#92400e,#b45309)', emoji: '🎻' },
  { name: 'R&B',       color: 'linear-gradient(135deg,#9d174d,#be185d)', emoji: '🎼' },
  { name: 'Acoustic',  color: 'linear-gradient(135deg,#065f46,#047857)', emoji: '🪕' },
  { name: 'K-Pop',     color: 'linear-gradient(135deg,#be185d,#7c3aed)', emoji: '🌸' },
  { name: 'Bangla',    color: 'linear-gradient(135deg,#b45309,#92400e)', emoji: '🇧🇩' },
  { name: 'Indie',     color: 'linear-gradient(135deg,#4c1d95,#5b21b6)', emoji: '✨' },
];

const RADIO = [
  { name: 'Chill Vibes',  desc: 'Relaxing beats', emoji: '😌', query: 'chill lo-fi' },
  { name: 'Top 40',       desc: 'Current hits',   emoji: '🔥', query: 'top hits 2024' },
  { name: 'Workout',      desc: 'High energy',    emoji: '💪', query: 'workout music' },
  { name: 'Late Night',   desc: 'Smooth & mellow',emoji: '🌙', query: 'late night music' },
  { name: 'Bangla Hits',  desc: 'Best of Bangla', emoji: '🎙️', query: 'bangla song' },
  { name: 'Acoustic',     desc: 'Stripped back',  emoji: '🎸', query: 'acoustic songs' },
];

const DEMO = [
  { id: 'JGwWNGJdvx8', title: 'Shape of You',    artist: 'Ed Sheeran',       dur: '3:53', album: '÷ (Divide)' },
  { id: 'ktvTqknDobU', title: 'Radioactive',      artist: 'Imagine Dragons',  dur: '3:06', album: 'Night Visions' },
  { id: '09R8_2nJtjg', title: 'Payphone',         artist: 'Maroon 5',         dur: '3:45', album: 'Overexposed' },
  { id: 'RgKAFK5djSk', title: 'See You Again',    artist: 'Wiz Khalifa',      dur: '3:50', album: 'Furious 7' },
  { id: 'YQHsXMglC9A', title: 'Hello',            artist: 'Adele',            dur: '4:55', album: '25' },
];

function buildGenres() {
  const grid = $('genre-grid');
  if (!grid) return;
  grid.innerHTML = '';
  GENRES.forEach(g => {
    const c = document.createElement('div');
    c.className = 'genre-card';
    c.style.background = g.color;
    c.innerHTML = `<div style="font-size:28px;margin-bottom:8px">${g.emoji}</div><div>${g.name}</div>`;
    c.addEventListener('click', () => { $('search-input').value = g.name; search(g.name); });
    grid.appendChild(c);
  });
}

function buildRadio() {
  const grid = $('radio-grid');
  if (!grid) return;
  grid.innerHTML = '';
  RADIO.forEach(r => {
    const c = document.createElement('div');
    c.className = 'radio-card';
    c.innerHTML = `<div class="radio-emoji">${r.emoji}</div><div class="radio-title">${r.name}</div><div class="radio-desc">${r.desc}</div>`;
    c.addEventListener('click', () => { $('search-input').value = r.query; search(r.query); });
    grid.appendChild(c);
  });
}

// ── History ───────────────────────────────────────────
function renderPlayed() {
  const list = $('played-list');
  if (!list) return;
  list.innerHTML = '';
  const hist = JSON.parse(localStorage.getItem('nx_hist') || '[]');
  if (!hist.length) {
    list.innerHTML = '<div class="played-empty">গান বাজালে এখানে দেখাবে</div>';
    return;
  }
  hist.slice(0, 6).forEach(s => {
    const r = document.createElement('div');
    r.className = 'played-item';
    r.innerHTML = `
      <img src="${s.thumb || thumb(s.id)}" onerror="this.src='${thumb(s.id)}'" />
      <div class="played-info">
        <div class="played-title">${esc(s.title)}</div>
        <div class="played-artist">${esc(s.artist)}</div>
      </div>
      <div class="played-time">${timeAgo(s.playedAt)}</div>`;
    r.addEventListener('click', () => play(s));
    list.appendChild(r);
  });
}

// ── Views ─────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById('view-' + name);
  if (v) v.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.view === name)
  );
  const titles = {
    home: "What's hot", discover: 'Discover',
    browse: 'Browse', liked: 'Your Library', radio: 'Radio',
  };
  $('view-title').textContent = titles[name] || '';
}

// ── User Menu ─────────────────────────────────────────
function updateUserMenu() {
  const u = user();
  const sb = document.querySelector('.sidebar-bottom');
  if (!sb) return;
  if (u) {
    sb.innerHTML = `
      <div class="user-profile">
        <div class="user-avatar">${u.name[0].toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${esc(u.name)}</div>
          <div class="user-plan">${u.role === 'admin' ? '👑 Admin' : '🎵 Member'}</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:4px">
          ${u.role === 'admin'
            ? `<button onclick="window.open('/admin/','_blank')" title="Admin" style="background:none;border:none;cursor:pointer;font-size:15px">👑</button>` : ''}
          <button onclick="window.open('/user/','_blank')" title="Dashboard" style="background:none;border:none;cursor:pointer;font-size:15px">👤</button>
          <button onclick="logout()" title="Logout" style="background:none;border:none;cursor:pointer;font-size:15px">🚪</button>
        </div>
      </div>`;
  } else {
    sb.innerHTML = `
      <div class="user-profile" style="cursor:pointer" onclick="window.location.href='/login.html'">
        <div class="user-avatar" style="background:#374151">?</div>
        <div class="user-info">
          <div class="user-name">Not logged in</div>
          <div class="user-plan" style="color:#a855f7">Login →</div>
        </div>
      </div>`;
  }
}

function logout() {
  localStorage.removeItem('nx_token');
  localStorage.removeItem('nx_user');
  window.location.href = '/login.html';
}

// ── Settings ──────────────────────────────────────────
async function saveSettings() {
  const k = $('api-input').value.trim();
  if (!k) return;
  if (token()) {
    await apiFetch('/admin/config', {
      method: 'PUT',
      body: JSON.stringify({ ytApiKey: k }),
    }).catch(() => {});
  }
  $('api-msg').textContent = '✓ Saved!';
  $('api-msg').className   = 'api-msg ok';
  setTimeout(() => $('modal-bg').classList.add('hidden'), 800);
}

// ── Helpers ───────────────────────────────────────────
const $     = id => document.getElementById(id);
const thumb = id => `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
const esc   = s  => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt   = s  => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sc = Math.floor(s % 60);
  return `${m}:${sc.toString().padStart(2, '0')}`;
};
const randListeners = () => (Math.floor(Math.random() * 900 + 100) / 100).toFixed(2) + 'M';
function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' hr ago';
  return Math.floor(d / 86400) + ' days ago';
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 🔒 Must be logged in
  if (!requireAuth()) return;

  updateUserMenu();
  await loadLiked();
  await buildPlaylist();
  buildGenres();
  buildRadio();
  renderPlayed();

  // Load API config
  if (token()) {
    const cfg = await apiFetch('/admin/config').catch(() => null);
    if (cfg && cfg.ytApiKey && $('api-input')) $('api-input').value = cfg.ytApiKey;
  }

  // ── Nav ──
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', () => showView(a.dataset.view));
  });

  // ── Search ──
  const inp = $('search-input');
  if (inp) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') search(inp.value); });
    inp.addEventListener('input', () => {
      clearTimeout(inp._t);
      if (inp.value.trim().length > 2)
        inp._t = setTimeout(() => search(inp.value), 600);
    });
  }

  // ── Player Controls ──
  $('btn-playpause').addEventListener('click', togglePlay);
  $('btn-next').addEventListener('click', next);
  $('btn-prev').addEventListener('click', prev);
  $('btn-shuffle').addEventListener('click', () => {
    S.shuffle = !S.shuffle;
    $('btn-shuffle').classList.toggle('active', S.shuffle);
  });
  $('btn-repeat').addEventListener('click', () => {
    S.repeat = !S.repeat;
    $('btn-repeat').classList.toggle('active', S.repeat);
  });
  $('p-like-btn').addEventListener('click', () => {
    if (S.current) toggleLike(S.current);
  });

  // ── Volume ──
  $('volume-slider').addEventListener('input', e => {
    S.volume = parseInt(e.target.value);
    if (S.ytReady && S.ytPlayer) S.ytPlayer.setVolume(S.volume);
  });

  // ── Seek ──
  $('progress-track').addEventListener('click', e => {
    if (!S.ytReady || !S.ytPlayer) return;
    const r   = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - r.left) / r.width;
    S.ytPlayer.seekTo((S.ytPlayer.getDuration() || 0) * pct, true);
  });

  // ── Hero Play ──
  $('hero-play-btn').addEventListener('click', () => {
    if (featuredSongs.length) playQueue(featuredSongs, 0);
  });

  // ── Show all ──
  $('show-all-btn').addEventListener('click', () => {
    showView('discover');
    $('search-heading').textContent = 'Featured Songs';
    renderGrid(featuredSongs, 'Featured');
  });

  // ── See all played ──
  $('see-all-btn').addEventListener('click', () => showView('liked'));

  // ── Settings Modal ──
  $('settings-btn').addEventListener('click', () => $('modal-bg').classList.remove('hidden'));
  $('modal-close').addEventListener('click',  () => $('modal-bg').classList.add('hidden'));
  $('modal-bg').addEventListener('click', e => {
    if (e.target === $('modal-bg')) $('modal-bg').classList.add('hidden');
  });
  $('save-btn').addEventListener('click', saveSettings);

  // ── Keyboard Shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')     { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') next();
    if (e.code === 'ArrowLeft')  prev();
    if (e.code === 'KeyL' && S.current) toggleLike(S.current);
  });
});
