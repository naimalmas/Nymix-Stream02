/* =====================================================
   NYMIX public/app.js — Fixed YouTube Playback
   ===================================================== */
const API = '/api';
const iconSvg = name => `<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
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
  notifications: [],
  notificationsBusy: false,
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
        console.log('%cNymix Player Ready', 'color:#a855f7;font-size:14px;font-weight:bold');
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
    2:   'Invalid video',
    5:   'HTML5 player error',
    100: 'Video not found',
    101: 'Embed not allowed — skipping',
    150: 'Embed not allowed — skipping',
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
  $('hero-img').src = song.thumb || `https://img.youtube.com/vi/${song.id}/maxresdefault.jpg`;
  $('hero-title').textContent = song.title;
  $('hero-listeners').textContent = 'Naim Almas Official';

  // Page title
  document.title = `${song.title} — Nymix`;

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
const searchState = {
  query: '',
  requestId: 0,
  nextPageToken: null,
  results: [],
  limited: false,
  loading: false,
};

async function search(q) {
  const query = q.trim();
  if (!query) return;
  searchState.query = query;
  searchState.requestId++;
  searchState.nextPageToken = null;
  searchState.results = [];
  searchState.limited = false;
  searchState.loading = false;
  const requestId = searchState.requestId;
  showView('discover');
  $('search-heading').textContent = `"${query}"`;
  $('search-status').textContent  = '';
  $('search-results-grid').innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <span>Searching YouTube...</span>
    </div>`;
  $('search-results-more').innerHTML = '';

  try {
    await fetchSearchPage(false, requestId);
  } catch (e) {
    if (requestId !== searchState.requestId) return;
    $('search-results-grid').innerHTML = `
      <div class="loading-wrap">
        ${iconSvg('warning')}
        <p style="color:#9ca3af">${e.message}</p>
      </div>`;
  }
}

async function fetchSearchPage(loadMore, requestId) {
  if (searchState.loading) return;
  searchState.loading = true;
  updateSearchMoreButton();

  try {
    const pageToken = loadMore ? searchState.nextPageToken : null;
    const pageQuery = `/search?q=${encodeURIComponent(searchState.query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const d = await apiFetch(pageQuery);
    if (requestId !== searchState.requestId) return;
    if (d.error) throw new Error(d.error);

    const seenIds = new Set(searchState.results.map(song => song.id));
    searchState.results.push(...(d.items || []).filter(song => !seenIds.has(song.id)));
    searchState.nextPageToken = d.nextPageToken || null;
    searchState.limited = Boolean(d.searchLimited);
    renderGrid(searchState.results, searchState.query, searchState.limited);
  } catch (e) {
    if (requestId !== searchState.requestId) return;
    if (!loadMore) throw e;
    $('search-status').textContent = `Couldn't load more results: ${e.message}`;
  } finally {
    if (requestId === searchState.requestId) {
      searchState.loading = false;
      updateSearchMoreButton();
    }
  }
}

function updateSearchMoreButton() {
  const container = $('search-results-more');
  container.innerHTML = '';
  if (searchState.limited) {
    container.textContent = 'Showing matching featured songs only. Configure a YouTube API key in Super Admin settings to search all songs.';
    container.className = 'search-status-text search-limited';
    return;
  }
  container.className = '';
  if (!searchState.nextPageToken) return;

  const wrap = document.createElement('div');
  wrap.className = 'search-more-wrap';
  const button = document.createElement('button');
  button.className = 'search-more-btn';
  button.textContent = searchState.loading ? 'Loading...' : 'Load more songs';
  button.disabled = searchState.loading;
  button.addEventListener('click', () => fetchSearchPage(true, searchState.requestId));
  wrap.appendChild(button);
  container.appendChild(wrap);
}

function searchTag(tag) { $('search-input').value = tag; search(tag); }

function renderGrid(songs, q, limited = false) {
  $('search-status').textContent = `${songs.length} results for "${q}"`;
  $('search-status').classList.toggle('search-limited', limited);
  S.queue = songs;
  const grid = $('search-results-grid');
  grid.innerHTML = '';
  if (!songs.length) {
    grid.innerHTML = `<div class="loading-wrap">${iconSvg('music')}<p>No results found</p></div>`;
    return;
  }
  songs.forEach((s, i) => {
    const c = document.createElement('div');
    c.className = 'sg-card';
    c.innerHTML = `
      <img src="${s.thumb || thumb(s.id)}" alt="${esc(s.title)}"
           onerror="this.src='${thumb(s.id)}'" />
      <div class="sg-play-btn">${iconSvg('play')}</div>
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
  btn.classList.toggle('liked', liked);
  btn.setAttribute('aria-label', liked ? 'Unlike song' : 'Like song');
  btn.style.color = liked ? '#a855f7' : '';
}

function renderLiked() {
  const list = $('liked-list');
  if (!list) return;
  list.innerHTML = '';
  if (!S.liked.length) {
    list.innerHTML = `<div style="color:#9ca3af;padding:30px;text-align:center">${iconSvg('heart')}<p>No liked songs yet</p></div>`;
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
      <button class="sl-like-btn" title="Unlike">${iconSvg('heart')}</button>`;
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
  const tbody = $('playlist-body');
  try {
    const data = await apiFetch('/promoted-songs');
    if (data.error) throw new Error(data.error);
    featuredSongs = data.items;
    if (!Array.isArray(featuredSongs)) throw new Error('Invalid official channel song list');
    $('featured-heading').textContent = `Latest from ${data.channelTitle || 'Naim Almas Official'}`;
    $('hero-tag').textContent = 'Featured from the official channel';
    $('hero-play-btn').disabled = featuredSongs.length === 0;
  } catch (error) {
    featuredSongs = [];
    $('hero-play-btn').disabled = true;
    tbody.innerHTML = `<tr><td class="featured-error" colspan="6">${esc(error.message || 'Unable to load official channel songs')}</td></tr>`;
    $('hero-title').textContent = 'Listen to Naim Almas Official';
    return featuredSongs;
  }

  if (featuredSongs.length) {
    $('hero-img').src = featuredSongs[0].thumb || thumb(featuredSongs[0].id);
    $('hero-title').textContent = featuredSongs[0].title;
  }
  tbody.innerHTML = '';
  if (!featuredSongs.length) {
    $('hero-play-btn').disabled = true;
    tbody.innerHTML = '<tr><td class="featured-error" colspan="6">No videos are available on the official channel yet.</td></tr>';
    return featuredSongs;
  }
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
        <button class="row-like-btn ${liked ? 'liked' : ''}" aria-label="${liked ? 'Unlike' : 'Like'} song">${iconSvg('heart')}</button>
      </td>`;
    tr.querySelector('.row-like-btn').addEventListener('click', e => {
      e.stopPropagation();
      toggleLike(s);
      e.currentTarget.classList.toggle('liked', isLiked(s.id));
      e.currentTarget.setAttribute('aria-label', isLiked(s.id) ? 'Unlike song' : 'Like song');
    });
    tr.addEventListener('click', () => playQueue(featuredSongs, i));
    tbody.appendChild(tr);
  });
  return featuredSongs;
}

// ── Genres & Radio ────────────────────────────────────
const GENRES = [
  { name: 'Pop',        color: 'linear-gradient(135deg,#7c3aed,#ec4899)', icon: 'music' },
  { name: 'Hip-Hop',    color: 'linear-gradient(135deg,#059669,#0d9488)', icon: 'mic' },
  { name: 'Rock',       color: 'linear-gradient(135deg,#dc2626,#b45309)', icon: 'radio' },
  { name: 'Jazz',       color: 'linear-gradient(135deg,#2563eb,#4f46e5)', icon: 'music' },
  { name: 'Lo-fi',      color: 'linear-gradient(135deg,#0f172a,#1e3a5f)', icon: 'headphones' },
  { name: 'Electronic', color: 'linear-gradient(135deg,#0891b2,#06b6d4)', icon: 'radio' },
  { name: 'Classical',  color: 'linear-gradient(135deg,#92400e,#b45309)', icon: 'music' },
  { name: 'R&B',        color: 'linear-gradient(135deg,#9d174d,#be185d)', icon: 'mic' },
  { name: 'Acoustic',   color: 'linear-gradient(135deg,#065f46,#047857)', icon: 'music' },
  { name: 'K-Pop',      color: 'linear-gradient(135deg,#be185d,#7c3aed)', icon: 'sparkles' },
  { name: 'Bangla',     color: 'linear-gradient(135deg,#b45309,#92400e)', icon: 'music' },
  { name: 'Indie',      color: 'linear-gradient(135deg,#4c1d95,#5b21b6)', icon: 'sparkles' },
];

const RADIO = [
  { name: 'Chill Vibes',  desc: 'Relaxing beats', icon: 'headphones', query: 'chill lo-fi' },
  { name: 'Top 40',       desc: 'Current hits',   icon: 'chart', query: 'top hits 2024' },
  { name: 'Workout',      desc: 'High energy',    icon: 'play', query: 'workout music' },
  { name: 'Late Night',   desc: 'Smooth & mellow',icon: 'radio', query: 'late night music' },
  { name: 'Bangla Hits',  desc: 'Best of Bangla', icon: 'mic', query: 'bangla song' },
  { name: 'Acoustic',     desc: 'Stripped back',  icon: 'music', query: 'acoustic songs' },
];

function buildGenres() {
  const grid = $('genre-grid');
  if (!grid) return;
  grid.innerHTML = '';
  GENRES.forEach(g => {
    const c = document.createElement('div');
    c.className = 'genre-card';
    c.style.background = g.color;
    c.innerHTML = `<div class="genre-icon">${iconSvg(g.icon)}</div><div>${g.name}</div>`;
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
    c.innerHTML = `<div class="radio-icon">${iconSvg(r.icon)}</div><div class="radio-title">${r.name}</div><div class="radio-desc">${r.desc}</div>`;
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
function showView(name, syncPortal = true) {
  const viewName = name === 'add-friend' || name === 'feed' || name === 'reels' || name === 'profile' ? 'messages' : name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById('view-' + viewName);
  if (v) v.classList.add('active');
  document.querySelector('.app')?.classList.toggle('social-active', viewName === 'messages');
  document.querySelectorAll('.nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.view === name)
  );
  const titles = {
    home: "What's hot", discover: 'Discover',
    browse: 'Browse', liked: 'Your Library', radio: 'Radio',
    messages: 'Messages', feed: 'Feed', reels: 'Reels', profile: 'Profile', 'add-friend': 'Add friend',
  };
  $('view-title').textContent = titles[name] || '';
  if (viewName === 'messages' && syncPortal) {
    $('social-portal')?.contentWindow?.postMessage({
      type: 'nymix-social-panel',
      panel: name === 'add-friend' ? 'people' : ['feed', 'reels', 'profile'].includes(name) ? name : 'chat',
    }, window.location.origin);
  }
}

function setMobileMenuOpen(open) {
  const app = document.querySelector('.app');
  const toggle = $('mobile-menu-toggle');
  if (!app || !toggle) return;
  app.classList.toggle('mobile-menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  $('mobile-menu-backdrop').hidden = !open;
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
          <div class="user-plan">${u.role === 'admin' ? 'Admin' : 'Member'}</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:4px">
          ${u.role === 'admin'
            ? `<button onclick="window.open('/admin/','_blank')" title="Admin" class="user-menu-button">${iconSvg('shield')}</button>` : ''}
          <button title="Profile & dashboard" aria-label="Profile and dashboard" id="profile-view-btn" class="user-menu-button">${iconSvg('user')}</button>
          <button onclick="logout()" title="Logout" class="user-menu-button">${iconSvg('close')}</button>
        </div>
      </div>`;
    const avatar = sb.querySelector('.user-avatar');
    const initials = (u.name || '?').trim().slice(0, 1).toUpperCase();
    avatar.textContent = initials;
    if (typeof u.avatar === 'string' && u.avatar.length <= 180000 &&
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(u.avatar)) {
      const image = document.createElement('img');
      image.className = 'user-avatar-image';
      image.alt = '';
      image.src = u.avatar;
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.appendChild(image);
    }
    $('profile-view-btn')?.addEventListener('click', () => {
      setMobileMenuOpen(false);
      showView('profile');
    });
  } else {
    sb.innerHTML = `
      <div class="user-profile" style="cursor:pointer" onclick="window.location.href='/login.html'">
        <div class="user-avatar" style="background:#374151">?</div>
        <div class="user-info">
          <div class="user-name">Not logged in</div>
          <div class="user-plan" style="color:#a855f7">Login</div>
        </div>
      </div>`;
  }
}

function logout() {
  localStorage.removeItem('nx_token');
  localStorage.removeItem('nx_user');
  window.location.href = '/login.html';
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
function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' hr ago';
  return Math.floor(d / 86400) + ' days ago';
}

function renderNotifications(items) {
  const list = $('notification-list');
  const badge = $('notification-count');
  S.notifications = items;
  badge.hidden = items.length === 0;
  badge.textContent = items.length > 99 ? '99+' : String(items.length);
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'notification-empty';
    empty.textContent = 'You’re all caught up.';
    list.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notification-item';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const body = document.createElement('span');
    body.textContent = item.body;
    const timestamp = document.createElement('span');
    timestamp.textContent = timeAgo(item.createdAt);
    button.append(title, body, timestamp);
    button.addEventListener('click', () => openNotification(item));
    list.appendChild(button);
  });
}

async function refreshNotifications() {
  if (S.notificationsBusy || document.hidden || !token()) return;
  S.notificationsBusy = true;
  try {
    const response = await fetch(`${API}/notifications`, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Notifications failed (${response.status})`);
    if (!Array.isArray(data.notifications)) throw new Error('Invalid notifications response');
    renderNotifications(data.notifications);
    $('notification-live-status').textContent = `Live · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    $('notification-live-status').textContent = 'Could not refresh';
    $('notification-list').replaceChildren();
    const message = document.createElement('p');
    message.className = 'notification-empty';
    message.textContent = error.message;
    $('notification-list').appendChild(message);
  } finally {
    S.notificationsBusy = false;
  }
}

function openNotification(item) {
  $('notification-panel').hidden = true;
  $('notification-toggle').setAttribute('aria-expanded', 'false');
  if (item.type === 'friend') {
    setMobileMenuOpen(false);
    showView('add-friend');
    return;
  }
  if (!item.friendId) return;
  setMobileMenuOpen(false);
  showView('messages');
  $('social-portal')?.contentWindow?.postMessage({
    type: 'nymix-social-open-chat',
    friendId: item.friendId,
  }, window.location.origin);
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Must be logged in
  if (!requireAuth()) return;

  updateUserMenu();
  $('notification-toggle').addEventListener('click', () => {
    const open = $('notification-panel').hidden;
    $('notification-panel').hidden = !open;
    $('notification-toggle').setAttribute('aria-expanded', String(open));
    if (open) refreshNotifications();
  });
  document.addEventListener('click', event => {
    if (!$('notification-wrap').contains(event.target)) {
      $('notification-panel').hidden = true;
      $('notification-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      $('notification-panel').hidden = true;
      $('notification-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  refreshNotifications();
  setInterval(refreshNotifications, 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshNotifications();
  });
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== $('social-portal')?.contentWindow) return;
    if (event.data?.type === 'nymix-profile-updated' && event.data.user?.id === user()?.id) {
      localStorage.setItem('nx_user', JSON.stringify(event.data.user));
      updateUserMenu();
    } else if (event.data?.type === 'nymix-social-navigation' &&
        ['messages', 'people', 'feed', 'reels', 'profile'].includes(event.data.panel)) {
      showView(event.data.panel === 'people' ? 'add-friend' : event.data.panel, false);
    }
  });

  // Register navigation before awaited startup requests so the sidebar stays responsive.
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', event => {
      if (!a.dataset.view) return;
      event.preventDefault();
      setMobileMenuOpen(false);
      showView(a.dataset.view);
    });
  });
  $('mobile-menu-toggle')?.addEventListener('click', () => {
    setMobileMenuOpen($('mobile-menu-toggle').getAttribute('aria-expanded') !== 'true');
  });
  $('mobile-menu-close')?.addEventListener('click', () => setMobileMenuOpen(false));
  $('mobile-menu-backdrop')?.addEventListener('click', () => setMobileMenuOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMobileMenuOpen(false);
  });
  $('social-portal')?.addEventListener('load', () => {
    const activeView = document.querySelector('.nav-link.active')?.dataset.view;
    if (activeView === 'messages' || activeView === 'add-friend' || activeView === 'feed' || activeView === 'reels' || activeView === 'profile') showView(activeView);
  });

  await loadLiked();
  await buildPlaylist();
  buildGenres();
  buildRadio();
  renderPlayed();

  // ── Search ──
  const inp = $('search-input');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        setMobileMenuOpen(false);
        search(inp.value);
      }
    });
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
  // ── See all played ──
  $('see-all-btn').addEventListener('click', () => showView('liked'));

  // ── Keyboard Shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')     { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') next();
    if (e.code === 'ArrowLeft')  prev();
    if (e.code === 'KeyL' && S.current) toggleLike(S.current);
  });
});
