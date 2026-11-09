(() => {
  const $ = selector => document.querySelector(selector);
  const token = () => localStorage.getItem('nx_token');
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase();
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('nx_user') || 'null'); }
    catch (error) {
      console.error('Could not read the signed-in user.', error);
      return null;
    }
  })();
  const peers = new Map();
  const seenSignals = new Set();
  let room;
  let localStream = null;
  let sourceUpdatedAt = 0;
  let roomTimer;
  let chatTimer;
  let signalTimer;
  let toastTimer;
  let lastMessageId = null;
  let localVideoUrl = '';

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

  function showToast(message) {
    const toast = $('#room-toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function showPlayerMessage(title, description) {
    $('#watch-stage').innerHTML = `<div class="watch-empty"><span>▶</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
  }

  function clearLocalVideo() {
    const video = $('#local-video');
    video.pause();
    video.removeAttribute('src');
    video.srcObject = null;
    video.load();
    if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    localVideoUrl = '';
  }

  function embedUrl(source) {
    if (source.type === 'youtube') {
      const url = new URL(source.url);
      const id = url.hostname === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop();
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    }
    if (source.type === 'drive') {
      const url = new URL(source.url);
      const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
      const id = pathMatch?.[1] || url.searchParams.get('id');
      return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
    }
    return '';
  }

  function renderSource(source) {
    const stage = $('#watch-stage');
    if (!source) {
      showPlayerMessage('Settle in together', 'The room host can share a screen, add an official video link, or play a local video.');
      $('#playback-status').textContent = 'Waiting for the host to start playback';
      return;
    }
    $('#room-title').textContent = source.title || 'Movie night';
    if (source.type === 'youtube' || source.type === 'drive') {
      stage.innerHTML = `<iframe title="${escapeHtml(source.title || 'Shared video')}" src="${escapeHtml(embedUrl(source))}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      $('#playback-status').textContent = `${source.type === 'youtube' ? 'YouTube' : 'Google Drive'} · playback controls are on the player`;
      return;
    }
    stage.innerHTML = '<video id="remote-video" autoplay playsinline controls></video>';
    $('#playback-status').textContent = source.type === 'screen' ? 'The host is sharing a browser tab or screen' : 'The host is playing a local video';
    const video = $('#remote-video');
    if (room.hostId === user.id && localStream) {
      video.srcObject = localStream;
      video.muted = false;
      video.play().catch(error => console.warn('Host preview awaits a play gesture.', error));
    } else {
      const stream = [...peers.values()].find(peer => peer.remoteStream)?.remoteStream;
      if (stream) {
        video.srcObject = stream;
        video.play().catch(error => console.warn('Shared playback awaits a play gesture.', error));
      }
    }
  }

  function renderRoom(nextRoom) {
    room = nextRoom;
    $('#room-code').textContent = `PRIVATE ROOM · ${room.code}`;
    $('#account-name').textContent = user?.name || '';
    $('#end-room').hidden = room.hostId !== user?.id;
    $('#leave-room').hidden = room.hostId === user?.id;
    $('#source-panel').hidden = room.hostId !== user?.id;
    $('#member-list').innerHTML = room.members.map(member =>
      `<span class="member-chip">${escapeHtml(member.name)}${member.id === room.hostId ? ' · host' : ''}</span>`,
    ).join('');
    if (room.sourceUpdatedAt !== sourceUpdatedAt) {
      sourceUpdatedAt = room.sourceUpdatedAt;
      renderSource(room.source);
    }
  }

  function sourceInputChanged() {
    const type = $('#source-type').value;
    $('#source-url-field').hidden = !['youtube', 'drive'].includes(type);
    $('#source-file-field').hidden = type !== 'file';
    $('#source-url').required = ['youtube', 'drive'].includes(type);
    $('#file-picker').hidden = type !== 'file';
    $('#share-screen').hidden = type !== 'screen';
  }

  async function setSource(source) {
    const result = await api(`/api/watch-rooms/${encodeURIComponent(code)}/source`, {
      method: 'PUT',
      body: JSON.stringify({ source }),
    });
    room.source = result.source;
    room.sourceUpdatedAt = result.sourceUpdatedAt;
    sourceUpdatedAt = result.sourceUpdatedAt;
    renderSource(room.source);
  }

  async function startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast('Screen sharing is not available here. Try desktop Chrome or Edge.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      peers.forEach(peer => peer.connection.close());
      peers.clear();
      clearLocalVideo();
      localStream = stream;
      await setSource({ type: 'screen', title: 'Shared screen' });
      renderSource(room.source);
      $('#stop-sharing').hidden = false;
      await syncPeerConnections();
      localStream.getVideoTracks()[0]?.addEventListener('ended', stopScreenShare, { once: true });
      showToast('Your screen is being shared with the room.');
    } catch (error) {
      if (error.name === 'NotAllowedError') return;
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      console.error('Could not start screen sharing.', error);
      showToast(error.message || 'Could not start screen sharing.');
    }
  }

  async function stopScreenShare() {
    if (!localStream) return;
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    clearLocalVideo();
    $('#stop-sharing').hidden = true;
    peers.forEach(peer => peer.connection.close());
    peers.clear();
    if (room.hostId === user.id) {
      try { await setSource(null); }
      catch (error) {
        console.error('Could not stop the shared room source.', error);
        showToast(error.message || 'Could not stop sharing.');
      }
    }
    showToast('Screen sharing stopped.');
  }

  async function loadLocalVideo(file) {
    if (!file || !file.type.startsWith('video/')) {
      showToast('Choose a supported video file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      showToast('Choose a video smaller than 2 GB.');
      return;
    }
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    peers.forEach(peer => peer.connection.close());
    peers.clear();
    const video = $('#local-video');
    clearLocalVideo();
    localVideoUrl = URL.createObjectURL(file);
    video.src = localVideoUrl;
    video.muted = false;
    video.hidden = false;
    $('#watch-stage').replaceChildren(video);
    video.classList.add('room-local-video');
    try {
      await setSource({ type: 'file', title: file.name });
      $('#watch-stage').replaceChildren(video);
      await video.play();
      const capture = video.captureStream || video.mozCaptureStream;
      if (!capture) throw new Error('Local video sharing is not supported by this browser. Use screen sharing instead.');
      localStream = capture.call(video);
      await syncPeerConnections();
      $('#stop-sharing').hidden = false;
      showToast('Your local video is playing in the room.');
    } catch (error) {
      console.error('Could not share local video.', error);
      showToast(error.message || 'Could not play this local video.');
    }
  }

  async function loadIceServers() {
    const config = await api('/api/calls/config');
    return config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  async function sendSignal(to, type, payload = {}) {
    await api(`/api/watch-rooms/${encodeURIComponent(code)}/signals`, {
      method: 'POST',
      body: JSON.stringify({ to, type, ...payload }),
    });
  }

  async function createPeer(peerId, initiator) {
    if (peers.has(peerId)) return peers.get(peerId);
    const connection = new RTCPeerConnection({ iceServers: await loadIceServers() });
    const peer = { connection, remoteStream: new MediaStream(), candidates: [] };
    peers.set(peerId, peer);
    if (room.hostId === user.id && localStream) {
      localStream.getTracks().forEach(track => connection.addTrack(track, localStream));
    }
    connection.onicecandidate = event => {
      sendSignal(peerId, 'ice', { candidate: event.candidate ? event.candidate.toJSON() : null })
        .catch(error => console.error('Could not send media connection candidate.', error));
    };
    connection.ontrack = event => {
      peer.remoteStream.addTrack(event.track);
      const video = $('#remote-video');
      if (video && room.source && ['screen', 'file'].includes(room.source.type)) {
        video.srcObject = peer.remoteStream;
        video.play().catch(error => console.warn('Shared playback awaits a play gesture.', error));
      }
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        showToast('Could not connect directly. Your network may require a TURN relay.');
      }
      if (connection.connectionState === 'closed') peers.delete(peerId);
    };
    if (initiator) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await sendSignal(peerId, 'offer', { description: connection.localDescription });
    }
    return peer;
  }

  async function syncPeerConnections() {
    if (room.hostId !== user.id || !localStream) return;
    for (const member of room.members) {
      if (member.id === user.id || peers.has(member.id)) continue;
      try { await createPeer(member.id, true); }
      catch (error) {
        console.error(`Could not connect to ${member.name}.`, error);
        showToast(`Could not connect to ${member.name}.`);
      }
    }
  }

  async function handleSignal(signal) {
    if (seenSignals.has(signal.id)) return;
    seenSignals.add(signal.id);
    if (seenSignals.size > 1000) seenSignals.clear();
    const peer = await createPeer(signal.from, false);
    const connection = peer.connection;
    if (signal.type === 'offer') {
      await connection.setRemoteDescription(signal.description);
      for (const candidate of peer.candidates.splice(0)) await connection.addIceCandidate(candidate);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await sendSignal(signal.from, 'answer', { description: connection.localDescription });
    } else if (signal.type === 'answer') {
      if (connection.signalingState === 'have-local-offer') {
        await connection.setRemoteDescription(signal.description);
        for (const candidate of peer.candidates.splice(0)) await connection.addIceCandidate(candidate);
      }
    } else if (signal.candidate) {
      if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
      else peer.candidates.push(signal.candidate);
    }
  }

  async function pollSignals() {
    try {
      const signals = await api(`/api/watch-rooms/${encodeURIComponent(code)}/signals?after=${Date.now() - 15000}`);
      for (const signal of signals) {
        try { await handleSignal(signal); }
        catch (error) { console.error('Could not process room connection signal.', error); }
      }
    } catch (error) {
      console.error('Could not refresh room connections.', error);
    }
  }

  async function refreshRoom() {
    try {
      const nextRoom = await api(`/api/watch-rooms/${encodeURIComponent(code)}`);
      renderRoom(nextRoom);
      await syncPeerConnections();
    } catch (error) {
      console.error('Could not refresh watch room.', error);
      showToast(error.message || 'Could not refresh the room.');
    }
  }

  function renderMessages(messages) {
    const list = $('#chat-messages');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.innerHTML = messages.map(message => `<article class="chat-message${message.userId === user.id ? ' mine' : ''}">
      <strong>${escapeHtml(message.userName)}</strong><p>${escapeHtml(message.text)}</p>
    </article>`).join('') || '<p class="muted">Say hello to your friends.</p>';
    if (atBottom) list.scrollTop = list.scrollHeight;
    lastMessageId = messages.at(-1)?.id || '';
  }

  async function refreshChat() {
    try {
      const messages = await api(`/api/watch-rooms/${encodeURIComponent(code)}/chat`);
      if (lastMessageId === null || (messages.at(-1)?.id || '') !== lastMessageId) renderMessages(messages);
    } catch (error) {
      console.error('Could not load room chat.', error);
    }
  }

  async function initialize() {
    if (!token()) {
      window.location.replace('/login.html?next=movies');
      return;
    }
    if (!/^[A-F0-9]{8}$/.test(code)) {
      window.location.replace('/movies.html');
      return;
    }
    try {
      $('#account-name').textContent = user?.name || '';
      room = await api(`/api/watch-rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: '{}' });
      sourceUpdatedAt = room.sourceUpdatedAt;
      renderRoom(room);
      $('#room-code').textContent = `PRIVATE ROOM · ${room.code}`;
      await refreshRoom();
      await refreshChat();
      if (room.hostId === user.id) {
        sourceInputChanged();
        $('#host-tools').hidden = false;
        $('#end-room').hidden = false;
        $('#source-panel').hidden = false;
      }
      roomTimer = setInterval(refreshRoom, 2500);
      chatTimer = setInterval(refreshChat, 2200);
      signalTimer = setInterval(pollSignals, 1400);
      pollSignals();
    } catch (error) {
      console.error('Could not join private watch room.', error);
      showToast(error.message || 'Could not join the room.');
      setTimeout(() => window.location.replace('/movies.html'), 2200);
    }
  }

  $('#source-type').addEventListener('change', sourceInputChanged);
  $('#source-form').addEventListener('submit', async event => {
    event.preventDefault();
    const type = $('#source-type').value;
    try {
      if (type === 'screen') {
        await startScreenShare();
      } else if (type === 'file') {
        const file = $('#source-file').files?.[0];
        if (file) await loadLocalVideo(file);
        else showToast('Choose a local video using the Choose local video button.');
      } else {
        const url = $('#source-url').value.trim();
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        clearLocalVideo();
        $('#stop-sharing').hidden = true;
        peers.forEach(peer => peer.connection.close());
        peers.clear();
        await setSource({ type, url, title: type === 'youtube' ? 'YouTube watch party' : 'Google Drive watch party' });
        showToast('Shared video link is ready for everyone in the room.');
      }
    } catch (error) {
      console.error('Could not set up shared playback.', error);
      showToast(error.message || 'Could not set up playback.');
    }
  });
  $('#share-screen').addEventListener('click', startScreenShare);
  $('#stop-sharing').addEventListener('click', stopScreenShare);
  $('#source-file').addEventListener('change', event => loadLocalVideo(event.currentTarget.files?.[0]));

  $('#chat-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    const submit = event.currentTarget.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const message = await api(`/api/watch-rooms/${encodeURIComponent(code)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      input.value = '';
      const messages = await api(`/api/watch-rooms/${encodeURIComponent(code)}/chat`);
      if (!messages.some(item => item.id === message.id)) messages.push(message);
      renderMessages(messages);
    } catch (error) {
      console.error('Could not send room message.', error);
      showToast(error.message || 'Could not send your message.');
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });

  $('#copy-invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/watch-room.html?code=${encodeURIComponent(code)}`);
      showToast('Private room invite link copied. Only invited friends can join.');
    } catch (error) {
      console.error('Could not copy room invite link.', error);
      showToast('Could not copy the invite link in this browser.');
    }
  });

  async function leaveRoom(endRoom = false) {
    if (endRoom && !window.confirm('End this room for everyone?')) return;
    try {
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      peers.forEach(peer => peer.connection.close());
      clearInterval(roomTimer);
      clearInterval(chatTimer);
      clearInterval(signalTimer);
      await api(`/api/watch-rooms/${encodeURIComponent(code)}`, { method: 'DELETE' });
      window.location.replace('/movies.html');
    } catch (error) {
      console.error('Could not leave watch room.', error);
      showToast(error.message || 'Could not leave the room.');
    }
  }
  $('#leave-room').addEventListener('click', () => leaveRoom(false));
  $('#end-room').addEventListener('click', () => leaveRoom(true));
  window.addEventListener('beforeunload', () => {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    peers.forEach(peer => peer.connection.close());
  });

  initialize();
})();
