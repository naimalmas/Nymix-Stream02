/* =====================================================
   NYMIX — app.js
   ===================================================== */

// ── State ──────────────────────────────────────────────
const S = {
  ytPlayer: null,
  ytReady: false,
  current: null,
  queue: [],
  qIdx: -1,
  playing: false,
  shuffle: false,
  repeat: false,
  volume: 80,
  liked: JSON.parse(localStorage.getItem('nx_liked') || '[]'),
  history: JSON.parse(localStorage.getItem('nx_history') || '[]'),
  apiKey: localStorage.getItem('nx_key') || 'AIzaSyBtuBFaGE_skm5qqoOponxcLJalkuUlLLA',
};

// ── Demo Data ─────────────────────────────────────────
const DEMO = [
  { id:'JGwWNGJdvx8', title:'Shape of You',       artist:'Ed Sheeran',         dur:'3:53', album:'÷ (Divide)' },
  { id:'ktvTqknDobU', title:'Radioactive',          artist:'Imagine Dragons',    dur:'3:06', album:'Night Visions' },
  { id:'09R8_2nJtjg', title:'Payphone',             artist:'Maroon 5',           dur:'3:45', album:'Overexposed' },
  { id:'RgKAFK5djSk', title:'See You Again',        artist:'Wiz Khalifa',        dur:'3:50', album:'Furious 7' },
  { id:'YQHsXMglC9A', title:'Hello',                artist:'Adele',              dur:'4:55', album:'25' },
  { id:'OPf0YbXqDm0', title:'Happy',                artist:'Pharrell Williams',  dur:'3:53', album:'G I R L' },
  { id:'hT_nvWreIhg', title:'Counting Stars',       artist:'OneRepublic',        dur:'4:17', album:'Native' },
  { id:'CevxZvSJLk8', title:'Roar',                 artist:'Katy Perry',         dur:'3:43', album:'Prism' },
  { id:'e-ORhEE9VVg', title:'Blinding Lights',      artist:'The Weeknd',         dur:'3:20', album:'After Hours' },
  { id:'60ItHLz5WEA', title:'Firework',             artist:'Katy Perry',         dur:'3:47', album:'Teenage Dream' },
];

const GENRES = [
  { name:'Pop',       color:'linear-gradient(135deg,#7c3aed,#ec4899)', emoji:'🎵' },
  { name:'Hip-Hop',   color:'linear-gradient(135deg,#059669,#0d9488)', emoji:'🎤' },
  { name:'Rock',      color:'linear-gradient(135deg,#dc2626,#b45309)', emoji:'🎸' },
  { name:'Jazz',      color:'linear-gradient(135deg,#2563eb,#4f46e5)', emoji:'🎷' },
  { name:'Lo-fi',     color:'linear-gradient(135deg,#0f172a,#1e3a5f)', emoji:'🌙' },
  { name:'Electronic',color:'linear-gradient(135deg,#0891b2,#06b6d4)', emoji:'🎧' },
  { name:'Classical', color:'linear-gradient(135deg,#92400e,#b45309)', emoji:'🎻' },
  { name:'R&B',       color:'linear-gradient(135deg,#9d174d,#be185d)', emoji:'🎼' },
  { name:'Acoustic',  color:'linear-gradient(135deg,#065f46,#047857)', emoji:'🪕' },
  { name:'Indie',     color:'linear-gradient(135deg,#4c1d95,#5b21b6)', emoji:'✨' },
  { name:'K-Pop',     color:'linear-gradient(135deg,#be185d,#7c3aed)', emoji:'🌸' },
  { name:'Bangla',    color:'linear-gradient(135deg,#b45309,#92400e)', emoji:'🇧🇩' },
];

const RADIO_STATIONS = [
  { name:'Chill Vibes',   desc:'Relaxing beats',  emoji:'😌', query:'chill lo-fi' },
  { name:'Top 40',        desc:'Current hits',    emoji:'🔥', query:'top hits 2024' },
  { name:'Workout',       desc:'High energy',     emoji:'💪', query:'workout music' },
  { name:'Late Night',    desc:'Smooth & mellow', emoji:'🌙', query:'late night music' },
  { name:'Bangla Hits',   desc:'Best of Bangla',  emoji:'🎙️', query:'bangla song' },
  { name:'Acoustic',      desc:'Stripped back',   emoji:'🎸', query:'acoustic songs' },
];

// ── YT Player ─────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => {
  S.ytPlayer = new YT.Player('yt-player', {
    height:'1', width:'1',
    playerVars:{ autoplay:0, controls:0, disablekb:1, rel:0 },
    events:{
      onReady: e => { S.ytReady=true; e.target.setVolume(S.volume); startPoller(); },
      onStateChange: e => {
        if (e.data===YT.PlayerState.PLAYING) setPlaying(true);
        else if (e.data===YT.PlayerState.PAUSED) setPlaying(false);
        else if (e.data===YT.PlayerState.ENDED) onEnd();
      },
      onError: () => setTimeout(next,1500),
    }
  });
};

function startPoller() {
  setInterval(() => {
    if (!S.ytReady || !S.ytPlayer) return;
    try {
      const c = S.ytPlayer.getCurrentTime()||0;
      const d = S.ytPlayer.getDuration()||0;
      const pct = d>0?(c/d)*100:0;
      $('progress-fill').style.width = pct+'%';
      $('progress-dot').style.left = pct+'%';
      $('p-current').textContent = fmt(c);
      $('p-duration').textContent = fmt(d);
    } catch(_){}
  }, 500);
}

// ── Play ──────────────────────────────────────────────
function play(song) {
  S.current = song;
  if (S.ytReady) S.ytPlayer.loadVideoById(song.id);
  setPlaying(true);

  // Update player bar hero area in right panel
  const img = song.thumb || thumb(song.id);
  const npImg = $('np-card-img');
  const npPh  = $('np-placeholder');
  npImg.src = img;
  npImg.style.display = 'block';
  npPh.style.display = 'none';
  $('np-card-title').textContent = song.title;
  $('np-card-artist').textContent = song.artist;

  // Hero banner update
  $('hero-img').src = `https://img.youtube.com/vi/${song.id}/maxresdefault.jpg`;
  $('hero-title').textContent = song.title;
  $('hero-listeners').textContent = randListeners();

  // Like btn
  updateLikeBtn();

  // History
  addHistory(song);

  // Active row in table
  document.querySelectorAll('.playlist-table tbody tr').forEach(tr => {
    tr.classList.toggle('active-row', tr.dataset.id === song.id);
  });
  document.querySelectorAll('.playlist-table .row-num').forEach(td => {
    const tr = td.closest('tr');
    if (tr && tr.dataset.id === song.id) {
      td.innerHTML = `<div class="eq"><span></span><span></span><span></span></div>`;
    } else {
      td.textContent = td.dataset.n;
    }
  });

  document.title = `▶ ${song.title} — Nymix`;
}

function togglePlay() {
  if (!S.ytReady || !S.current) return;
  S.playing ? S.ytPlayer.pauseVideo() : S.ytPlayer.playVideo();
}
function setPlaying(v) {
  S.playing = v;
  $('play-icon-main').style.display = v?'none':'block';
  $('pause-icon-main').style.display = v?'block':'none';
}

function next() {
  if (!S.queue.length) return;
  S.qIdx = S.shuffle
    ? Math.floor(Math.random()*S.queue.length)
    : (S.qIdx+1)%S.queue.length;
  play(S.queue[S.qIdx]);
}
function prev() {
  if (!S.queue.length) return;
  if (S.ytReady && S.ytPlayer && S.ytPlayer.getCurrentTime()>3) {
    S.ytPlayer.seekTo(0,true); return;
  }
  S.qIdx = (S.qIdx-1+S.queue.length)%S.queue.length;
  play(S.queue[S.qIdx]);
}
function onEnd() { S.repeat ? S.ytPlayer.seekTo(0,true) : next(); }

function playQueue(songs, i) { S.queue=songs; S.qIdx=i; play(songs[i]); }

// ── Search ────────────────────────────────────────────
async function search(q) {
  if (!q.trim()) return;
  showView('discover');
  $('search-heading').textContent = `"${q}"`;
  $('search-status').textContent = '';
  $('search-results-grid').innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>Searching YouTube...</span></div>`;

  if (!S.apiKey) { renderGrid(DEMO.filter(s=>s.title.toLowerCase().includes(q.toLowerCase())||s.artist.toLowerCase().includes(q.toLowerCase())), q); return; }

  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q+' song')}&type=video&videoCategoryId=10&maxResults=20&key=${S.apiKey}`);
    if (!r.ok) { const e=await r.json(); throw new Error(e.error?.message||'API Error'); }
    const d = await r.json();
    const songs = d.items.map(it=>({
      id:it.id.videoId,
      title:clean(it.snippet.title),
      artist:it.snippet.channelTitle.replace(' - Topic','').replace('VEVO','').trim(),
      thumb:it.snippet.thumbnails.medium?.url,
      dur:'', album:'YouTube',
    }));
    renderGrid(songs, q);
  } catch(err) {
    $('search-results-grid').innerHTML = `<div class="loading-wrap"><span style="font-size:36px">⚠️</span><p>${err.message}</p></div>`;
  }
}

function searchTag(tag) { $('search-input').value=tag; search(tag); }

function renderGrid(songs, q) {
  $('search-status').textContent = `${songs.length} results for "${q}"`;
  S.queue = songs; S.qIdx = -1;
  const grid = $('search-results-grid');
  grid.innerHTML = '';
  if (!songs.length) { grid.innerHTML='<div class="loading-wrap"><span style="font-size:36px">🎵</span><p>No results found</p></div>'; return; }
  songs.forEach((s,i) => {
    const c = document.createElement('div');
    c.className='sg-card';
    c.innerHTML=`
      <img src="${s.thumb||thumb(s.id)}" alt="${esc(s.title)}" onerror="this.src='${thumb(s.id)}'" />
      <div class="sg-play-btn">▶</div>
      <div class="sg-card-info">
        <div class="sg-card-title">${esc(s.title)}</div>
        <div class="sg-card-artist">${esc(s.artist)}</div>
      </div>`;
    c.addEventListener('click',()=>playQueue(songs,i));
    grid.appendChild(c);
  });
}

// ── Playlist Table ────────────────────────────────────
function buildPlaylist(songs) {
  const tbody = $('playlist-body');
  tbody.innerHTML = '';
  songs.forEach((s,i) => {
    const tr = document.createElement('tr');
    tr.dataset.id = s.id;
    const liked = isLiked(s.id);
    tr.innerHTML = `
      <td class="row-num" data-n="${i+1}">${i+1}</td>
      <td class="td-title">${esc(s.title)}</td>
      <td class="td-artist">${esc(s.artist)}</td>
      <td class="td-time">${s.dur||'—'}</td>
      <td class="td-album">${s.album||'—'}</td>
      <td class="td-actions">
        <button class="row-like-btn ${liked?'liked':''}" title="Like">${liked?'♥':'♡'}</button>
      </td>`;
    tr.querySelector('.row-like-btn').addEventListener('click',e=>{
      e.stopPropagation();
      toggleLike(s);
      const btn=e.currentTarget;
      btn.classList.toggle('liked',isLiked(s.id));
      btn.textContent=isLiked(s.id)?'♥':'♡';
    });
    tr.addEventListener('click',()=>playQueue(songs,i));
    tbody.appendChild(tr);
  });
}

// ── Genres ────────────────────────────────────────────
function buildGenres() {
  const grid = $('genre-grid');
  grid.innerHTML='';
  GENRES.forEach(g=>{
    const c=document.createElement('div');
    c.className='genre-card';
    c.style.background=g.color;
    c.innerHTML=`<div style="font-size:28px;margin-bottom:8px">${g.emoji}</div><div>${g.name}</div>`;
    c.addEventListener('click',()=>{ $('search-input').value=g.name; search(g.name); });
    grid.appendChild(c);
  });
}

// ── Radio ─────────────────────────────────────────────
function buildRadio() {
  const grid = $('radio-grid');
  grid.innerHTML='';
  RADIO_STATIONS.forEach(r=>{
    const c=document.createElement('div');
    c.className='radio-card';
    c.innerHTML=`<div class="radio-emoji">${r.emoji}</div><div class="radio-title">${r.name}</div><div class="radio-desc">${r.desc}</div>`;
    c.addEventListener('click',()=>{ $('search-input').value=r.query; search(r.query); });
    grid.appendChild(c);
  });
}

// ── Liked ─────────────────────────────────────────────
function isLiked(id) { return S.liked.some(s=>s.id===id); }
function toggleLike(song) {
  if (isLiked(song.id)) S.liked=S.liked.filter(s=>s.id!==song.id);
  else S.liked.unshift(song);
  localStorage.setItem('nx_liked',JSON.stringify(S.liked));
  updateLikeBtn();
  renderLiked();
}
function updateLikeBtn() {
  if (!S.current) return;
  const liked=isLiked(S.current.id);
  const btn=$('p-like-btn');
  btn.textContent=liked?'♥':'♡';
  btn.style.color=liked?'#a855f7':'';
}
function renderLiked() {
  const list=$('liked-list');
  list.innerHTML='';
  if (!S.liked.length){list.innerHTML='<div style="color:#9ca3af;padding:30px;text-align:center">No liked songs yet ♡</div>';return;}
  S.liked.forEach((s,i)=>{
    const r=document.createElement('div');
    r.className='sl-row';
    r.innerHTML=`
      <img src="${s.thumb||thumb(s.id)}" onerror="this.src='${thumb(s.id)}'" />
      <div class="sl-info"><div class="sl-title">${esc(s.title)}</div><div class="sl-artist">${esc(s.artist)}</div></div>
      <button class="sl-like-btn" title="Unlike">♥</button>`;
    r.querySelector('.sl-like-btn').addEventListener('click',e=>{e.stopPropagation();toggleLike(s);});
    r.addEventListener('click',()=>playQueue(S.liked,i));
    list.appendChild(r);
  });
}

// ── History ───────────────────────────────────────────
function addHistory(song) {
  S.history=S.history.filter(s=>s.id!==song.id);
  S.history.unshift({...song, playedAt:Date.now()});
  if(S.history.length>30) S.history.pop();
  localStorage.setItem('nx_history',JSON.stringify(S.history));
  renderPlayed();
}
function renderPlayed() {
  const list=$('played-list');
  list.innerHTML='';
  if(!S.history.length){list.innerHTML='<div class="played-empty">গান বাজালে এখানে দেখাবে</div>';return;}
  S.history.slice(0,6).forEach((s,i)=>{
    const ago=timeAgo(s.playedAt);
    const r=document.createElement('div');
    r.className='played-item';
    r.innerHTML=`
      <img src="${s.thumb||thumb(s.id)}" onerror="this.src='${thumb(s.id)}'" />
      <div class="played-info"><div class="played-title">${esc(s.title)}</div><div class="played-artist">${esc(s.artist)}</div></div>
      <div class="played-time">${ago}</div>`;
    r.addEventListener('click',()=>play(s));
    list.appendChild(r);
  });
}

// ── Views ─────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const v=document.getElementById('view-'+name);
  if(v) v.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.view===name));
  const titles={home:'What\'s hot',discover:'Discover',browse:'Browse',liked:'Your Library',radio:'Radio',albums:'Albums',songs:'Songs',artists:'Artists'};
  $('view-title').textContent=titles[name]||'';
}

// ── Helpers ───────────────────────────────────────────
const $=id=>document.getElementById(id);
const thumb=id=>`https://img.youtube.com/vi/${id}/mqdefault.jpg`;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clean=s=>s.replace(/\s*\(.*?\)\s*/g,'').replace(/\s*\[.*?\]\s*/g,'').replace(/ - Official.*$/i,'').trim();
const fmt=s=>{if(!s||isNaN(s))return'0:00';const m=Math.floor(s/60),sc=Math.floor(s%60);return`${m}:${sc.toString().padStart(2,'0')}`;};
const randListeners=()=>(Math.floor(Math.random()*900+100)/100).toFixed(2)+'M';
function timeAgo(ts) {
  const d=Math.floor((Date.now()-ts)/1000);
  if(d<60) return 'just now';
  if(d<3600) return Math.floor(d/60)+' min ago';
  if(d<86400) return Math.floor(d/3600)+' hr ago';
  return Math.floor(d/86400)+' days ago';
}

// ── Settings ─────────────────────────────────────────
function saveKey() {
  const k=$('api-input').value.trim();
  if(!k){$('api-msg').textContent='Please enter a key';$('api-msg').className='api-msg err';return;}
  S.apiKey=k; localStorage.setItem('nx_key',k);
  $('api-msg').textContent='✓ Saved!'; $('api-msg').className='api-msg ok';
  setTimeout(()=>$('modal-bg').classList.add('hidden'),800);
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  buildPlaylist(DEMO);
  buildGenres();
  buildRadio();
  renderLiked();
  renderPlayed();

  if(S.apiKey) { $('api-input').value=S.apiKey; $('api-msg').textContent='✓ API Key ready'; $('api-msg').className='api-msg ok'; }

  // Nav links
  document.querySelectorAll('.nav-link').forEach(a=>{
    a.addEventListener('click',()=>showView(a.dataset.view));
  });

  // Search
  const inp=$('search-input');
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter') search(inp.value); });
  inp.addEventListener('input',()=>{
    clearTimeout(inp._t);
    if(inp.value.trim().length>2) inp._t=setTimeout(()=>search(inp.value),600);
  });

  // Player controls
  $('btn-playpause').addEventListener('click',togglePlay);
  $('btn-next').addEventListener('click',next);
  $('btn-prev').addEventListener('click',prev);
  $('btn-shuffle').addEventListener('click',()=>{ S.shuffle=!S.shuffle; $('btn-shuffle').classList.toggle('active',S.shuffle); });
  $('btn-repeat').addEventListener('click',()=>{ S.repeat=!S.repeat; $('btn-repeat').classList.toggle('active',S.repeat); });
  $('p-like-btn').addEventListener('click',()=>{ if(S.current) toggleLike(S.current); });

  // Volume
  $('volume-slider').addEventListener('input',e=>{
    S.volume=parseInt(e.target.value);
    if(S.ytReady) S.ytPlayer.setVolume(S.volume);
  });

  // Progress seek
  $('progress-track').addEventListener('click',e=>{
    if(!S.ytReady) return;
    const r=e.currentTarget.getBoundingClientRect();
    const pct=(e.clientX-r.left)/r.width;
    const d=S.ytPlayer.getDuration()||0;
    S.ytPlayer.seekTo(d*pct,true);
  });

  // Hero play
  $('hero-play-btn').addEventListener('click',()=>playQueue(DEMO,0));

  // Show all → go to discover with top songs
  $('show-all-btn').addEventListener('click',()=>{
    showView('discover');
    $('search-heading').textContent='All Songs';
    renderGrid(DEMO,'Top Songs');
  });

  // See all played
  $('see-all-btn').addEventListener('click',()=>{
    showView('liked');
  });

  // Settings
  $('settings-btn').addEventListener('click',()=>$('modal-bg').classList.remove('hidden'));
  $('modal-close').addEventListener('click',()=>$('modal-bg').classList.add('hidden'));
  $('modal-bg').addEventListener('click',e=>{ if(e.target===$('modal-bg')) $('modal-bg').classList.add('hidden'); });
  $('save-btn').addEventListener('click',saveKey);

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT') return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    if(e.code==='ArrowRight') next();
    if(e.code==='ArrowLeft')  prev();
    if(e.code==='KeyL' && S.current) toggleLike(S.current);
  });
});
