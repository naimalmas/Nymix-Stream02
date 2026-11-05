const API = '/api';
const state = {
  user: JSON.parse(localStorage.getItem('nx_user') || 'null'),
  friends: [],
  requests: [],
  rooms: [],
  games: [],
  activeFriend: null,
  activeRoom: null,
  activeGame: null,
  chatMessages: [],
  chatAfter: 0,
  youtubeReady: false,
  player: null,
  playerReady: false,
  playerSong: null,
  playbackSignature: '',
  playbackSyncing: false,
  refreshBusy: false,
  noticeTimer: null,
};

const $ = id => document.getElementById(id);
const token = () => localStorage.getItem('nx_token');

function showNotice(message, error = false) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.toggle('error', error);
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4500);
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(options.headers || {}),
    },
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Request failed (${response.status})`); }
  if (response.status === 401) {
    localStorage.removeItem('nx_token');
    localStorage.removeItem('nx_user');
    window.location.href = '/login.html';
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
const put = (path, body = {}) => api(path, { method: 'PUT', body: JSON.stringify(body) });
const deleteRequest = path => api(path, { method: 'DELETE' });

function makeButton(label, action, style = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${style}`;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function makePerson(profile, actions = []) {
  const row = document.createElement('div');
  row.className = 'person';
  const info = document.createElement('div');
  info.className = 'person-info';
  const avatar = document.createElement('span');
  avatar.className = 'person-avatar';
  avatar.textContent = (profile.name || '?').trim().charAt(0).toUpperCase();
  const nameWrap = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'person-name';
  name.textContent = profile.name || 'Nymix user';
  nameWrap.appendChild(name);
  info.append(avatar, nameWrap);
  const actionWrap = document.createElement('div');
  actionWrap.className = 'person-actions';
  actions.forEach(button => actionWrap.appendChild(button));
  row.append(info, actionWrap);
  return row;
}

function renderList(container, items, emptyText, renderItem) {
  container.replaceChildren();
  container.classList.toggle('empty-state', items.length === 0);
  if (!items.length) {
    container.textContent = emptyText;
    return;
  }
  items.forEach(item => container.appendChild(renderItem(item)));
}

function setPanel(panelName) {
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${panelName}`));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === panelName));
}

function renderFriends() {
  $('friend-count').textContent = String(state.friends.length);
  renderList($('friends-list'), state.friends, 'Your accepted friends will appear here.', friend =>
    makePerson(friend, [
      makeButton('Chat', () => selectFriend(friend)),
      makeButton('Remove', async () => {
        if (!confirm(`Remove ${friend.name} from your friends?`)) return;
        try {
          await deleteRequest(`/friends/${encodeURIComponent(friend.relationId)}`);
          showNotice('Friend removed.');
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }, 'danger'),
    ]),
  );
  renderList($('chat-friends'), state.friends, 'Add a friend to start chatting.', friend =>
    makePerson(friend, [makeButton(state.activeFriend?.id === friend.id ? 'Selected' : 'Message', () => selectFriend(friend))]),
  );
}

function renderRequests() {
  renderList($('requests-list'), state.requests, 'No pending requests.', request => {
    const actions = request.direction === 'incoming'
      ? [
          makeButton('Accept', async () => {
            try {
              await put(`/friends/${encodeURIComponent(request.id)}`, { status: 'accepted' });
              showNotice(`You and ${request.name} are now friends.`);
              await refreshOverview();
            } catch (error) { showNotice(error.message, true); }
          }),
          makeButton('Decline', async () => {
            try {
              await put(`/friends/${encodeURIComponent(request.id)}`, { status: 'rejected' });
              await refreshOverview();
            } catch (error) { showNotice(error.message, true); }
          }, 'danger'),
        ]
      : [makeButton('Pending', () => {}, 'secondary')];
    return makePerson(request, actions);
  });
}

function renderSearchResults(users) {
  renderList($('search-results'), users, 'No matching users found.', profile => {
    let action;
    if (profile.relation === 'friends') action = makeButton('Friends', () => selectFriend(profile));
    else if (profile.relation === 'sent') action = makeButton('Request sent', () => {}, 'secondary');
    else if (profile.relation === 'received') action = makeButton('Respond below', () => setPanel('people'), 'secondary');
    else action = makeButton('Add friend', async () => {
      try {
        await post(`/friends/request/${encodeURIComponent(profile.id)}`);
        showNotice(`Friend request sent to ${profile.name}.`);
        $('user-search-form').requestSubmit();
        await refreshOverview();
      } catch (error) { showNotice(error.message, true); }
    });
    return makePerson(profile, [action]);
  });
}

function renderMessages(container, messages, emptyText) {
  container.replaceChildren();
  container.classList.toggle('empty-state', messages.length === 0);
  if (!messages.length) {
    container.textContent = emptyText;
    return;
  }
  messages.forEach(message => {
    const bubble = document.createElement('div');
    bubble.className = `message${message.from === state.user.id ? ' mine' : ''}`;
    const author = document.createElement('small');
    const date = new Date(message.ts);
    author.textContent = `${message.fromName || 'Friend'} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const text = document.createElement('span');
    text.textContent = message.text;
    bubble.append(author, text);
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

async function selectFriend(friend) {
  state.activeFriend = friend;
  state.chatMessages = [];
  state.chatAfter = 0;
  $('chat-title').textContent = friend.name;
  $('chat-input').disabled = false;
  $('chat-send').disabled = false;
  setPanel('chat');
  await refreshChat(true);
  renderFriends();
}

async function refreshChat(initial = false) {
  if (!state.activeFriend) return;
  const after = initial ? 0 : Math.max(0, state.chatAfter - 1);
  const messages = await api(`/chat/${encodeURIComponent(state.activeFriend.id)}?after=${after}`);
  const seen = new Set(state.chatMessages.map(message => message.id));
  state.chatMessages.push(...messages.filter(message => !seen.has(message.id)));
  state.chatMessages.sort((a, b) => a.ts - b.ts);
  state.chatAfter = Math.max(state.chatAfter, ...state.chatMessages.map(message => message.ts), 0);
  renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
}

async function refreshOverview() {
  const data = await api('/social/overview');
  state.friends = data.friends;
  state.requests = data.requests;
  state.rooms = data.rooms;
  state.games = data.games;
  renderFriends();
  renderRequests();
  renderRooms();
  renderGames();
}

function renderRooms() {
  renderList($('rooms-list'), state.rooms, 'No active listening rooms.', room => {
    const row = document.createElement('div');
    row.className = 'game-room';
    const info = document.createElement('span');
    info.textContent = `${room.song?.title || 'Listening room'} · by ${room.hostName} · ${room.code}`;
    row.append(info, makeButton('Open', () => joinListenRoom(room.code)));
    return row;
  });
}

function renderGames() {
  renderList($('games-list'), state.games, 'No active games.', game => {
    const row = document.createElement('div');
    row.className = 'game-room';
    const info = document.createElement('span');
    info.textContent = `Room ${game.code} · ${game.status} · ${game.members.length}/2`;
    row.append(info, makeButton('Open', () => openGame(game.code)));
    return row;
  });
}

function renderSongResults(songs) {
  renderList($('song-results'), songs, 'No songs found.', song => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'song-result';
    const image = document.createElement('img');
    image.src = song.thumb || `https://img.youtube.com/vi/${encodeURIComponent(song.id)}/mqdefault.jpg`;
    image.alt = '';
    const info = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = song.title;
    const artist = document.createElement('span');
    artist.className = 'song-artist';
    artist.textContent = song.artist;
    info.append(title, artist);
    button.append(image, info);
    button.addEventListener('click', async () => {
      if (state.activeRoom && state.lastRoom?.hostId === state.user.id) {
        try {
          await put(`/listen-rooms/${encodeURIComponent(state.activeRoom)}`, { action: 'song', song });
          await refreshListenRoom();
          showNotice(`Now playing ${song.title} for the room.`);
        } catch (error) { showNotice(error.message, true); }
      } else {
        await createListenRoom(song);
      }
    });
    return button;
  });
}

async function createListenRoom(song) {
  try {
    const room = await post('/listen-rooms', { song });
    state.activeRoom = room.code;
    setPanel('listen');
    await refreshOverview();
    await refreshListenRoom();
    showNotice(`Listening room ${room.code} created. Share the code with a friend.`);
  } catch (error) { showNotice(error.message, true); }
}

async function joinListenRoom(code) {
  try {
    const room = await post(`/listen-rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`);
    state.activeRoom = room.code;
    setPanel('listen');
    await refreshOverview();
    await refreshListenRoom();
    showNotice(`Joined room ${room.code}.`);
  } catch (error) { showNotice(error.message, true); }
}

function ensureRoomPlayer(room) {
  if (!state.youtubeReady || !window.YT?.Player) return;
  if (!state.player) {
    state.player = new YT.Player('room-player', {
      width: '100%',
      height: '200',
      videoId: room.song.id,
      playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          state.playerReady = true;
          if (state.lastRoom) syncRoomPlayback(state.lastRoom, true);
        },
        onError: () => showNotice('This YouTube video cannot be played here.', true),
      },
    });
    state.playerSong = room.song.id;
  }
}

function syncRoomPlayback(room, force = false) {
  if (!state.playerReady || !state.player) return;
  if (state.playbackSyncing) return;
  const songChanged = state.playerSong !== room.song.id;
  const signature = `${room.song.id}:${room.playing}:${room.stateChangedAt}`;
  let drift = Infinity;
  try { drift = Math.abs((state.player.getCurrentTime() || 0) - room.position); } catch {}
  if (!force && !songChanged && state.playbackSignature === signature && (!room.playing || drift < 5)) return;
  state.playbackSyncing = true;
  state.playbackSignature = signature;
  state.playerSong = room.song.id;
  try {
    if (songChanged) state.player.loadVideoById({ videoId: room.song.id, startSeconds: room.position });
    else if (force || drift > 5) state.player.seekTo(room.position, true);
    if (room.playing) state.player.playVideo();
    else state.player.pauseVideo();
  } catch {}
  setTimeout(() => { state.playbackSyncing = false; }, 250);
}

async function refreshListenRoom() {
  if (!state.activeRoom) return;
  try {
    const room = await api(`/listen-rooms/${encodeURIComponent(state.activeRoom)}`);
    state.lastRoom = room;
    $('room-title').textContent = room.song?.title || `Room ${room.code}`;
    $('room-code-display').textContent = `Room code: ${room.code} · Host: ${room.hostName}`;
    $('room-members').textContent = `${room.members.length} listening`;
    $('player-placeholder').hidden = true;
    const isHost = room.hostId === state.user.id;
    $('room-play').disabled = false;
    $('room-play').textContent = isHost ? (room.playing ? 'Playing…' : 'Play') : 'Play on my device';
    $('room-pause').disabled = false;
    $('room-pause').textContent = isHost ? 'Pause' : 'Pause on my device';
    $('room-leave').disabled = false;
    $('room-chat-input').disabled = false;
    $('room-chat-send').disabled = false;
    $('room-hint').textContent = isHost
      ? 'You are the host. Playback changes sync to everyone in the room.'
      : 'Playback follows the host. If autoplay is blocked, press “Play on my device”.';
    ensureRoomPlayer(room);
    syncRoomPlayback(room);
    renderMessages($('room-messages'), room.messages || [], 'No messages yet.');
  } catch (error) {
    if (error.message.includes('not found')) {
      state.activeRoom = null;
      state.lastRoom = null;
      $('room-title').textContent = 'No room selected';
      $('room-code-display').textContent = '';
      $('room-members').textContent = '';
      $('player-placeholder').hidden = false;
      $('player-placeholder').textContent = 'This room has ended or you left it.';
      $('room-play').disabled = true;
      $('room-pause').disabled = true;
      $('room-leave').disabled = true;
      $('room-chat-input').disabled = true;
      $('room-chat-send').disabled = true;
      return;
    }
    showNotice(error.message, true);
  }
}

async function openGame(code) {
  try {
    const game = await api(`/games/${encodeURIComponent(code.trim().toUpperCase())}`);
    state.activeGame = game.code;
    setPanel('games');
    renderGame(game);
  } catch (error) { showNotice(error.message, true); }
}

function renderGame(game) {
  $('game-title').textContent = game.members.map(member => `${member.name} (${member.symbol})`).join(' vs ') || 'Tic-tac-toe';
  $('game-code-display').textContent = `Room code: ${game.code}`;
  const status = game.status === 'waiting' ? 'Waiting for a friend to join…'
    : game.status === 'draw' ? 'It’s a draw!'
      : game.status === 'done' ? `${game.members.find(member => member.id === game.winner)?.name || 'A player'} wins!`
        : game.turn === state.user.id ? 'Your turn' : `${game.members.find(member => member.id === game.turn)?.name || 'Friend'}’s turn`;
  $('game-status').textContent = status;
  $('game-board').replaceChildren();
  game.board.forEach((value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `board-cell${value ? ` ${value.toLowerCase()}` : ''}`;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', value ? `Square ${index + 1}: ${value}` : `Square ${index + 1}, empty`);
    button.textContent = value || '';
    button.disabled = game.status !== 'playing' || game.turn !== state.user.id || Boolean(value);
    button.addEventListener('click', async () => {
      try {
        const updated = await post(`/games/${encodeURIComponent(game.code)}/moves`, { index });
        renderGame(updated);
      } catch (error) { showNotice(error.message, true); }
    });
    $('game-board').appendChild(button);
  });
  $('game-reset').disabled = game.hostId !== state.user.id || game.members.length !== 2;
  $('game-leave').disabled = false;
}

async function refreshActiveGame() {
  if (!state.activeGame) return;
  try { renderGame(await api(`/games/${encodeURIComponent(state.activeGame)}`)); }
  catch (error) {
    if (error.message.includes('not found')) {
      state.activeGame = null;
      $('game-title').textContent = 'No game selected';
      $('game-code-display').textContent = '';
      $('game-status').textContent = 'This game has ended or you left it.';
      $('game-board').replaceChildren();
      $('game-reset').disabled = true;
      $('game-leave').disabled = true;
    }
  }
}

async function refreshSocial() {
  if (state.refreshBusy || document.hidden) return;
  state.refreshBusy = true;
  try {
    await refreshOverview();
    if (state.activeFriend) await refreshChat();
    if (state.activeRoom) await refreshListenRoom();
    if (state.activeGame) await refreshActiveGame();
  } catch (error) {
    if (!window.location.pathname.endsWith('/login.html')) showNotice(error.message, true);
  } finally {
    state.refreshBusy = false;
  }
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setPanel(tab.dataset.panel)));

$('sign-out').addEventListener('click', () => {
  localStorage.removeItem('nx_token');
  localStorage.removeItem('nx_user');
  window.location.href = '/login.html';
});

$('user-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('user-search').value.trim();
  if (query.length < 2) return showNotice('Enter at least 2 characters to search.', true);
  try { renderSearchResults(await api(`/users/search?q=${encodeURIComponent(query)}`)); }
  catch (error) { showNotice(error.message, true); }
});

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  if (!state.activeFriend || !text) return;
  try {
    const message = await post(`/chat/${encodeURIComponent(state.activeFriend.id)}`, { text });
    state.chatMessages.push(message);
    state.chatAfter = Math.max(state.chatAfter, message.ts);
    $('chat-input').value = '';
    renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
  } catch (error) { showNotice(error.message, true); }
});

$('song-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('song-search').value.trim();
  if (!query) return;
  try {
    const result = await api(`/search?q=${encodeURIComponent(query)}`);
    renderSongResults(result.items || []);
    if (result.searchLimited) showNotice('Song search is limited to featured songs until a YouTube API key is configured.', true);
  } catch (error) { showNotice(error.message, true); }
});

$('room-join-form').addEventListener('submit', async event => {
  event.preventDefault();
  const code = $('room-code').value.trim();
  if (!code) return;
  await joinListenRoom(code);
  $('room-code').value = '';
});

$('room-play').addEventListener('click', async () => {
  const room = state.lastRoom;
  if (!room || !state.playerReady) return showNotice('The music player is still loading.', true);
  if (room.hostId === state.user.id) {
    try { await put(`/listen-rooms/${encodeURIComponent(room.code)}`, { action: 'play', position: state.player.getCurrentTime() || room.position }); }
    catch (error) { return showNotice(error.message, true); }
  }
  state.playbackSignature = '';
  try { state.player.playVideo(); } catch {}
});

$('room-pause').addEventListener('click', async () => {
  const room = state.lastRoom;
  if (!room || !state.playerReady) return;
  const position = state.player.getCurrentTime() || room.position;
  if (room.hostId === state.user.id) {
    try { await put(`/listen-rooms/${encodeURIComponent(room.code)}`, { action: 'pause', position }); }
    catch (error) { return showNotice(error.message, true); }
  }
  try { state.player.pauseVideo(); } catch {}
});

$('room-leave').addEventListener('click', async () => {
  if (!state.activeRoom) return;
  try {
    await deleteRequest(`/listen-rooms/${encodeURIComponent(state.activeRoom)}`);
    state.activeRoom = null;
    state.lastRoom = null;
    state.playbackSignature = '';
    if (state.playerReady) state.player.stopVideo();
    $('room-title').textContent = 'No room selected';
    $('room-code-display').textContent = '';
    $('room-members').textContent = '';
    $('player-placeholder').hidden = false;
    $('player-placeholder').textContent = 'Join a room or start one to listen together.';
    $('room-play').disabled = true;
    $('room-pause').disabled = true;
    $('room-leave').disabled = true;
    $('room-chat-input').disabled = true;
    $('room-chat-send').disabled = true;
    $('room-messages').textContent = 'Room chat appears here.';
    await refreshOverview();
  } catch (error) { showNotice(error.message, true); }
});

$('room-chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeRoom) return;
  const input = $('room-chat-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await post(`/listen-rooms/${encodeURIComponent(state.activeRoom)}/chat`, { text });
    input.value = '';
    await refreshListenRoom();
  } catch (error) { showNotice(error.message, true); }
});

$('game-create').addEventListener('click', async () => {
  try {
    const game = await post('/games');
    state.activeGame = game.code;
    setPanel('games');
    renderGame(game);
    await refreshOverview();
    showNotice(`Game created. Share code ${game.code} with a friend.`);
  } catch (error) { showNotice(error.message, true); }
});

$('game-join-form').addEventListener('submit', async event => {
  event.preventDefault();
  const code = $('game-code-input').value.trim().toUpperCase();
  if (!code) return;
  try {
    const game = await post(`/games/${encodeURIComponent(code)}/join`);
    state.activeGame = game.code;
    renderGame(game);
    $('game-code-input').value = '';
    await refreshOverview();
  } catch (error) { showNotice(error.message, true); }
});

$('game-reset').addEventListener('click', async () => {
  if (!state.activeGame) return;
  try { renderGame(await post(`/games/${encodeURIComponent(state.activeGame)}/reset`)); }
  catch (error) { showNotice(error.message, true); }
});

$('game-leave').addEventListener('click', async () => {
  if (!state.activeGame) return;
  try {
    await deleteRequest(`/games/${encodeURIComponent(state.activeGame)}`);
    state.activeGame = null;
    $('game-title').textContent = 'No game selected';
    $('game-code-display').textContent = '';
    $('game-status').textContent = 'Create a game or join a friend’s game.';
    $('game-board').replaceChildren();
    $('game-reset').disabled = true;
    $('game-leave').disabled = true;
    await refreshOverview();
  } catch (error) { showNotice(error.message, true); }
});

window.onYouTubeIframeAPIReady = () => {
  state.youtubeReady = true;
  if (state.lastRoom) ensureRoomPlayer(state.lastRoom);
};

if (!token() || !state.user || state.user.role !== 'user') {
  window.location.href = '/login.html';
} else {
  $('account-name').textContent = state.user.name || state.user.email || 'Member';
  refreshSocial();
  setInterval(refreshSocial, 4500);
}
