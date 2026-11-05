const API = '/api';
const state = {
  user: JSON.parse(localStorage.getItem('nx_user') || 'null'),
  friends: [],
  lastMessages: {},
  requests: [],
  gameInvites: [],
  roomInvites: [],
  suggestions: [],
  rooms: [],
  games: [],
  activeFriend: null,
  activeRoom: null,
  activeRoomFriendId: null,
  activeGame: null,
  activeGameFriendId: null,
  chatMessages: [],
  chatAfter: 0,
  call: {
    status: 'idle',
    sessionId: null,
    friendId: null,
    peer: null,
    localStream: null,
    pendingCandidates: [],
    outgoingCandidates: [],
    signalReady: false,
    muted: false,
    seenSignals: new Set(),
    offer: null,
    timeout: null,
  },
  voiceRecorder: null,
  voiceChunks: [],
  voiceStream: null,
  voiceStartedAt: 0,
  voiceTimeout: null,
  callSignalError: '',
  youtubeReady: false,
  player: null,
  playerReady: false,
  playerSong: null,
  playbackSignature: '',
  playbackSyncing: false,
  refreshBusy: false,
  searchTimer: null,
  searchSequence: 0,
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
    if (window.parent !== window) window.top.location.href = '/login.html';
    else window.location.href = '/login.html';
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
  $('discover-friend-count').textContent = String(state.friends.length);
  renderList($('friends-list'), state.friends, 'Your friends will show up here.', friend =>
    makePerson(friend, [
      makeButton('Message', () => selectFriend(friend), 'primary'),
      makeButton('Play', () => challengeFriend(friend)),
      makeButton('Remove', async () => {
        if (!confirm(`Remove ${friend.name} from your friends?`)) return;
        try {
          await deleteRequest(`/friends/${encodeURIComponent(friend.relationId)}`);
          showNotice('Friend removed.');
          await refreshOverview();
          await refreshSuggestions();
        } catch (error) { showNotice(error.message, true); }
      }, 'danger'),
    ]),
  );
  const query = $('thread-search').value.trim().toLocaleLowerCase();
  const friends = [...state.friends].sort((a, b) =>
    (state.lastMessages[b.id]?.ts || 0) - (state.lastMessages[a.id]?.ts || 0),
  ).filter(friend =>
    !query || friend.name.toLocaleLowerCase().includes(query) ||
      (state.lastMessages[friend.id]?.text || '').toLocaleLowerCase().includes(query),
  );
  renderList($('chat-friends'), friends, 'No friends yet. Find people to start a conversation.', friend => {
    const thread = document.createElement('button');
    thread.type = 'button';
    const lastMessage = state.lastMessages[friend.id];
    thread.className = `thread-row${state.activeFriend?.id === friend.id ? ' active' : ''}${lastMessage ? ' has-message' : ''}`;
    thread.setAttribute('aria-current', state.activeFriend?.id === friend.id ? 'true' : 'false');
    const avatar = document.createElement('span');
    avatar.className = 'thread-avatar';
    avatar.textContent = friend.name.trim().slice(0, 1).toUpperCase();
    const copy = document.createElement('span');
    copy.className = 'thread-copy';
    const topline = document.createElement('span');
    topline.className = 'thread-topline';
    const name = document.createElement('strong');
    name.textContent = friend.name;
    topline.appendChild(name);
    if (lastMessage) {
      const time = document.createElement('time');
      time.dateTime = new Date(lastMessage.ts).toISOString();
      time.textContent = formatThreadTime(lastMessage.ts);
      topline.appendChild(time);
    }
    const preview = document.createElement('span');
    preview.textContent = lastMessage
      ? `${lastMessage.from === state.user.id ? 'You: ' : ''}${lastMessage.text || 'Voice message'}`
      : 'Start a conversation';
    copy.append(topline, preview);
    const arrow = document.createElement('span');
    arrow.className = 'thread-arrow';
    arrow.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#arrow-right"></use></svg>';
    thread.append(avatar, copy, arrow);
    thread.addEventListener('click', () => selectFriend(friend));
    return thread;
  });
}

function formatThreadTime(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (date >= startOfToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date >= new Date(startOfToday - 6 * 86400000)) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function renderRequests() {
  $('request-count').textContent = String(state.requests.filter(request => request.direction === 'incoming').length);
  renderList($('requests-list'), state.requests, 'No pending requests.', request => {
    const actions = request.direction === 'incoming'
      ? [
          makeButton('Accept', async () => {
            try {
              await put(`/friends/${encodeURIComponent(request.id)}`, { status: 'accepted' });
              showNotice(`You and ${request.name} are now friends.`);
              await refreshOverview();
              await refreshSuggestions();
              if ($('user-search').value.trim().length >= 2) await searchUsers($('user-search').value.trim());
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

function renderUserCards(container, users, emptyText) {
  renderList(container, users, emptyText, profile => {
    const card = document.createElement('article');
    card.className = 'user-card';
    const top = document.createElement('div');
    top.className = 'user-card-top';
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase();
    const copy = document.createElement('div');
    copy.className = 'profile-copy';
    const name = document.createElement('h3');
    name.className = 'profile-name';
    name.textContent = profile.name || 'Nymix member';
    const hint = document.createElement('p');
    hint.className = 'profile-hint';
    hint.textContent = profile.mutualFriends
      ? `${profile.mutualFriends} mutual ${profile.mutualFriends === 1 ? 'friend' : 'friends'}`
      : profile.relation === 'friends' ? 'In your circle' : 'Nymix member';
    copy.append(name, hint);
    top.append(avatar, copy);
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    let action;
    if (profile.relation === 'friends') {
      action = makeButton('Message', () => selectFriend(profile), 'primary');
      actions.append(action, makeButton('Play', () => challengeFriend(profile)));
    } else if (profile.relation === 'sent') {
      action = makeButton('Request sent', () => {}, 'secondary');
      actions.append(action);
    } else if (profile.relation === 'received') {
      action = makeButton('View request', () => $('requests-list').scrollIntoView({ behavior: 'smooth', block: 'center' }), 'secondary');
      actions.append(action);
    } else action = makeButton('Add friend', async () => {
      try {
        await post(`/friends/request/${encodeURIComponent(profile.id)}`);
        showNotice(`Friend request sent to ${profile.name}.`);
        await refreshOverview();
        await refreshSuggestions();
        if ($('user-search').value.trim().length >= 2) await searchUsers($('user-search').value.trim());
      } catch (error) { showNotice(error.message, true); }
    }, 'primary');
    if (profile.relation === 'none') actions.append(action);
    card.append(top, actions);
    return card;
  });
}

function renderSearchResults(users) {
  $('search-card').hidden = false;
  $('suggestions-card').hidden = true;
  renderUserCards($('search-results'), users, 'No matching people found. Try another name or email.');
}

function renderSuggestions() {
  $('suggestion-count').textContent = String(state.suggestions.length);
  renderUserCards($('suggestions-list'), state.suggestions, 'You’re all caught up. Try searching for someone by name or email.');
}

function renderGameInvites() {
  const card = $('game-invites-card');
  card.hidden = state.gameInvites.length === 0;
  renderList($('game-invites-list'), state.gameInvites, '', invite => {
    const row = document.createElement('div');
    row.className = 'invite-item';
    const title = document.createElement('strong');
    title.textContent = `${invite.hostName} challenged you`;
    const detail = document.createElement('span');
    detail.textContent = 'Tic-tac-toe · your move to accept';
    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    actions.append(
      makeButton('Accept', async () => {
        try {
          const game = await post(`/games/${encodeURIComponent(invite.code)}/join`);
          state.activeGame = game.code;
          state.activeGameFriendId = invite.hostId;
          const friend = state.friends.find(item => item.id === invite.hostId);
          if (friend) await selectFriend(friend);
          renderGame(game);
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }, 'primary'),
      makeButton('Decline', async () => {
        try {
          await post(`/games/${encodeURIComponent(invite.code)}/decline`);
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }),
    );
    row.append(title, detail, actions);
    return row;
  });
}

async function challengeFriend(friend) {
  try {
    await selectFriend(friend);
    const game = await post('/games', { inviteeId: friend.id });
    state.activeGame = game.code;
    state.activeGameFriendId = friend.id;
    renderGame(game);
    await refreshOverview();
    showNotice(`Game invite sent to ${friend.name}.`);
  } catch (error) { showNotice(error.message, true); }
}

function renderChatInvites() {
  const container = $('chat-invites');
  container.replaceChildren();
  if (!state.activeFriend) return;
  const gameInvites = state.gameInvites.filter(invite => invite.hostId === state.activeFriend.id);
  const roomInvites = state.roomInvites.filter(invite => invite.hostId === state.activeFriend.id);
  gameInvites.forEach(invite => {
    const card = document.createElement('div');
    card.className = 'chat-invite game-invite';
    const text = document.createElement('span');
    text.innerHTML = `<strong>${escapeHtml(invite.hostName)}</strong> invited you to play <strong>Tic-tac-toe</strong>`;
    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    actions.append(
      makeButton('Play now', async () => {
        try {
          const game = await post(`/games/${encodeURIComponent(invite.code)}/join`);
          state.activeGame = game.code;
          state.activeGameFriendId = invite.hostId;
          renderGame(game);
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }, 'primary'),
      makeButton('Decline', async () => {
        try {
          await post(`/games/${encodeURIComponent(invite.code)}/decline`);
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }),
    );
    card.append(text, actions);
    container.appendChild(card);
  });
  roomInvites.forEach(invite => {
    const card = document.createElement('div');
    card.className = 'chat-invite room-invite';
    const text = document.createElement('span');
    text.innerHTML = `<strong>${escapeHtml(invite.hostName)}</strong> invited you to listen to <strong>${escapeHtml(invite.song?.title || 'a song')}</strong>`;
    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    actions.append(
      makeButton('Listen now', () => joinListenRoom(invite.code, invite.hostId), 'primary'),
      makeButton('Later', async () => {
        try {
          await post(`/listen-rooms/${encodeURIComponent(invite.code)}/decline`);
          await refreshOverview();
        } catch (error) { showNotice(error.message, true); }
      }),
    );
    card.append(text, actions);
    container.appendChild(card);
  });
  if (state.activeGame && state.activeGameFriendId === state.activeFriend.id) {
    $('inline-game').hidden = false;
  }
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value || '');
  return element.innerHTML;
}

function renderInlineGame(game) {
  const visible = Boolean(state.activeFriend && state.activeGameFriendId === state.activeFriend.id);
  $('inline-game').hidden = !visible;
  if (!visible) return;
  const players = game.members.map(member => `${member.name} (${member.symbol})`);
  if (game.invitedUserName) players.push(`${game.invitedUserName} (O)`);
  $('inline-game-title').textContent = players.join(' vs ') || 'Tic-tac-toe';
  $('inline-game-code').textContent = game.status === 'waiting' ? 'Waiting for your friend…' : `Room ${game.code}`;
  $('inline-game-status').textContent = game.status === 'waiting' ? 'Invite sent in this chat.'
    : game.status === 'draw' ? 'It’s a draw!'
      : game.status === 'done' ? `${game.members.find(member => member.id === game.winner)?.name || 'A player'} wins!`
        : game.turn === state.user.id ? 'Your turn' : `${game.members.find(member => member.id === game.turn)?.name || 'Friend'}’s turn`;
  const board = $('inline-game-board');
  board.replaceChildren();
  game.board.forEach((value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `board-cell${value ? ` ${value.toLowerCase()}` : ''}`;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', value ? `Square ${index + 1}: ${value}` : `Square ${index + 1}, empty`);
    button.textContent = value || '';
    button.disabled = game.status !== 'playing' || game.turn !== state.user.id || Boolean(value);
    button.addEventListener('click', async () => {
      try { renderGame(await post(`/games/${encodeURIComponent(game.code)}/moves`, { index })); }
      catch (error) { showNotice(error.message, true); }
    });
    board.appendChild(button);
  });
  $('inline-game-reset').hidden = game.hostId !== state.user.id || game.members.length !== 2;
}

function renderMessages(container, messages, emptyText) {
  container.querySelectorAll('audio[data-loaded="true"]').forEach(audio => URL.revokeObjectURL(audio.src));
  container.replaceChildren();
  container.classList.remove('empty-state');
  if (!messages.length) {
    const welcome = document.createElement('div');
    welcome.className = 'chat-welcome';
    const avatar = document.createElement('span');
    avatar.className = 'welcome-avatar';
    avatar.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#message"></use></svg>';
    const title = document.createElement('h2');
    title.textContent = state.activeFriend ? `Say hello to ${state.activeFriend.name}` : 'Your messages';
    const description = document.createElement('p');
    description.textContent = state.activeFriend
      ? emptyText
      : 'Pick a conversation and say hello. Listen to music or play a game together right here.';
    welcome.append(avatar, title, description);
    if (!state.activeFriend) {
      const discover = document.createElement('button');
      discover.type = 'button';
      discover.className = 'button secondary';
      discover.textContent = 'Find people';
      discover.addEventListener('click', () => setPanel('people'));
      welcome.appendChild(discover);
    }
    container.appendChild(welcome);
    return;
  }
  let previousDay = '';
  let previousSender = null;
  let group = null;
  messages.forEach(message => {
    const date = new Date(message.ts);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== previousDay) {
      const divider = document.createElement('div');
      divider.className = 'message-date';
      const today = new Date();
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      divider.textContent = messageDay.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
        ? 'Today'
        : messageDay.getTime() === yesterday.getTime()
          ? 'Yesterday'
          : date.toLocaleDateString([], { month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
      container.appendChild(divider);
      previousDay = day;
      previousSender = null;
    }
    if (message.from !== previousSender) {
      group = document.createElement('div');
      group.className = `message-group${message.from === state.user.id ? ' mine' : ' theirs'}`;
      const avatar = document.createElement('span');
      avatar.className = 'message-group-avatar';
      avatar.textContent = (message.fromName || state.activeFriend?.name || '?').trim().slice(0, 1).toUpperCase();
      const body = document.createElement('div');
      body.className = 'message-group-body';
      group.append(avatar, body);
      container.appendChild(group);
      previousSender = message.from;
    }
    const item = document.createElement('div');
    item.className = 'message-item';
    const bubble = document.createElement('div');
    bubble.className = 'message';
    if (message.type === 'audio') {
      const audio = document.createElement('audio');
      audio.hidden = true;
      audio.preload = 'none';
      audio.dataset.messageId = message.id;
      audio.dataset.friendId = state.activeFriend.id;
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'voice-play';
      play.setAttribute('aria-label', 'Play voice message');
      play.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#play"></use></svg>';
      play.addEventListener('click', async () => {
        try {
          if (!audio.dataset.loaded) {
            const response = await fetch(`/api/chat/${encodeURIComponent(audio.dataset.friendId)}/${encodeURIComponent(audio.dataset.messageId)}/audio`, {
              headers: { Authorization: 'Bearer ' + token() },
            });
            if (response.status === 401) {
              localStorage.removeItem('nx_token');
              localStorage.removeItem('nx_user');
              window.top.location.href = '/login.html';
              return;
            }
            if (!response.ok) throw new Error('Could not load this voice message.');
            audio.src = URL.createObjectURL(await response.blob());
            audio.dataset.loaded = 'true';
          }
          if (audio.paused) await audio.play();
          else audio.pause();
        } catch (error) { showNotice(error.message, true); }
      });
      audio.addEventListener('play', () => {
        play.setAttribute('aria-label', 'Pause voice message');
        play.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#pause"></use></svg>';
      });
      audio.addEventListener('pause', () => {
        play.setAttribute('aria-label', 'Play voice message');
        play.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#play"></use></svg>';
      });
      const progress = document.createElement('span');
      progress.className = 'voice-progress';
      progress.textContent = 'Voice message';
      const duration = document.createElement('span');
      duration.className = 'voice-duration';
      duration.textContent = `${Math.max(1, Math.round(message.duration || 0))} sec`;
      audio.addEventListener('timeupdate', () => {
        progress.textContent = `${Math.floor(audio.currentTime)} / ${Math.max(1, Math.round(message.duration || 0))} sec`;
      });
      audio.addEventListener('ended', () => {
        play.setAttribute('aria-label', 'Play voice message');
        play.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#play"></use></svg>';
        progress.textContent = 'Voice message';
      });
      bubble.classList.add('voice-message');
      bubble.append(play, progress, duration, audio);
    } else {
      bubble.textContent = message.text || '';
    }
    item.appendChild(bubble);
    item.appendChild(renderReactions(message));
    group.querySelector('.message-group-body').appendChild(item);
    const groupBody = group.querySelector('.message-group-body');
    groupBody.querySelector('.message-time')?.remove();
    const time = document.createElement('time');
    time.className = 'message-time';
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    groupBody.appendChild(time);
  });
  container.scrollTop = container.scrollHeight;
}

const reactionNames = ['heart', 'laugh', 'thumb-up', 'surprised', 'sad'];

function renderReactions(message) {
  const wrap = document.createElement('div');
  wrap.className = 'message-reaction-wrap';
  const picker = document.createElement('div');
  picker.className = 'message-reaction-picker';
  picker.hidden = true;
  reactionNames.forEach(reaction => {
    const users = message.reactions?.[reaction] || [];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reaction-option${users.includes(state.user.id) ? ' selected' : ''}`;
    button.setAttribute('aria-label', `React with ${reaction}`);
    button.title = reaction;
    button.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#${reaction}"></use></svg>`;
    button.addEventListener('click', async () => {
      try {
        const result = await put(`/chat/${encodeURIComponent(state.activeFriend.id)}/${encodeURIComponent(message.id)}/reaction`, { reaction });
        message.reactions = result.reactions;
        renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
      } catch (error) { showNotice(error.message, true); }
    });
    picker.appendChild(button);
  });
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'reaction-toggle';
  toggle.setAttribute('aria-label', 'Add a reaction');
  toggle.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#heart"></use></svg>';
  toggle.addEventListener('click', () => { picker.hidden = !picker.hidden; });
  wrap.append(toggle, picker);

  const summary = document.createElement('div');
  summary.className = 'message-reaction-summary';
  reactionNames.forEach(reaction => {
    const users = message.reactions?.[reaction] || [];
    if (!users.length) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reaction-count${users.includes(state.user.id) ? ' selected' : ''}`;
    button.setAttribute('aria-label', `${users.length} ${reaction} reaction${users.length === 1 ? '' : 's'}`);
    button.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#${reaction}"></use></svg><span>${users.length}</span>`;
    button.addEventListener('click', async () => {
      try {
        const result = await put(`/chat/${encodeURIComponent(state.activeFriend.id)}/${encodeURIComponent(message.id)}/reaction`, { reaction });
        message.reactions = result.reactions;
        renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
      } catch (error) { showNotice(error.message, true); }
    });
    summary.appendChild(button);
  });
  if (summary.childElementCount) wrap.appendChild(summary);
  return wrap;
}

function updateCallPanel() {
  const call = state.call;
  const active = call.status !== 'idle';
  const friend = state.friends.find(item => item.id === call.friendId);
  $('call-panel').hidden = !active;
  $('call-title').textContent = call.status === 'incoming'
    ? `${friend?.name || 'Your friend'} is calling`
    : call.status === 'dialing' ? `Calling ${friend?.name || 'friend'}`
      : `${friend?.name || 'Friend'} · audio call`;
  $('call-status').textContent = ({
    incoming: 'Incoming audio call',
    dialing: 'Ringing…',
    connecting: 'Connecting…',
    active: 'Connected',
  })[call.status] || '';
  $('call-accept').hidden = call.status !== 'incoming';
  $('call-decline').hidden = call.status !== 'incoming';
  $('call-mute').hidden = call.status !== 'active';
  $('call-end').hidden = call.status === 'incoming' || call.status === 'idle';
  $('call-mute').classList.toggle('muted', call.muted);
  $('call-mute').setAttribute('aria-label', call.muted ? 'Unmute microphone' : 'Mute microphone');
  $('call-mute').innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#${call.muted ? 'mic-off' : 'mic'}"></use></svg>`;
  $('chat-call-button').disabled = !state.activeFriend || active;
}

async function sendCallSignal(type, payload = {}) {
  const { friendId, sessionId } = state.call;
  if (!friendId || !sessionId) throw new Error('No active call');
  await post(`/calls/${encodeURIComponent(friendId)}/signal`, { type, sessionId, ...payload });
}

async function createCallPeer() {
  const sessionId = state.call.sessionId;
  const config = await api('/calls/config');
  if (state.call.sessionId !== sessionId || state.call.finishing || !state.call.localStream) throw new Error('Audio call was cancelled.');
  const peer = new RTCPeerConnection({ iceServers: config.iceServers });
  state.call.peer = peer;
  state.call.localStream.getTracks().forEach(track => peer.addTrack(track, state.call.localStream));
  peer.onicecandidate = event => {
    if (!event.candidate || state.call.peer !== peer) return;
    const candidate = event.candidate.toJSON();
    if (!state.call.signalReady) {
      state.call.outgoingCandidates.push(candidate);
      return;
    }
    sendCallSignal('ice', { candidate }).catch(error => showNotice(error.message, true));
  };
  peer.ontrack = event => {
    $('remote-audio').srcObject = event.streams[0];
    $('remote-audio').play().catch(() => showNotice('Tap the audio player to hear your friend.'));
  };
  peer.onconnectionstatechange = () => {
    if (state.call.peer !== peer) return;
    if (peer.connectionState === 'connected') {
      clearTimeout(state.call.timeout);
      state.call.status = 'active';
      updateCallPanel();
    } else if (peer.connectionState === 'failed') {
      showNotice('Audio connection failed. Check your network or TURN server settings.', true);
      finishCall(false);
    }
  };
  return peer;
}

async function flushCallCandidates() {
  const candidates = state.call.outgoingCandidates.splice(0);
  for (const candidate of candidates) await sendCallSignal('ice', { candidate });
}

async function applyPendingCallCandidates() {
  const peer = state.call.peer;
  if (!peer?.remoteDescription) return;
  const candidates = state.call.pendingCandidates.splice(0);
  for (const candidate of candidates) await peer.addIceCandidate(candidate);
}

async function startAudioCall() {
  if (!state.activeFriend || state.call.status !== 'idle') return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    showNotice('Audio calling is not supported by this browser.', true);
    return;
  }
  try {
    const sessionId = crypto.randomUUID();
    state.call = {
      status: 'dialing', sessionId, friendId: state.activeFriend.id, peer: null,
      localStream: null, pendingCandidates: [], outgoingCandidates: [], signalReady: false,
      muted: false, seenSignals: state.call.seenSignals, offer: null, timeout: null,
    };
    updateCallPanel();
    state.call.timeout = setTimeout(() => {
      if (state.call.sessionId === sessionId && state.call.status === 'dialing') {
        showNotice('No answer. The audio call ended.');
        finishCall(true);
      }
    }, 60000);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (state.call.sessionId !== sessionId || state.call.finishing) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.call.localStream = stream;
    const peer = await createCallPeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendCallSignal('offer', { description: peer.localDescription.toJSON() });
    state.call.signalReady = true;
    await flushCallCandidates();
    updateCallPanel();
  } catch (error) {
    if (state.call.sessionId === sessionId && !state.call.finishing) {
      showNotice(error.message || 'Could not start the audio call.', true);
      finishCall(false);
    }
  }
}

async function acceptAudioCall() {
  if (state.call.status !== 'incoming' || !state.call.offer) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    showNotice('Audio calling is not supported by this browser.', true);
    return;
  }
  const sessionId = state.call.sessionId;
  try {
    state.call.status = 'connecting';
    updateCallPanel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (state.call.sessionId !== sessionId || state.call.finishing) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.call.localStream = stream;
    const peer = await createCallPeer();
    await peer.setRemoteDescription(state.call.offer);
    await applyPendingCallCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await sendCallSignal('answer', { description: peer.localDescription.toJSON() });
    state.call.signalReady = true;
    await flushCallCandidates();
    updateCallPanel();
  } catch (error) {
    if (state.call.sessionId === sessionId && !state.call.finishing) {
      showNotice(error.message || 'Could not join the audio call.', true);
      finishCall(true);
    }
  }
}

async function finishCall(notifyFriend) {
  const call = state.call;
  if (call.finishing) return;
  call.finishing = true;
  clearTimeout(call.timeout);
  if (notifyFriend && call.friendId && call.sessionId) {
    try { await sendCallSignal('end'); }
    catch (error) { showNotice(error.message, true); }
  }
  call.peer?.close();
  call.localStream?.getTracks().forEach(track => track.stop());
  $('remote-audio').pause();
  $('remote-audio').srcObject = null;
  state.call = {
    status: 'idle', sessionId: null, friendId: null, peer: null, localStream: null,
    pendingCandidates: [], outgoingCandidates: [], signalReady: false, muted: false,
    seenSignals: call.seenSignals, offer: null, timeout: null,
  };
  updateCallPanel();
}

async function handleCallSignal(signal) {
  if (state.call.seenSignals.has(signal.id)) return;
  const friend = state.friends.find(item => item.id === signal.from);
  if (!friend) return;
  state.call.seenSignals.add(signal.id);
  if (state.call.seenSignals.size > 500) state.call.seenSignals.delete(state.call.seenSignals.values().next().value);
  if (signal.type === 'offer') {
    if (Date.now() - signal.ts > 90000) {
      try { await post(`/calls/${encodeURIComponent(friend.id)}/signal`, { type: 'reject', sessionId: signal.sessionId }); }
      catch (error) { showNotice(error.message, true); }
      return;
    }
    if (state.call.status !== 'idle') {
      if (state.call.sessionId !== signal.sessionId) {
        try { await post(`/calls/${encodeURIComponent(friend.id)}/signal`, { type: 'reject', sessionId: signal.sessionId }); }
        catch (error) { showNotice(error.message, true); }
      }
      return;
    }
    state.call.friendId = friend.id;
    state.call.sessionId = signal.sessionId;
    state.call.status = 'incoming';
    state.call.offer = signal.description;
    await selectFriend(friend);
    updateCallPanel();
    return;
  }
  if (state.call.friendId !== signal.from || state.call.sessionId !== signal.sessionId) return;
  if (signal.type === 'answer' && state.call.peer && state.call.status === 'dialing') {
    try {
      await state.call.peer.setRemoteDescription(signal.description);
      await applyPendingCallCandidates();
      state.call.status = 'connecting';
      updateCallPanel();
    } catch (error) { showNotice(error.message, true); finishCall(false); }
  } else if (signal.type === 'ice' && signal.candidate) {
    try {
      if (state.call.peer?.remoteDescription) await state.call.peer.addIceCandidate(signal.candidate);
      else state.call.pendingCandidates.push(signal.candidate);
    } catch (error) { showNotice(error.message, true); }
  } else if (signal.type === 'reject' || signal.type === 'end') {
    await finishCall(false);
    showNotice(signal.type === 'reject' ? `${friend.name} declined the audio call.` : 'Audio call ended.');
  }
}

async function pollCallSignals() {
  const signals = await api('/calls/signals');
  state.callSignalError = '';
  for (const signal of signals) await handleCallSignal(signal);
}

async function toggleVoiceRecording() {
  if (state.voiceRecorder?.state === 'recording') {
    state.voiceRecorder.stop();
    return;
  }
  if (!state.activeFriend || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showNotice('Voice messages are not supported by this browser.', true);
    return;
  }
  const friendId = state.activeFriend.id;
  try {
    state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(type => MediaRecorder.isTypeSupported(type));
    state.voiceRecorder = mimeType ? new MediaRecorder(state.voiceStream, { mimeType }) : new MediaRecorder(state.voiceStream);
    state.voiceChunks = [];
    state.voiceStartedAt = Date.now();
    state.voiceRecorder.ondataavailable = event => { if (event.data.size) state.voiceChunks.push(event.data); };
    state.voiceRecorder.onerror = event => showNotice(event.error?.message || 'Voice recording failed.', true);
    state.voiceRecorder.onstop = async () => {
      const recorder = state.voiceRecorder;
      const chunks = state.voiceChunks;
      const duration = Math.min(60, (Date.now() - state.voiceStartedAt) / 1000);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      state.voiceStream?.getTracks().forEach(track => track.stop());
      state.voiceStream = null;
      state.voiceRecorder = null;
      clearTimeout(state.voiceTimeout);
      $('record-voice').classList.remove('recording');
      $('record-voice').setAttribute('aria-label', 'Record voice message');
      if (!blob.size) return;
      try {
        const reader = new FileReader();
        const encoded = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('Could not read the recorded voice message.'));
          reader.readAsDataURL(blob);
        });
        const message = await post(`/chat/${encodeURIComponent(friendId)}`, {
          type: 'audio',
          audioData: encoded,
          mimeType: blob.type.split(';')[0],
          duration,
        });
        if (state.activeFriend?.id === friendId) {
          state.chatMessages.push(message);
          state.chatAfter = Math.max(state.chatAfter, message.ts);
          renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
        }
        state.lastMessages[friendId] = { ...message, text: 'Voice message' };
        renderFriends();
      } catch (error) { showNotice(error.message, true); }
    };
    state.voiceRecorder.start();
    $('record-voice').classList.add('recording');
    $('record-voice').setAttribute('aria-label', 'Stop recording');
    state.voiceTimeout = setTimeout(() => {
      if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
    }, 60000);
  } catch (error) { showNotice(error.message || 'Microphone access was denied.', true); }
}

async function selectFriend(friend) {
  state.activeFriend = friend;
  state.chatMessages = [];
  state.chatAfter = 0;
  $('chat-title').textContent = friend.name;
  $('chat-subtitle').textContent = 'Your Nymix friend';
  $('chat-avatar').textContent = friend.name.trim().slice(0, 1).toUpperCase();
  $('inbox-layout').classList.add('conversation-open');
  $('chat-input').disabled = false;
  $('chat-send').disabled = false;
  $('record-voice').disabled = false;
  $('chat-game-button').disabled = false;
  $('chat-listen-button').disabled = false;
  $('chat-call-button').disabled = state.call.status !== 'idle';
  $('inline-game').hidden = state.activeGameFriendId !== friend.id;
  $('chat-listen-activity').querySelector('.listen-card').hidden = state.activeRoomFriendId !== friend.id;
  setPanel('chat');
  await refreshChat(true);
  renderFriends();
  renderChatInvites();
}

async function refreshChat(initial = false) {
  if (!state.activeFriend) return;
  const after = initial ? 0 : Math.max(0, state.chatAfter - 1);
  const messages = await api(`/chat/${encodeURIComponent(state.activeFriend.id)}?after=${after}`);
  const seen = new Set(state.chatMessages.map(message => message.id));
  const newMessages = messages.filter(message => !seen.has(message.id));
  state.chatMessages.push(...newMessages);
  state.chatMessages.sort((a, b) => a.ts - b.ts);
  state.chatAfter = Math.max(state.chatAfter, ...state.chatMessages.map(message => message.ts), 0);
  if (initial || newMessages.length) {
    renderMessages($('chat-messages'), state.chatMessages, `This is the beginning of your conversation with ${state.activeFriend.name}.`);
    const latest = state.chatMessages[state.chatMessages.length - 1];
    if (latest) state.lastMessages[state.activeFriend.id] = latest;
    renderFriends();
  }
}

async function refreshOverview() {
  const data = await api('/social/overview');
  state.friends = data.friends;
  state.lastMessages = data.lastMessages || {};
  state.requests = data.requests;
  state.gameInvites = data.gameInvites || [];
  state.roomInvites = data.roomInvites || [];
  state.rooms = data.rooms;
  state.games = data.games;
  renderFriends();
  renderRequests();
  renderGameInvites();
  renderChatInvites();
  renderRooms();
  renderGames();
}

async function refreshSuggestions() {
  state.suggestions = await api('/users/suggestions');
  renderSuggestions();
}

async function searchUsers(query) {
  const sequence = ++state.searchSequence;
  if (query.length < 2) {
    $('search-card').hidden = true;
    $('suggestions-card').hidden = false;
    $('search-results').replaceChildren();
    return;
  }
  try {
    const users = await api(`/users/search?q=${encodeURIComponent(query)}`);
    if (sequence === state.searchSequence && $('user-search').value.trim() === query) renderSearchResults(users);
  } catch (error) {
    if (sequence === state.searchSequence) showNotice(error.message, true);
  }
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
        if (!state.activeFriend) return showNotice('Choose a friend before starting a listening room.', true);
        await createListenRoom(song, state.activeFriend.id);
      }
    });
    return button;
  });
}

async function createListenRoom(song, inviteeId = state.activeFriend?.id) {
  try {
    if (!inviteeId) return showNotice('Choose a friend to invite to listen.', true);
    const room = await post('/listen-rooms', { song, inviteeId });
    state.activeRoom = room.code;
    state.activeRoomFriendId = inviteeId;
    $('chat-song-picker').hidden = true;
    setPanel('chat');
    await refreshOverview();
    await refreshListenRoom();
    showNotice(`Listening invite sent to ${state.activeFriend.name}.`);
  } catch (error) { showNotice(error.message, true); }
}

async function joinListenRoom(code, hostId = state.activeFriend?.id) {
  try {
    const room = await post(`/listen-rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`);
    state.activeRoom = room.code;
    state.activeRoomFriendId = hostId;
    setPanel('chat');
    await refreshOverview();
    await refreshListenRoom();
    showNotice('You joined the listening room in this chat.');
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
    $('chat-listen-activity').querySelector('.listen-card').hidden =
      !state.activeFriend || state.activeRoomFriendId !== state.activeFriend.id;
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
      state.activeRoomFriendId = null;
      state.lastRoom = null;
      $('chat-listen-activity').querySelector('.listen-card').hidden = true;
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
  const players = game.members.map(member => `${member.name} (${member.symbol})`);
  if (game.invitedUserName) players.push(`${game.invitedUserName} (O)`);
  $('game-title').textContent = players.join(' vs ') || 'Tic-tac-toe';
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
  renderInlineGame(game);
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
      $('inline-game').hidden = true;
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

$('discover-from-inbox').addEventListener('click', () => setPanel('people'));
$('discover-from-empty').addEventListener('click', () => setPanel('people'));

$('back-to-inbox').addEventListener('click', () => $('inbox-layout').classList.remove('conversation-open'));

$('thread-search').addEventListener('input', renderFriends);

$('chat-game-button').addEventListener('click', () => {
  if (state.activeFriend) challengeFriend(state.activeFriend);
});

$('chat-call-button').addEventListener('click', startAudioCall);
$('call-accept').addEventListener('click', acceptAudioCall);
$('call-decline').addEventListener('click', async () => {
  try { await sendCallSignal('reject'); }
  catch (error) { showNotice(error.message, true); }
  await finishCall(false);
});
$('call-end').addEventListener('click', () => finishCall(true));
$('call-mute').addEventListener('click', () => {
  state.call.muted = !state.call.muted;
  state.call.localStream?.getAudioTracks().forEach(track => { track.enabled = !state.call.muted; });
  updateCallPanel();
});
$('record-voice').addEventListener('click', toggleVoiceRecording);

$('chat-listen-button').addEventListener('click', () => {
  if (!state.activeFriend) return;
  $('chat-song-picker').hidden = false;
  $('song-search').focus();
});

$('chat-song-close').addEventListener('click', () => {
  $('chat-song-picker').hidden = true;
});

$('inline-game-close').addEventListener('click', () => {
  state.activeGame = null;
  state.activeGameFriendId = null;
  $('inline-game').hidden = true;
});

$('inline-game-reset').addEventListener('click', async () => {
  if (!state.activeGame) return;
  try { renderGame(await post(`/games/${encodeURIComponent(state.activeGame)}/reset`)); }
  catch (error) { showNotice(error.message, true); }
});

$('sign-out').addEventListener('click', () => {
  localStorage.removeItem('nx_token');
  localStorage.removeItem('nx_user');
  window.location.href = '/login.html';
});

$('user-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('user-search').value.trim();
  if (query.length < 2) return showNotice('Type at least 2 characters to search.', true);
  clearTimeout(state.searchTimer);
  await searchUsers(query);
});

$('user-search').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  const query = $('user-search').value.trim();
  state.searchTimer = setTimeout(() => searchUsers(query), 260);
});

$('clear-search').addEventListener('click', () => {
  $('user-search').value = '';
  $('search-card').hidden = true;
  $('suggestions-card').hidden = false;
  $('search-results').replaceChildren();
  $('user-search').focus();
});

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  if (!state.activeFriend || !text) return;
  try {
    const message = await post(`/chat/${encodeURIComponent(state.activeFriend.id)}`, { text });
    state.chatMessages.push(message);
    state.chatAfter = Math.max(state.chatAfter, message.ts);
    state.lastMessages[state.activeFriend.id] = message;
    $('chat-input').value = '';
    $('chat-input').style.height = '';
    renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
    renderFriends();
  } catch (error) { showNotice(error.message, true); }
});

$('chat-input').addEventListener('input', event => {
  const input = event.currentTarget;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

$('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('chat-form').requestSubmit();
  }
});

$('song-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeFriend) return showNotice('Choose a friend to listen together.', true);
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
    state.activeRoomFriendId = null;
    state.lastRoom = null;
    state.playbackSignature = '';
    if (state.playerReady) state.player.stopVideo();
    $('chat-listen-activity').querySelector('.listen-card').hidden = true;
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

const chatListenCard = document.querySelector('#panel-listen .listen-card');
if (chatListenCard) {
  $('chat-listen-activity').appendChild(chatListenCard);
  chatListenCard.hidden = true;
}

const initialPanel = new URLSearchParams(window.location.search).get('panel');
if (initialPanel === 'people' || initialPanel === 'chat') setPanel(initialPanel);
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'nymix-social-panel' && ['people', 'chat'].includes(event.data.panel)) {
    setPanel(event.data.panel);
  }
});
window.addEventListener('beforeunload', () => {
  state.call.peer?.close();
  state.call.localStream?.getTracks().forEach(track => track.stop());
  state.voiceStream?.getTracks().forEach(track => track.stop());
});
updateCallPanel();

if (!token() || !state.user || state.user.role !== 'user') {
  if (window.parent !== window) window.top.location.href = '/login.html';
  else window.location.href = '/login.html';
} else {
  $('account-name').textContent = state.user.name || state.user.email || 'Member';
  $('account-avatar').textContent = (state.user.name || state.user.email || '?').trim().slice(0, 1).toUpperCase();
  refreshSocial();
  refreshSuggestions().catch(error => showNotice(error.message, true));
  pollCallSignals().catch(error => showNotice(error.message, true));
  setInterval(refreshSocial, 4500);
  setInterval(() => {
    pollCallSignals().catch(error => {
      if (state.callSignalError !== error.message) showNotice(error.message, true);
      state.callSignalError = error.message;
    });
  }, 2000);
}
