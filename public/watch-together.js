(() => {
  const $ = selector => document.querySelector(selector);
  const token = () => localStorage.getItem('nx_token');
  const selectedFriends = new Set();
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

  function renderFriends(friends) {
    const list = $('#friends-list');
    if (!friends.length) {
      list.innerHTML = '<p class="muted">No friends yet. Add friends from Messages before creating a private room.</p>';
      return;
    }
    list.innerHTML = friends.map(friend => `<label class="friend-option">
      <input type="checkbox" value="${escapeHtml(friend.id)}" aria-label="Invite ${escapeHtml(friend.name)}" />
      <span class="friend-avatar" aria-hidden="true">${escapeHtml((friend.name || '?').slice(0, 1).toUpperCase())}</span>
      <span><strong>${escapeHtml(friend.name)}</strong><small>Friend</small></span>
    </label>`).join('');
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
      const [account, friends] = await Promise.all([api('/api/auth/me'), api('/api/friends')]);
      if (account.role !== 'user') {
        $('#account-name').textContent = account.name || 'Admin';
      } else {
        $('#account-name').textContent = account.name || 'Friend';
      }
      renderFriends(friends);
      await loadRooms();
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
    $('#selection-count').textContent = selectedFriends.size
      ? `${selectedFriends.size} friend${selectedFriends.size === 1 ? '' : 's'} selected`
      : 'Select friends to start a room.';
    $('#create-room').disabled = selectedFriends.size === 0;
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

  $('#refresh-rooms').addEventListener('click', async () => {
    try { await loadRooms(); }
    catch (error) {
      console.error('Could not refresh watch rooms.', error);
      showMessage(error.message || 'Could not refresh rooms.', true);
    }
  });
  $('#sign-out').addEventListener('click', () => {
    localStorage.removeItem('nx_token');
    localStorage.removeItem('nx_user');
    window.location.replace('/login.html');
  });

  initialize();
})();
