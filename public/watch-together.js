(() => {
  const $ = selector => document.querySelector(selector);
  const token = () => localStorage.getItem('nx_token');
  const selectedFriends = new Set();
  let requestTimer;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token()}`,
      },
    });
    const result = await response.json();
    if (response.status === 401) {
      localStorage.removeItem('nx_token');
      localStorage.removeItem('nx_user');
      window.location.replace('/login.html?next=movies');
      throw new Error('Please sign in again.');
    }
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }

  function showMessage(message, error = false) {
    const element = $('#page-message');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
  }

  function updateSelectionSummary() {
    $('#selection-count').textContent = selectedFriends.size
      ? `${selectedFriends.size} friend${selectedFriends.size === 1 ? '' : 's'} selected`
      : 'Select friends to start a room.';
    $('#create-room').disabled = selectedFriends.size === 0;
  }

  function renderFriends(friends) {
    const list = $('#friends-list');
    const availableIds = new Set(friends.map(friend => friend.id));
    for (const id of selectedFriends) {
      if (!availableIds.has(id)) selectedFriends.delete(id);
    }
    if (!friends.length) {
      list.innerHTML = '<p class="muted">No friends yet. Accept a request here or <a href="/social.html">find friends in Messages</a>.</p>';
      updateSelectionSummary();
      return;
    }
    list.innerHTML = friends.map(friend => `<label class="friend-option">
      <input type="checkbox" value="${escapeHtml(friend.id)}" aria-label="Invite ${escapeHtml(friend.name)}"${selectedFriends.has(friend.id) ? ' checked' : ''} />
      <span class="friend-avatar" aria-hidden="true">${escapeHtml((friend.name || '?').slice(0, 1).toUpperCase())}</span>
      <span><strong>${escapeHtml(friend.name)}</strong><small>Friend</small></span>
    </label>`).join('');
    updateSelectionSummary();
  }

  function renderFriendRequests(requests) {
    const panel = $('#requests-panel');
    const list = $('#friend-requests');
    panel.hidden = requests.length === 0;
    if (!requests.length) {
      list.replaceChildren();
      return;
    }
    list.innerHTML = requests.map(request => `<article class="request-item">
      <div class="request-info"><strong>${escapeHtml(request.name)}</strong><small>${request.direction === 'incoming' ? 'Wants to connect with you' : 'Friend request sent · waiting for a response'}</small></div>
      ${request.direction === 'incoming' ? `<div class="request-actions">
        <button class="button button-accept" type="button" data-request-action="accepted" data-request-id="${escapeHtml(request.id)}">Accept</button>
        <button class="button button-decline" type="button" data-request-action="rejected" data-request-id="${escapeHtml(request.id)}">Decline</button>
      </div>` : ''}
    </article>`).join('');
  }

  async function loadFriendsAndRequests() {
    const [friends, requests] = await Promise.all([
      api('/api/friends'),
      api('/api/friends/requests'),
    ]);
    renderFriends(friends);
    renderFriendRequests(requests);
  }

  function renderRooms(rooms) {
    const list = $('#room-list');
    if (!rooms.length) {
      list.innerHTML = '<p class="muted">No invitations yet. Start a room and invite your friends.</p>';
      return;
    }
    list.innerHTML = rooms.map(room => `<article class="room-item">
      <div class="room-info"><strong>${room.invited ? `${escapeHtml(room.hostName)} invited you` : `Room hosted by ${escapeHtml(room.hostName)}`}</strong><small class="room-code">ROOM ${escapeHtml(room.code)}</small></div>
      <button class="button button-primary" type="button" data-join="${escapeHtml(room.code)}">${room.invited ? 'Join invite' : 'Open room'}</button>
    </article>`).join('');
  }

  async function loadRooms() {
    const rooms = await api('/api/watch-rooms');
    renderRooms(rooms);
  }

  async function initialize() {
    if (!token()) {
      window.location.replace('/login.html?next=movies');
      return;
    }
    try {
      const account = await api('/api/auth/me');
      if (account.role !== 'user') {
        $('#account-name').textContent = account.name || 'Admin';
      } else {
        $('#account-name').textContent = account.name || 'Friend';
      }
      await Promise.all([loadFriendsAndRequests(), loadRooms()]);
      requestTimer = setInterval(() => {
        loadFriendsAndRequests().catch(error => {
          console.error('Could not refresh friend requests.', error);
          showRequestMessage(error.message || 'Could not refresh friend requests.', true);
        });
      }, 15000);
    } catch (error) {
      console.error('Could not load watch-together dashboard.', error);
      showMessage(error.message || 'Could not load your rooms and friends.', true);
    }
  }

  $('#friends-list').addEventListener('change', event => {
    const checkbox = event.target.closest('input[type=checkbox]');
    if (!checkbox) return;
    if (checkbox.checked) selectedFriends.add(checkbox.value);
    else selectedFriends.delete(checkbox.value);
    updateSelectionSummary();
  });

  $('#create-room').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const room = await api('/api/watch-rooms', {
        method: 'POST',
        body: JSON.stringify({ friendIds: [...selectedFriends] }),
      });
      window.location.assign(`/watch-room.html?code=${encodeURIComponent(room.code)}`);
    } catch (error) {
      console.error('Could not create private watch room.', error);
      showMessage(error.message || 'Could not create a room.', true);
      button.disabled = false;
    }
  });

  $('#room-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-join]');
    if (!button) return;
    button.disabled = true;
    try {
      const code = button.dataset.join;
      await api(`/api/watch-rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: '{}' });
      window.location.assign(`/watch-room.html?code=${encodeURIComponent(code)}`);
    } catch (error) {
      console.error('Could not join private watch room.', error);
      showMessage(error.message || 'Could not join room.', true);
      button.disabled = false;
    }
  });

  function showRequestMessage(message, error = false) {
    const element = $('#request-message');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
  }

  $('#friend-requests').addEventListener('click', async event => {
    const button = event.target.closest('[data-request-action]');
    if (!button) return;
    button.disabled = true;
    try {
      const status = button.dataset.requestAction;
      await api(`/api/friends/${encodeURIComponent(button.dataset.requestId)}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadFriendsAndRequests();
      if (status === 'accepted') await loadRooms();
    } catch (error) {
      console.error('Could not update friend request.', error);
      showRequestMessage(error.message || 'Could not update friend request.', true);
      button.disabled = false;
    }
  });

  $('#refresh-friends').addEventListener('click', async () => {
    try {
      await loadFriendsAndRequests();
      $('#request-message').hidden = true;
    } catch (error) {
      console.error('Could not refresh friends and requests.', error);
      showRequestMessage(error.message || 'Could not refresh friends and requests.', true);
    }
  });

  $('#refresh-rooms').addEventListener('click', async () => {
    try { await loadRooms(); }
    catch (error) {
      console.error('Could not refresh watch rooms.', error);
      showMessage(error.message || 'Could not refresh rooms.', true);
    }
  });
  $('#sign-out').addEventListener('click', () => {
    clearInterval(requestTimer);
    localStorage.removeItem('nx_token');
    localStorage.removeItem('nx_user');
    window.location.replace('/login.html');
  });

  initialize();
})();
