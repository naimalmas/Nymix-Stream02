const API = '/api';
const PROFILE_PHOTO_LIMIT = 100;
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
  chatPlayback: null,
  chatPlaybackSignature: '',
  chatPlayer: null,
  chatPlayerReady: false,
  chatPlayerSongId: null,
  chatPlaybackSyncing: false,
  chatMessages: [],
  chatAfter: 0,
  call: {
    status: 'idle',
    kind: 'audio',
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
  profileTarget: null,
  profilePhoto: '',
  feedPreviewUrl: '',
  feedLoading: false,
  reelsLoading: false,
  reelsNextPageToken: null,
  reelsLoaded: false,
  reelsLazyObserver: null,
  reelsPageObserver: null,
  reelsVisibilityObserver: null,
  reelPlayers: new Map(),
  reelsVisibleRatios: new Map(),
  activeReelPlayer: null,
  reelsObservedEnd: null,
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
  homeFeed: new URLSearchParams(window.location.search).get('home') === '1',
  homeFeedResizeObserver: null,
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

function setAvatar(element, profile) {
  const label = (profile?.name || '?').trim().slice(0, 1).toUpperCase();
  element.replaceChildren();
  element.textContent = label || '?';
  const avatar = profile?.avatar;
  if (typeof avatar !== 'string' || avatar.length > 180000 ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) return;
  const image = document.createElement('img');
  image.className = 'avatar-image';
  image.alt = '';
  image.src = avatar;
  image.addEventListener('error', () => { image.remove(); }, { once: true });
  element.appendChild(image);
}

async function openProfile(profileOrId, syncParent = true) {
  try {
    const id = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id;
    if (!id) throw new Error('Profile not found');
    const profile = await api(`/users/${encodeURIComponent(id)}/profile`);
    const isOwnProfile = profile.id === state.user.id;
    state.profileTarget = profile;
    state.profilePhoto = profile.avatar || '';
    $('profile-title').textContent = isOwnProfile ? 'Your profile' : `${profile.name}'s profile`;
    $('profile-display-name').textContent = profile.name;
    $('profile-name').value = profile.name;
    $('profile-bio').value = profile.bio || '';
    $('profile-name').readOnly = !isOwnProfile;
    $('profile-bio').readOnly = !isOwnProfile;
    $('profile-photo-input').disabled = !isOwnProfile;
    $('profile-photo-label').hidden = !isOwnProfile;
    $('profile-remove-photo').hidden = !isOwnProfile || !profile.avatar;
    $('profile-save').hidden = !isOwnProfile;
    $('profile-notice').textContent = '';
    setAvatar($('profile-dialog-avatar'), profile);
    const joined = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '';
    const plays = Number(profile.totalPlays) || 0;
    $('profile-meta').textContent = isOwnProfile ? '' : [joined && `Member since ${joined}`, `${plays} ${plays === 1 ? 'play' : 'plays'}`].filter(Boolean).join(' · ');
    $('profile-dashboard').hidden = !isOwnProfile;
    $('profile-gallery-add-label').hidden = !isOwnProfile;
    $('profile-gallery-hint').hidden = !isOwnProfile;
    $('profile-gallery-input').disabled = !isOwnProfile;
    renderProfilePhotos(profile);
    const action = $('profile-action');
    configureProfileAction(action, profile, isOwnProfile);
    configureProfileAction($('profile-page-action'), profile, isOwnProfile);
    renderProfilePage(profile);
    setPanel('profile', syncParent);
    if (isOwnProfile) loadProfileDashboard(profile);
  } catch (error) {
    showNotice(error.message, true);
  }
}

function configureProfileAction(action, profile, isOwnProfile) {
  action.hidden = isOwnProfile || profile.relation === 'sent';
  action.disabled = false;
  if (!isOwnProfile && profile.relation === 'received') action.textContent = 'View request';
  else if (!isOwnProfile && profile.relation === 'friends') action.textContent = 'Message';
  else if (!isOwnProfile && profile.relation === 'none') action.textContent = 'Add friend';
}

function renderProfilePage(profile) {
  const photos = Array.isArray(profile.photos) ? profile.photos : [];
  setAvatar($('profile-page-avatar'), profile);
  $('profile-page-name').textContent = profile.name || 'Nymix member';
  $('profile-page-photo-count').textContent = String(photos.length);
  $('profile-page-play-count').textContent = (Number(profile.totalPlays) || 0).toLocaleString();
  $('profile-page-member-since').textContent = profile.createdAt
    ? `Joined ${new Date(profile.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}`
    : '';
  $('profile-page-bio').textContent = profile.bio || '';
  $('profile-page-edit').hidden = profile.id !== state.user.id;
  $('profile-page-add-label').hidden = profile.id !== state.user.id;
  $('profile-page-photo-input').disabled = profile.id !== state.user.id;
  $('profile-page-notice').textContent = '';
  $('profile-page-grid').replaceChildren();
  $('profile-page-empty').hidden = photos.length > 0;
  $('profile-page-empty').textContent = profile.id === state.user.id
    ? 'No photos yet. Add your first photo to share it on your profile and feed.'
    : 'No photos shared yet.';
  photos.forEach(photo => {
    const tile = document.createElement('article');
    tile.className = 'profile-page-tile';
    const image = document.createElement('img');
    image.src = photo.image;
    image.alt = photo.caption || `${profile.name}'s photo`;
    image.loading = 'lazy';
    tile.appendChild(image);
    if (photo.caption) {
      const caption = document.createElement('p');
      caption.textContent = photo.caption;
      tile.appendChild(caption);
    }
    if (profile.id === state.user.id) {
      const remove = makeButton('Delete photo', () => removeProfilePhoto(photo.id), 'secondary');
      remove.classList.add('profile-page-photo-delete');
      tile.appendChild(remove);
    }
    $('profile-page-grid').appendChild(tile);
  });
}

function renderProfilePhotos(profile) {
  const photos = Array.isArray(profile.photos) ? profile.photos : [];
  const grid = $('profile-photo-grid');
  grid.replaceChildren();
  $('profile-photo-count').textContent = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`;
  $('profile-gallery-empty').hidden = photos.length > 0;
  $('profile-gallery-empty').textContent = profile.id === state.user.id
    ? 'Your profile photos will appear here.'
    : 'No photos shared yet.';
  photos.forEach((photo, index) => {
    const tile = document.createElement('article');
    tile.className = 'profile-photo-tile';
    const image = document.createElement('img');
    image.src = photo.image;
    image.alt = photo.caption || `${profile.name}'s photo ${index + 1}`;
    image.loading = 'lazy';
    tile.appendChild(image);
    if (photo.caption) {
      const caption = document.createElement('p');
      caption.className = 'profile-photo-caption';
      caption.textContent = photo.caption;
      tile.appendChild(caption);
    }
    if (profile.id === state.user.id) {
      const controls = document.createElement('div');
      controls.className = 'profile-photo-controls-grid';
      const move = (offset, label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'profile-photo-control';
        button.textContent = offset < 0 ? '←' : '→';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.disabled = index + offset < 0 || index + offset >= photos.length;
        button.addEventListener('click', () => moveProfilePhoto(photo.id, offset));
        return button;
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-photo-control remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove photo from profile');
      remove.title = 'Remove photo';
      remove.addEventListener('click', () => removeProfilePhoto(photo.id));
      controls.append(move(-1, 'Move photo left'), move(1, 'Move photo right'), remove);
      tile.appendChild(controls);
    }
    grid.appendChild(tile);
  });
}

async function uploadProfilePhotos(input, addLabel, notice) {
  const files = [...(input.files || [])];
  if (!files.length || state.profileTarget?.id !== state.user.id) return;
  const profile = state.profileTarget;
  const remaining = PROFILE_PHOTO_LIMIT - (profile.photos || []).length;
  if (remaining <= 0) {
    notice.textContent = 'Your profile photo grid is full. Remove a photo before adding another.';
    notice.classList.add('error');
    input.value = '';
    return;
  }
  input.disabled = true;
  addLabel.classList.add('disabled');
  const failures = [];
  try {
    for (const file of files.slice(0, remaining)) {
      try {
        const image = await compressProfilePhoto(file, 64 * 1024);
        const photo = await post('/user/photos', { image });
        profile.photos ||= [];
        profile.photos.push(photo);
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    if (state.profileTarget?.id === profile.id) {
      renderProfilePhotos(profile);
      renderProfilePage(profile);
    }
    if (files.length > remaining) failures.push(`Only ${remaining} more photos fit in your profile grid.`);
    notice.textContent = failures.length ? failures.join(' ') : 'Photo shared to your profile and feed.';
    notice.classList.toggle('error', failures.length > 0);
  } finally {
    input.value = '';
    input.disabled = false;
    addLabel.classList.remove('disabled');
  }
}

async function moveProfilePhoto(photoId, offset) {
  const photos = state.profileTarget?.photos || [];
  const index = photos.findIndex(photo => photo.id === photoId);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= photos.length) return;
  const reordered = [...photos];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  try {
    const result = await put('/user/photos/order', { photoIds: reordered.map(photo => photo.id) });
    state.profileTarget.photos = result.photos;
    renderProfilePhotos(state.profileTarget);
    renderProfilePage(state.profileTarget);
  } catch (error) {
    $('profile-notice').textContent = error.message;
    $('profile-notice').classList.add('error');
  }
}

async function removeProfilePhoto(photoId) {
  if (!window.confirm('Delete this photo from your profile and feed?')) return;
  try {
    await deleteRequest(`/user/photos/${encodeURIComponent(photoId)}`);
    if (state.profileTarget?.id === state.user.id) {
      state.profileTarget.photos = (state.profileTarget.photos || []).filter(photo => photo.id !== photoId);
      renderProfilePhotos(state.profileTarget);
      renderProfilePage(state.profileTarget);
    }
    await loadFeed();
    showNotice('Photo deleted from your profile and feed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderDashboardSongs(container, songs, emptyText, { liked = false } = {}) {
  container.replaceChildren();
  if (!songs.length) {
    const empty = document.createElement('p');
    empty.className = 'profile-song-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  songs.forEach(song => {
    const row = document.createElement('div');
    row.className = 'profile-song-row';
    const songId = song.id || song.songId || song.videoId || song.video_id || '';
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    if (/^[\w-]{11}$/.test(songId)) image.src = `https://img.youtube.com/vi/${encodeURIComponent(songId)}/default.jpg`;
    else image.hidden = true;
    const copy = document.createElement('span');
    copy.className = 'profile-song-copy';
    const title = document.createElement('strong');
    title.textContent = song.title || song.songTitle || 'Unknown song';
    const detail = document.createElement('small');
    detail.textContent = song.artist || song.songArtist || 'YouTube';
    copy.append(title, detail);
    row.append(image, copy);
    if (liked && songId) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-song-remove';
      remove.setAttribute('aria-label', `Remove ${title.textContent} from liked songs`);
      remove.textContent = '×';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await post(`/user/liked/${encodeURIComponent(songId)}`, song);
          await loadProfileDashboard(state.profileTarget);
        } catch (error) {
          $('profile-notice').textContent = error.message;
          $('profile-notice').classList.add('error');
          remove.disabled = false;
        }
      });
      row.appendChild(remove);
    } else if (!liked) {
      const playedAt = song.timestamp || song.playedAt || song.played_at || song.createdAt;
      if (playedAt) {
        const time = document.createElement('small');
        time.className = 'profile-song-time';
        time.textContent = formatThreadTime(new Date(playedAt).getTime());
        row.appendChild(time);
      }
    }
    container.appendChild(row);
  });
}

async function loadProfileDashboard(profile) {
  $('profile-liked-list').textContent = 'Loading…';
  $('profile-history-list').textContent = 'Loading…';
  try {
    const [liked, history] = await Promise.all([api('/user/liked'), api('/user/history')]);
    if (!Array.isArray(liked) || !Array.isArray(history)) throw new Error('Invalid dashboard response');
    $('profile-liked-count').textContent = liked.length.toLocaleString();
    $('profile-play-count').textContent = (Number(profile.totalPlays) || 0).toLocaleString();
    $('profile-member-since').textContent = profile.createdAt
      ? new Date(profile.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })
      : '—';
    renderDashboardSongs($('profile-liked-list'), liked, 'No liked songs yet.', { liked: true });
    renderDashboardSongs($('profile-history-list'), history.slice(0, 20), 'No play history yet.');
  } catch (error) {
    $('profile-liked-list').textContent = 'Could not load liked songs.';
    $('profile-history-list').textContent = 'Could not load play history.';
    $('profile-notice').textContent = error.message;
    $('profile-notice').classList.add('error');
  }
}

async function compressProfilePhoto(file, maxBytes = 128 * 1024) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG, WebP or GIF image under 10 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('Choose an image smaller than 40 megapixels.');
    const canvas = document.createElement('canvas');
    const size = Math.min(384, bitmap.width, bitmap.height);
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not process this image.');
    const crop = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size);
    for (const quality of [0.8, 0.68, 0.55, 0.42, 0.3]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the processed photo.'));
          reader.readAsDataURL(blob);
        });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`This image is too large after compression (maximum ${Math.floor(maxBytes / 1024)} KB).`);
}

function makePerson(profile, actions = []) {
  const row = document.createElement('div');
  row.className = 'person';
  const info = document.createElement('div');
  info.className = 'person-info';
  const avatar = document.createElement('span');
  avatar.className = 'person-avatar';
  setAvatar(avatar, profile);
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

function syncEmbeddedHomeHeight() {
  document.documentElement.classList.toggle('embedded-home', state.homeFeed);
  if (!state.homeFeed || window.parent === window) return;
  requestAnimationFrame(() => {
    const height = document.querySelector('.messages-main')?.scrollHeight || document.documentElement.scrollHeight;
    window.parent.postMessage({ type: 'nymix-social-feed-resize', height: height + 12 }, window.location.origin);
  });
}

function setPanel(panelName, syncParent = true) {
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${panelName}`));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === panelName));
  document.body.classList.toggle('reels-active', panelName === 'reels');
  if (panelName !== 'reels') pauseActiveReel();
  syncEmbeddedHomeHeight();
  if (syncParent && ['chat', 'people', 'feed', 'profile'].includes(panelName) && window.parent !== window) {
    window.parent.postMessage({ type: 'nymix-social-navigation', panel: panelName, homeFeed: state.homeFeed }, window.location.origin);
  }
  if (panelName === 'feed') loadFeed().catch(error => showNotice(error.message, true));
  if (panelName === 'reels') loadReels().catch(error => showNotice(error.message, true));
}

function renderFeed(posts) {
  const list = $('feed-list');
  list.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'feed-empty';
    empty.textContent = 'No photos yet. Share the first moment with your community.';
    list.appendChild(empty);
    return;
  }
  posts.forEach(post => {
    const card = document.createElement('article');
    card.className = 'card feed-post';
    card.dataset.postId = post.id;
    const header = document.createElement('header');
    header.className = 'feed-post-header';
    const author = document.createElement('button');
    author.type = 'button';
    author.className = 'feed-post-author';
    const avatar = document.createElement('span');
    avatar.className = 'feed-post-avatar';
    setAvatar(avatar, post.author);
    const name = document.createElement('strong');
    name.textContent = post.author.name || 'Nymix member';
    author.append(avatar, name);
    author.addEventListener('click', () => openProfile(post.author.id));
    header.appendChild(author);
    const timestamp = Date.parse(post.createdAt);
    if (Number.isFinite(timestamp)) {
      const time = document.createElement('time');
      time.dateTime = new Date(timestamp).toISOString();
      time.textContent = formatThreadTime(timestamp);
      header.appendChild(time);
    }
    const image = document.createElement('img');
    image.className = 'feed-post-image';
    image.src = post.image;
    image.alt = post.caption || `Photo shared by ${post.author.name || 'a Nymix member'}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove(), { once: true });
    const actions = document.createElement('div');
    actions.className = 'feed-post-actions';
    const like = document.createElement('button');
    like.type = 'button';
    like.className = `feed-like${post.liked ? ' liked' : ''}`;
    like.setAttribute('aria-pressed', String(Boolean(post.liked)));
    like.setAttribute('aria-label', post.liked ? 'Unlike photo' : 'Like photo');
    like.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#heart"></use></svg>';
    like.addEventListener('click', async () => {
      like.disabled = true;
      try {
        const result = await api(`/user/photos/${encodeURIComponent(post.id)}/like`, { method: 'POST' });
        post.liked = result.liked;
        post.likes = result.likes;
        like.classList.toggle('liked', result.liked);
        like.setAttribute('aria-pressed', String(result.liked));
        like.setAttribute('aria-label', result.liked ? 'Unlike photo' : 'Like photo');
        count.textContent = `${result.likes} ${result.likes === 1 ? 'like' : 'likes'}`;
      } catch (error) {
        showNotice(error.message, true);
      } finally {
        like.disabled = false;
      }
    });
    const count = document.createElement('strong');
    count.className = 'feed-like-count';
    count.textContent = `${Number(post.likes) || 0} ${(Number(post.likes) || 0) === 1 ? 'like' : 'likes'}`;
    const share = makeButton('Share', () => openPhotoShare(post), 'secondary');
    share.classList.add('feed-share');
    actions.append(like, count, share);
    if (post.author?.id === state.user.id) {
      const remove = makeButton('Delete', () => removeProfilePhoto(post.id), 'secondary');
      remove.classList.add('feed-delete');
      actions.appendChild(remove);
    }
    card.append(header, image, actions);
    if (post.caption) {
      const caption = document.createElement('p');
      caption.className = 'feed-post-caption';
      caption.textContent = post.caption;
      card.appendChild(caption);
    }
    list.appendChild(card);
  });
}

function openPhotoShare(photoPost) {
  const dialog = $('photo-share-dialog');
  const friends = $('photo-share-friends');
  const notice = $('photo-share-notice');
  friends.replaceChildren();
  notice.textContent = '';
  notice.classList.remove('error');
  if (!state.friends.length) {
    notice.textContent = 'Add a friend before sharing photos in messages.';
  }
  state.friends.forEach(friend => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'photo-share-friend';
    const avatar = document.createElement('span');
    avatar.className = 'photo-share-avatar';
    setAvatar(avatar, friend);
    const name = document.createElement('strong');
    name.textContent = friend.name;
    button.append(avatar, name);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const message = await post(`/chat/${encodeURIComponent(friend.id)}`, { type: 'photo', photoId: photoPost.id });
        const sharedMessage = {
          ...message,
          photo: { id: photoPost.id, image: photoPost.image, caption: photoPost.caption || '', author: photoPost.author },
        };
        state.lastMessages[friend.id] = { ...sharedMessage, text: 'Photo' };
        if (state.activeFriend?.id === friend.id) {
          state.chatMessages.push(sharedMessage);
          state.chatAfter = Math.max(state.chatAfter, sharedMessage.ts);
          renderMessages($('chat-messages'), state.chatMessages, 'Say hello to your friend.');
        }
        renderFriends();
        dialog.close();
        showNotice(`Photo shared with ${friend.name}.`);
      } catch (error) {
        notice.textContent = error.message;
        notice.classList.add('error');
        button.disabled = false;
      }
    });
    friends.appendChild(button);
  });
  dialog.showModal();
}

async function loadReels(reset = false, append = false) {
  if (state.reelsLoading) return;
  const list = $('reels-feed');
  const status = $('reels-status');
  const more = $('reels-more');
  if (reset) {
    pauseActiveReel();
    state.reelsLazyObserver?.disconnect();
    state.reelsVisibilityObserver?.disconnect();
    state.reelsVisibleRatios.clear();
    state.reelsLazyObserver = null;
    state.reelsVisibilityObserver = null;
    state.reelPlayers.forEach(player => {
      try { player.destroy(); }
      catch (error) { console.error('Could not release a Reel player:', error); }
    });
    state.reelPlayers.clear();
    if (state.reelsPageObserver && state.reelsObservedEnd) state.reelsPageObserver.unobserve(state.reelsObservedEnd);
    state.reelsObservedEnd = null;
    state.reelsNextPageToken = null;
    state.reelsLoaded = false;
    list.replaceChildren();
  }
  if (state.reelsLoaded && !reset && !append) return;
  if ('IntersectionObserver' in window) {
    state.reelsLazyObserver ||= new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const player = entry.target;
        if (!player.dataset.src) return;
        player.src = player.dataset.src;
        player.removeAttribute('data-src');
        state.reelsLazyObserver.unobserve(player);
        if (state.activeReelPlayer === player) initializeReelPlayer(player);
      });
    }, { root: list, rootMargin: '100% 0px' });
    state.reelsPageObserver ||= new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || state.reelsLoading) return;
      if (state.reelsObservedEnd) state.reelsPageObserver.unobserve(state.reelsObservedEnd);
      state.reelsObservedEnd = null;
      loadReels(false, true);
    }, { root: list, rootMargin: '100% 0px' });
    state.reelsVisibilityObserver ||= new IntersectionObserver(entries => {
      entries.forEach(entry => {
        state.reelsVisibleRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      });
      const active = [...state.reelsVisibleRatios.entries()]
        .filter(([, ratio]) => ratio >= 0.45)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      setActiveReel(active?.querySelector('.reel-player') || null);
    }, { root: list, threshold: [0, 0.25, 0.45, 0.65, 0.85, 1] });
  }
  state.reelsLoading = true;
  status.classList.remove('error');
  status.textContent = 'Loading Reels…';
  more.hidden = true;
  try {
    const path = `/social/reels${state.reelsNextPageToken ? `?pageToken=${encodeURIComponent(state.reelsNextPageToken)}` : ''}`;
    const data = await api(path);
    if (!Array.isArray(data.items)) throw new Error('Invalid Reels feed response');
    data.items.forEach(reel => {
      const card = document.createElement('article');
      card.className = 'reel-card';
      const player = document.createElement('iframe');
      player.className = 'reel-player';
      player.dataset.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(reel.id)}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&playsinline=1&rel=0&mute=1`;
      player.title = `${reel.title} — ${reel.channel}`;
      player.loading = 'lazy';
      player.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      player.referrerPolicy = 'strict-origin-when-cross-origin';
      player.allowFullscreen = true;
      const details = document.createElement('div');
      details.className = 'reel-details';
      const title = document.createElement('strong');
      title.textContent = reel.title;
      const channel = document.createElement('span');
      channel.textContent = reel.channel;
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/shorts/${encodeURIComponent(reel.id)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open on YouTube';
      details.append(title, channel, link);
      card.append(player, details);
      list.appendChild(card);
      if (state.reelsVisibilityObserver) state.reelsVisibilityObserver.observe(card);
      if (state.reelsLazyObserver) state.reelsLazyObserver.observe(player);
      else {
        player.src = player.dataset.src;
        player.removeAttribute('data-src');
      }
    });
    state.reelsNextPageToken = data.nextPageToken || null;
    state.reelsLoaded = true;
    status.textContent = data.items.length
      ? 'Recent YouTube Shorts selected for this community. Reels autoplay muted; use the player controls for sound.'
      : list.childElementCount ? '' : 'No matching Shorts found yet. Try another topic in Super Admin settings.';
    more.hidden = !state.reelsNextPageToken || Boolean(state.reelsPageObserver);
    if (state.reelsNextPageToken && state.reelsPageObserver && list.lastElementChild) {
      state.reelsObservedEnd = list.lastElementChild;
      state.reelsPageObserver.observe(state.reelsObservedEnd);
    }
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    more.hidden = !state.reelsNextPageToken;
  } finally {
    state.reelsLoading = false;
  }
}

function initializeReelPlayer(iframe) {
  if (!state.youtubeReady || !window.YT?.Player || !iframe.src || state.reelPlayers.has(iframe)) return;
  const player = new YT.Player(iframe, {
    playerVars: { mute: 1, playsinline: 1, rel: 0 },
    events: {
      onReady: event => {
        if (state.activeReelPlayer === iframe && document.body.classList.contains('reels-active')) {
          event.target.mute();
          event.target.playVideo();
        }
      },
      onAutoplayBlocked: event => {
        if (state.activeReelPlayer === iframe) {
          event.target.mute();
          event.target.playVideo();
          $('reels-status').textContent = 'Playing muted because of your browser settings. Use the player controls to turn sound on.';
        }
      },
    },
  });
  state.reelPlayers.set(iframe, player);
}

function setActiveReel(iframe) {
  if (iframe === state.activeReelPlayer) return;
  pauseActiveReel();
  state.activeReelPlayer = iframe;
  if (!iframe || !document.body.classList.contains('reels-active')) return;
  if (!iframe.src && iframe.dataset.src) {
    iframe.src = iframe.dataset.src;
    iframe.removeAttribute('data-src');
    state.reelsLazyObserver?.unobserve(iframe);
  }
  initializeReelPlayer(iframe);
  const player = state.reelPlayers.get(iframe);
  if (!player) return;
  try {
    player.mute();
    player.playVideo();
  } catch (error) {
    console.error('Could not start the active Reel:', error);
    $('reels-status').textContent = 'Could not start this video. Tap to try again.';
  }
}

function pauseActiveReel() {
  const iframe = state.activeReelPlayer;
  if (!iframe) return;
  const player = state.reelPlayers.get(iframe);
  if (player) {
    try { player.pauseVideo(); }
    catch (error) { console.error('Could not pause the previous Reel:', error); }
  }
  state.activeReelPlayer = null;
}

async function loadFeed() {
  if (state.feedLoading) return;
  state.feedLoading = true;
  try {
    const posts = await api('/social/feed');
    if (!Array.isArray(posts)) throw new Error('Invalid photo feed response');
    renderFeed(posts);
  } finally {
    state.feedLoading = false;
  }
}

function renderFriends() {
  $('friend-count').textContent = String(state.friends.length);
  $('discover-friend-count').textContent = String(state.friends.length);
  renderList($('friends-list'), state.friends, 'Your friends will show up here.', friend =>
    makePerson(friend, [
      makeButton('Profile', () => openProfile(friend)),
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
    setAvatar(avatar, friend);
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
          makeButton('Profile', () => openProfile(request.userId)),
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
    setAvatar(avatar, profile);
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
    actions.appendChild(makeButton('View profile', () => openProfile(profile)));
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
      setAvatar(avatar, message.from === state.user.id ? state.user : state.activeFriend);
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
    } else if (message.type === 'photo') {
      if (message.photo?.image) {
        const image = document.createElement('img');
        image.className = 'message-photo';
        image.src = message.photo.image;
        image.alt = message.photo.caption || `Photo from ${message.photo.author?.name || 'a friend'}`;
        image.loading = 'lazy';
        bubble.classList.add('photo-message');
        bubble.appendChild(image);
        if (message.photo.caption) {
          const caption = document.createElement('span');
          caption.className = 'message-photo-caption';
          caption.textContent = message.photo.caption;
          bubble.appendChild(caption);
        }
      } else {
        bubble.classList.add('photo-unavailable');
        bubble.textContent = 'Photo unavailable';
      }
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
    ? `${friend?.name || 'Your friend'} is calling${call.kind === 'video' ? ' · video' : ' · audio'}`
    : call.status === 'dialing' ? `${call.kind === 'video' ? 'Video' : 'Audio'} calling ${friend?.name || 'friend'}`
      : `${friend?.name || 'Friend'} · ${call.kind === 'video' ? 'video' : 'audio'} call`;
  $('call-status').textContent = ({
    incoming: `Incoming ${call.kind} call`,
    dialing: 'Ringing…',
    connecting: 'Connecting…',
    active: 'Connected',
  })[call.status] || '';
  $('call-accept').hidden = call.status !== 'incoming';
  $('call-decline').hidden = call.status !== 'incoming';
  $('call-mute').hidden = call.status !== 'active';
  $('call-end').hidden = call.status === 'incoming' || call.status === 'idle';
  $('call-camera').hidden = call.status !== 'active' || call.kind !== 'video';
  $('call-video-grid').hidden = call.kind !== 'video' || call.status === 'incoming' || call.status === 'idle';
  $('call-mute').classList.toggle('muted', call.muted);
  $('call-mute').setAttribute('aria-label', call.muted ? 'Unmute microphone' : 'Mute microphone');
  $('call-mute').innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="/icons.svg#${call.muted ? 'mic-off' : 'mic'}"></use></svg>`;
  $('chat-call-button').disabled = !state.activeFriend || active;
  $('chat-video-button').disabled = !state.activeFriend || active;
  $('chat-call-button').setAttribute('aria-label', `Start audio call${state.activeFriend ? ` with ${state.activeFriend.name}` : ''}`);
  $('chat-video-button').setAttribute('aria-label', `Start video call${state.activeFriend ? ` with ${state.activeFriend.name}` : ''}`);
}

async function sendCallSignal(type, payload = {}) {
  const { friendId, sessionId } = state.call;
  if (!friendId || !sessionId) throw new Error('No active call');
  await post(`/calls/${encodeURIComponent(friendId)}/signal`, { type, sessionId, ...payload });
}

async function createCallPeer() {
  const sessionId = state.call.sessionId;
  const config = await api('/calls/config');
  if (state.call.sessionId !== sessionId || state.call.finishing || !state.call.localStream) throw new Error('Call was cancelled.');
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
    const stream = event.streams[0];
    if (state.call.kind === 'video') {
      $('remote-video').srcObject = stream;
      $('remote-video').play().catch(() => showNotice('Tap the video to hear your friend.'));
    } else {
      $('remote-audio').srcObject = stream;
      $('remote-audio').play().catch(() => showNotice('Tap the audio player to hear your friend.'));
    }
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

async function startCall(kind = 'audio') {
  if (!state.activeFriend || state.call.status !== 'idle') return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    showNotice('Audio and video calls require a supported browser and secure connection.', true);
    return;
  }
  const sessionId = crypto.randomUUID();
  try {
    state.call = {
      status: 'dialing', kind, sessionId, friendId: state.activeFriend.id, peer: null,
      localStream: null, pendingCandidates: [], outgoingCandidates: [], signalReady: false,
      muted: false, seenSignals: state.call.seenSignals, offer: null, timeout: null,
    };
    updateCallPanel();
    state.call.timeout = setTimeout(() => {
      if (state.call.sessionId === sessionId && state.call.status === 'dialing') {
        showNotice('No answer. The call ended.');
        finishCall(true);
      }
    }, 60000);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
    if (state.call.sessionId !== sessionId || state.call.finishing) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.call.localStream = stream;
    if (kind === 'video') {
      $('local-video').srcObject = stream;
      $('local-video').play().catch(error => console.warn('Local camera preview awaits a play gesture.', error));
    }
    const peer = await createCallPeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendCallSignal('offer', { description: peer.localDescription.toJSON(), callType: kind });
    state.call.signalReady = true;
    await flushCallCandidates();
    updateCallPanel();
  } catch (error) {
    if (state.call.sessionId === sessionId && !state.call.finishing) {
      showNotice(error.message || `Could not start the ${kind} call.`, true);
      finishCall(false);
    }
  }
}

async function acceptAudioCall() {
  if (state.call.status !== 'incoming' || !state.call.offer) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    showNotice('Audio and video calls require a supported browser and secure connection.', true);
    return;
  }
  const sessionId = state.call.sessionId;
  try {
    state.call.status = 'connecting';
    updateCallPanel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: state.call.kind === 'video' });
    if (state.call.sessionId !== sessionId || state.call.finishing) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.call.localStream = stream;
    if (state.call.kind === 'video') {
      $('local-video').srcObject = stream;
      $('local-video').play().catch(error => console.warn('Local camera preview awaits a play gesture.', error));
    }
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
      showNotice(error.message || `Could not join the ${state.call.kind} call.`, true);
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
  $('local-video').pause();
  $('local-video').srcObject = null;
  $('remote-video').pause();
  $('remote-video').srcObject = null;
  if (window.parent !== window) window.parent.postMessage({ type: 'nymix-call-ended' }, window.location.origin);
  state.call = {
    status: 'idle', kind: 'audio', sessionId: null, friendId: null, peer: null, localStream: null,
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
    state.call.kind = signal.callType === 'video' ? 'video' : 'audio';
    state.call.status = 'incoming';
    state.call.offer = signal.description;
    if (window.parent !== window) window.parent.postMessage({
      type: 'nymix-call-alert',
      name: friend.name,
      kind: state.call.kind,
    }, window.location.origin);
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
    showNotice(signal.type === 'reject' ? `${friend.name} declined the call.` : 'Call ended.');
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
  syncChatPlayback(null);
  state.activeFriend = friend;
  state.chatMessages = [];
  state.chatAfter = 0;
  $('chat-title').textContent = friend.name;
  $('chat-subtitle').textContent = 'Your Nymix friend';
  setAvatar($('chat-avatar'), friend);
  $('inbox-layout').classList.add('conversation-open');
  $('chat-input').disabled = false;
  $('chat-send').disabled = false;
  $('record-voice').disabled = false;
  $('chat-game-button').disabled = false;
  $('chat-listen-button').disabled = false;
  $('chat-call-button').disabled = state.call.status !== 'idle';
  $('chat-video-button').disabled = state.call.status !== 'idle';
  $('inline-game').hidden = state.activeGameFriendId !== friend.id;
  $('chat-listen-activity').querySelector('.listen-card').hidden = state.activeRoomFriendId !== friend.id;
  setPanel('chat');
  await refreshChat(true);
  await refreshChatPlayback();
  renderFriends();
  renderChatInvites();
}

async function refreshChat(initial = false) {
  if (!state.activeFriend) return;
  const friendId = state.activeFriend.id;
  const after = initial ? 0 : Math.max(0, state.chatAfter - 1);
  const messages = await api(`/chat/${encodeURIComponent(friendId)}?after=${after}`);
  if (state.activeFriend?.id !== friendId) return;
  const knownMessages = new Map(state.chatMessages.map(message => [message.id, message]));
  let changed = false;
  messages.forEach(message => {
    const previous = knownMessages.get(message.id);
    if (!previous || (message.type === 'photo' && previous.photo?.image !== message.photo?.image)) changed = true;
    knownMessages.set(message.id, message);
  });
  state.chatMessages = [...knownMessages.values()];
  state.chatMessages.sort((a, b) => a.ts - b.ts);
  state.chatAfter = Math.max(state.chatAfter, ...state.chatMessages.map(message => message.ts), 0);
  if (initial || changed) {
    renderMessages($('chat-messages'), state.chatMessages, `This is the beginning of your conversation with ${state.activeFriend.name}.`);
    const latest = state.chatMessages[state.chatMessages.length - 1];
    if (latest) state.lastMessages[state.activeFriend.id] = {
      ...latest,
      text: latest.type === 'audio' ? 'Voice message' : latest.type === 'photo' ? 'Photo' : latest.text,
    };
    renderFriends();
  }
  if ((initial || changed) && state.chatMessages.some(message => message.from === friendId)) {
    try { await post(`/notifications/read/${encodeURIComponent(friendId)}`); }
    catch (error) { showNotice(error.message, true); }
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
      button.disabled = true;
      try {
        await updateSharedPlayback('song', song);
        $('chat-song-picker').hidden = true;
      } catch (error) {
        showNotice(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  });
}

function ensureChatPlayer(playback) {
  if (!state.youtubeReady || !window.YT?.Player || state.chatPlayer || !playback?.song?.id) return;
  state.chatPlayerSongId = playback.song.id;
  state.chatPlayer = new YT.Player('chat-player', {
    width: '100%',
    height: '180',
    videoId: playback.song.id,
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
    events: {
      onReady: () => {
        state.chatPlayerReady = true;
        if (state.chatPlayback) syncChatPlayback(state.chatPlayback, true);
      },
      onAutoplayBlocked: () => {
        $('chat-playback-enable').hidden = false;
        $('chat-playback-status').textContent = 'Tap “Tap to listen” to start audio on this device.';
      },
      onError: () => showNotice('This YouTube video cannot be played here.', true),
    },
  });
}

function syncChatPlayback(playback, force = false) {
  if (!playback?.song?.id) {
    $('chat-playback-card').hidden = true;
    $('chat-playback-enable').hidden = true;
    if (state.chatPlayerReady) {
      try { state.chatPlayer.pauseVideo(); } catch {}
    }
    state.chatPlayback = null;
    state.chatPlaybackSignature = '';
    return;
  }
  state.chatPlayback = playback;
  $('chat-playback-card').hidden = false;
  $('chat-playback-title').textContent = playback.song.title;
  $('chat-playback-status').textContent = playback.playing
    ? `Playing for you and ${state.activeFriend?.name || 'your friend'}`
    : 'Paused for both of you.';
  $('chat-playback-play').disabled = !state.chatPlayerReady;
  $('chat-playback-pause').disabled = !state.chatPlayerReady;
  const signature = `${playback.song.id}:${playback.playing}:${playback.updatedAt}`;
  if (state.chatPlaybackSignature && state.chatPlaybackSignature !== signature) {
    $('chat-playback-enable').hidden = true;
  }
  ensureChatPlayer(playback);
  if (!state.chatPlayerReady || state.chatPlaybackSyncing) return;
  const songChanged = state.chatPlayerSongId !== playback.song.id;
  let drift = Infinity;
  try { drift = Math.abs((state.chatPlayer.getCurrentTime() || 0) - playback.position); } catch {}
  if (!force && !songChanged && state.chatPlaybackSignature === signature && (!playback.playing || drift < 4)) return;
  state.chatPlaybackSyncing = true;
  state.chatPlaybackSignature = signature;
  state.chatPlayerSongId = playback.song.id;
  try {
    if (songChanged) {
      if (playback.playing) state.chatPlayer.loadVideoById({ videoId: playback.song.id, startSeconds: playback.position });
      else state.chatPlayer.cueVideoById({ videoId: playback.song.id, startSeconds: playback.position });
    } else if (force || drift > 4) {
      state.chatPlayer.seekTo(playback.position, true);
    }
    if (playback.playing) state.chatPlayer.playVideo();
    else state.chatPlayer.pauseVideo();
  } catch (error) {
    console.error('Could not sync chat playback:', error);
    $('chat-playback-status').textContent = 'Could not sync playback on this device.';
  }
  setTimeout(() => { state.chatPlaybackSyncing = false; }, 900);
}

async function updateSharedPlayback(action, song) {
  if (!state.activeFriend) throw new Error('Choose a friend before starting shared playback.');
  const position = action === 'song' ? 0
    : state.chatPlayerReady ? state.chatPlayer.getCurrentTime() || 0
      : Number(state.chatPlayback?.position) || 0;
  const friendId = state.activeFriend.id;
  if (action === 'song' && song) {
    syncChatPlayback({ song, playing: true, position: 0, updatedAt: Date.now() }, true);
  }
  const result = await put(`/chat/${encodeURIComponent(friendId)}/playback`, {
    action,
    ...(song ? { song } : { position }),
  });
  if (state.activeFriend?.id === friendId) syncChatPlayback(result.playback, action === 'song');
}

async function refreshChatPlayback() {
  if (!state.activeFriend) return;
  const friendId = state.activeFriend.id;
  const response = await api(`/chat/${encodeURIComponent(friendId)}/playback`);
  if (state.activeFriend?.id !== friendId) return;
  const next = response.playback;
  const signature = next ? `${next.song.id}:${next.playing}:${next.updatedAt}` : '';
  syncChatPlayback(next, signature !== state.chatPlaybackSignature);
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
    } else showNotice(error.message, true);
  }
}

async function refreshSocial() {
  if (state.refreshBusy || document.hidden) return;
  state.refreshBusy = true;
  try {
    await refreshOverview();
    if (state.activeFriend) {
      await refreshChat();
      await refreshChatPlayback();
    }
    if (state.activeRoom) await refreshListenRoom();
    if (state.activeGame) await refreshActiveGame();
  } catch (error) {
    if (!window.location.pathname.endsWith('/login.html')) showNotice(error.message, true);
  } finally {
    state.refreshBusy = false;
  }
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
if (tab.dataset.panel === 'profile') openProfile(state.user.id);
else setPanel(tab.dataset.panel);
}));

$('discover-from-inbox').addEventListener('click', () => setPanel('people'));
$('discover-from-empty').addEventListener('click', () => setPanel('people'));

$('back-to-inbox').addEventListener('click', () => $('inbox-layout').classList.remove('conversation-open'));

$('thread-search').addEventListener('input', renderFriends);

$('chat-game-button').addEventListener('click', () => {
  if (state.activeFriend) challengeFriend(state.activeFriend);
});

$('chat-call-button').addEventListener('click', () => startCall('audio'));
$('chat-video-button').addEventListener('click', () => startCall('video'));
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
$('call-camera').addEventListener('click', () => {
  const track = state.call.localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $('call-camera').setAttribute('aria-label', track.enabled ? 'Turn camera off' : 'Turn camera on');
  $('call-camera').classList.toggle('muted', !track.enabled);
});
$('record-voice').addEventListener('click', toggleVoiceRecording);

$('chat-listen-button').addEventListener('click', () => {
  if (!state.activeFriend) return;
  $('chat-song-picker').hidden = false;
  $('song-search').focus();
});

$('chat-playback-play').addEventListener('click', async () => {
  if (!state.chatPlayback) return;
  try {
    state.chatPlayer.playVideo();
    $('chat-playback-enable').hidden = true;
    await updateSharedPlayback('play');
  } catch (error) {
    showNotice(error.message, true);
    refreshChatPlayback().catch(refreshError => showNotice(refreshError.message, true));
  }
});

$('chat-playback-pause').addEventListener('click', async () => {
  if (!state.chatPlayback) return;
  try {
    state.chatPlayer.pauseVideo();
    await updateSharedPlayback('pause');
  } catch (error) { showNotice(error.message, true); }
});

$('chat-playback-enable').addEventListener('click', () => {
  if (!state.chatPlayback || !state.chatPlayerReady) return;
  try {
    state.chatPlayer.seekTo(state.chatPlayback.position, true);
    if (state.chatPlayback.playing) state.chatPlayer.playVideo();
    $('chat-playback-enable').hidden = true;
    $('chat-playback-status').textContent = `Playing for you and ${state.activeFriend?.name || 'your friend'}`;
  } catch (error) { showNotice(error.message, true); }
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

$('account-profile-button').addEventListener('click', () => openProfile(state.user.id));
$('feed-refresh').addEventListener('click', () => loadFeed().catch(error => showNotice(error.message, true)));
$('reels-refresh').addEventListener('click', () => loadReels(true));
$('reels-more').addEventListener('click', () => loadReels(false, true));
$('feed-profile-button').addEventListener('click', () => openProfile(state.user.id));
$('profile-page-edit').addEventListener('click', () => {
  if (!state.profileTarget || state.profileTarget.id !== state.user.id) return;
  $('profile-dialog').showModal();
});
$('profile-page-action').addEventListener('click', () => $('profile-action').click());
$('feed-photo').addEventListener('change', event => {
  const file = event.currentTarget.files?.[0];
  if (state.feedPreviewUrl) URL.revokeObjectURL(state.feedPreviewUrl);
  state.feedPreviewUrl = '';
  $('feed-preview').hidden = !file;
  $('feed-submit').disabled = !file;
  $('feed-form-notice').textContent = '';
  $('feed-form-notice').classList.remove('error');
  if (file) {
    state.feedPreviewUrl = URL.createObjectURL(file);
    $('feed-preview').src = state.feedPreviewUrl;
  } else {
    $('feed-preview').removeAttribute('src');
  }
});
$('feed-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('feed-photo');
  const file = input.files?.[0];
  if (!file) return;
  const submit = $('feed-submit');
  const status = $('feed-form-notice');
  submit.disabled = true;
  status.textContent = 'Sharing photo…';
  status.classList.remove('error');
  try {
    const image = await compressProfilePhoto(file, 64 * 1024);
    await post('/user/photos', { image, caption: $('feed-caption').value.trim() });
    input.value = '';
    $('feed-caption').value = '';
    if (state.feedPreviewUrl) URL.revokeObjectURL(state.feedPreviewUrl);
    state.feedPreviewUrl = '';
    $('feed-preview').removeAttribute('src');
    $('feed-preview').hidden = true;
    status.textContent = 'Photo shared to your profile and feed.';
    await loadFeed();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    submit.disabled = !input.files?.length;
  }
});
$('chat-profile-button').addEventListener('click', () => {
  if (state.activeFriend) openProfile(state.activeFriend.id);
});
$('profile-close').addEventListener('click', () => $('profile-dialog').close());
$('profile-cancel').addEventListener('click', () => $('profile-dialog').close());
$('profile-dialog').addEventListener('click', event => {
  if (event.target === $('profile-dialog')) $('profile-dialog').close();
});
$('photo-share-close').addEventListener('click', () => $('photo-share-dialog').close());
$('photo-share-dialog').addEventListener('click', event => {
  if (event.target === $('photo-share-dialog')) $('photo-share-dialog').close();
});
$('profile-photo-input').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    state.profilePhoto = await compressProfilePhoto(file);
    setAvatar($('profile-dialog-avatar'), { ...state.profileTarget, avatar: state.profilePhoto });
    $('profile-remove-photo').hidden = false;
    $('profile-notice').textContent = 'Photo ready. Save changes to update your profile.';
    $('profile-notice').classList.remove('error');
  } catch (error) {
    $('profile-notice').textContent = error.message;
    $('profile-notice').classList.add('error');
  } finally {
    input.value = '';
  }
});
$('profile-gallery-input').addEventListener('change', event => {
  const input = event.currentTarget;
  uploadProfilePhotos(input, $('profile-gallery-add-label'), $('profile-notice'))
    .catch(error => {
      $('profile-notice').textContent = error.message;
      $('profile-notice').classList.add('error');
    });
});
$('profile-page-photo-input').addEventListener('change', event => {
  uploadProfilePhotos(event.currentTarget, $('profile-page-add-label'), $('profile-page-notice'))
    .catch(error => {
      $('profile-page-notice').textContent = error.message;
      $('profile-page-notice').classList.add('error');
    });
});
$('profile-remove-photo').addEventListener('click', () => {
  state.profilePhoto = '';
  setAvatar($('profile-dialog-avatar'), { ...state.profileTarget, avatar: '' });
  $('profile-remove-photo').hidden = true;
  $('profile-notice').textContent = 'Photo removed. Save changes to update your profile.';
  $('profile-notice').classList.remove('error');
});
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('profile-name').value.trim();
  const bio = $('profile-bio').value.trim();
  if (!name) {
    $('profile-notice').textContent = 'Name cannot be empty.';
    $('profile-notice').classList.add('error');
    return;
  }
  $('profile-save').disabled = true;
  try {
    const result = await put('/user/profile', { name, bio, avatar: state.profilePhoto });
    state.user = { ...state.user, ...result.user };
    state.profileTarget = { ...state.profileTarget, ...result.user };
    localStorage.setItem('nx_user', JSON.stringify(state.user));
    $('account-name').textContent = state.user.name;
    setAvatar($('account-avatar'), state.user);
    renderProfilePage(state.profileTarget);
    $('profile-display-name').textContent = state.user.name;
    $('profile-notice').textContent = 'Profile updated.';
    $('profile-notice').classList.remove('error');
    window.parent.postMessage({ type: 'nymix-profile-updated', user: state.user }, window.location.origin);
    await refreshOverview().catch(error => showNotice(error.message, true));
  } catch (error) {
    $('profile-notice').textContent = error.message;
    $('profile-notice').classList.add('error');
  } finally {
    $('profile-save').disabled = false;
  }
});
$('profile-action').addEventListener('click', async () => {
  const profile = state.profileTarget;
  if (!profile || profile.id === state.user.id) return;
  if (profile.relation === 'friends') {
    const friend = state.friends.find(item => item.id === profile.id) || profile;
    $('profile-dialog').close();
    await selectFriend(friend);
  } else if (profile.relation === 'received') {
    $('profile-dialog').close();
    setPanel('people');
    $('requests-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (profile.relation === 'none') {
    const button = $('profile-action');
    button.disabled = true;
    try {
      await post(`/friends/request/${encodeURIComponent(profile.id)}`);
      profile.relation = 'sent';
      button.textContent = 'Request sent';
      configureProfileAction($('profile-page-action'), profile, false);
      $('profile-page-notice').textContent = `Friend request sent to ${profile.name}.`;
      showNotice(`Friend request sent to ${profile.name}.`);
      await refreshSocial();
      await refreshSuggestions().catch(error => showNotice(error.message, true));
    } catch (error) {
      button.disabled = false;
      $('profile-notice').textContent = error.message;
      $('profile-notice').classList.add('error');
    }
  }
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
  if (state.chatPlayback) ensureChatPlayer(state.chatPlayback);
  if (state.activeReelPlayer) initializeReelPlayer(state.activeReelPlayer);
};

const chatListenCard = document.querySelector('#panel-listen .listen-card');
if (chatListenCard) {
  $('chat-listen-activity').appendChild(chatListenCard);
  chatListenCard.hidden = true;
}

const initialPanel = new URLSearchParams(window.location.search).get('panel');
if (initialPanel === 'people' || initialPanel === 'chat' || initialPanel === 'feed' || initialPanel === 'reels') setPanel(initialPanel, false);
else if (initialPanel === 'profile') setPanel('profile', false);
syncEmbeddedHomeHeight();
if (typeof ResizeObserver !== 'undefined') {
  state.homeFeedResizeObserver = new ResizeObserver(syncEmbeddedHomeHeight);
  state.homeFeedResizeObserver.observe(document.querySelector('.messages-main'));
  state.homeFeedResizeObserver.observe($('feed-list'));
}
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'nymix-social-open-profile') {
    openProfile(state.user.id, false);
    return;
  }
  if (event.data?.type === 'nymix-social-open-chat' && typeof event.data.friendId === 'string') {
    const openChat = async () => {
      if (!state.friends.length) await refreshOverview();
      const friend = state.friends.find(item => item.id === event.data.friendId);
      if (!friend) throw new Error('This friend is no longer available.');
      await selectFriend(friend);
    };
    openChat().catch(error => showNotice(error.message, true));
    return;
  }
  if (event.data?.type === 'nymix-social-panel' && ['people', 'chat', 'feed', 'reels'].includes(event.data.panel)) {
    if (typeof event.data.homeFeed === 'boolean') state.homeFeed = event.data.homeFeed;
    setPanel(event.data.panel, false);
    if (event.data.panel === 'people' && event.data.focusRequests === true) {
      requestAnimationFrame(() => {
        const requestCard = $('friend-requests-card');
        requestCard?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        });
        requestCard?.classList.add('focus-target');
        window.setTimeout(() => requestCard?.classList.remove('focus-target'), 1800);
      });
    }
  } else if (event.data?.type === 'nymix-social-panel' && event.data.panel === 'profile') {
    openProfile(state.user.id, false);
  }
});
window.addEventListener('beforeunload', () => {
  if (state.feedPreviewUrl) URL.revokeObjectURL(state.feedPreviewUrl);
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
    setAvatar($('account-avatar'), state.user);
  if (initialPanel === 'profile') openProfile(state.user.id, false);
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
