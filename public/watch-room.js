(() => {
  const $ = selector => document.querySelector(selector);
  const accountToken = () => localStorage.getItem('nx_token');
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase();
  const inviteToken = params.get('invite') || '';
  const loginUrl = () => `/login.html?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  let guestSessionToken = sessionStorage.getItem(`nx_watch_guest_${code}`) || '';
  const token = () => accountToken() || guestSessionToken;
  const readUser = () => {
    try { return JSON.parse(localStorage.getItem('nx_user') || 'null'); }
    catch (error) {
      console.error('Could not read the signed-in user.', error);
      return null;
    }
  };
  let user = readUser();
  const peers = new Map();
  const callPeers = new Map();
  const callPeerPromises = new Map();
  const callTracks = { audio: null, video: null };
  const seenSignals = new Set();
  let room;
  let localStream = null;
  let localCallStream = new MediaStream();
  let callMemberSignature = '';
  let renderedCallSignature = '';
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
    const currentToken = token();
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
    });
    const result = await response.json();
    if (response.status === 401) {
      if (guestSessionToken) {
        sessionStorage.removeItem(`nx_watch_guest_${code}`);
        guestSessionToken = '';
      } else if (accountToken()) {
        localStorage.removeItem('nx_token');
        localStorage.removeItem('nx_user');
        window.location.replace(loginUrl());
      }
      throw new Error(result.error || 'Your room session has expired.');
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
    setupVideoOverlay($('#remote-video'));
    $('#playback-status').textContent = source.type === 'screen' ? 'The host is sharing a browser tab or screen' : 'The host is playing a local video';
    const video = $('#remote-video');
    if (room.hostId === user?.id && localStream) {
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
    const previousMembers = callMemberSignature;
    room = nextRoom;
    $('#room-code').textContent = `PRIVATE ROOM · ${room.code}`;
    $('#account-name').textContent = user?.name || '';
    $('#end-room').hidden = room.hostId !== user?.id;
    $('#leave-room').hidden = room.hostId === user?.id;
    $('#source-panel').hidden = room.hostId !== user?.id;
    $('#copy-invite').hidden = Boolean(user?.guest);
    $('#member-list').innerHTML = room.members.map(member =>
      `<span class="member-chip">${escapeHtml(member.name)}${member.id === room.hostId ? ' · host' : member.guest ? ' · guest' : ''}</span>`,
    ).join('');
    if (room.sourceUpdatedAt !== sourceUpdatedAt) {
      sourceUpdatedAt = room.sourceUpdatedAt;
      renderSource(room.source);
    }
    const nextMembers = room.members.map(member => member.id).sort().join('|');
    if (nextMembers !== previousMembers) {
      callMemberSignature = nextMembers;
      renderCallTiles(true);
      syncCallConnections().catch(error => {
        console.error('Could not connect room voice and video.', error);
        showToast('Could not connect voice and video. Please try again.');
      });
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
    if (room.hostId === user?.id) {
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

  async function sendSignal(to, type, payload = {}, channel = 'media') {
    await api(`/api/watch-rooms/${encodeURIComponent(code)}/signals`, {
      method: 'POST',
      body: JSON.stringify({ to, type, channel, ...payload }),
    });
  }

  async function createPeer(peerId, initiator) {
    if (peers.has(peerId)) return peers.get(peerId);
    const connection = new RTCPeerConnection({ iceServers: await loadIceServers() });
    const peer = { connection, remoteStream: new MediaStream(), candidates: [] };
    peers.set(peerId, peer);
    if (room.hostId === user?.id && localStream) {
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

  function renderCallTiles(force = false) {
    if (!room) return;
    const members = room.members;
    const signature = [
      members.map(member => member.id).sort().join('|'),
      ...[...callPeers.entries()].map(([id, peer]) =>
        `${id}:${peer.connection.connectionState}:${peer.remoteStream.getTracks().map(track => `${track.id}-${track.readyState}-${track.enabled}`).join(',')}`,
      ),
      ...Object.entries(callTracks).map(([kind, track]) => `${kind}:${track?.readyState}:${track?.enabled}`),
    ].join(';');
    if (!force && signature === renderedCallSignature) return;
    renderedCallSignature = signature;

    const localVideoOn = callTracks.video?.readyState === 'live' && callTracks.video.enabled;
    const localAudioOn = callTracks.audio?.readyState === 'live' && callTracks.audio.enabled;
    const localInitial = escapeHtml((user?.name || 'You').slice(0, 1).toUpperCase());
    const tiles = [`<article class="call-tile" data-local-tile>
      <video autoplay playsinline muted${localVideoOn ? '' : ' hidden'}></video>
      <span class="call-avatar"${localVideoOn ? ' hidden' : ''}>${localInitial}</span>
      <span class="call-tile-caption">You · mic ${localAudioOn ? 'on' : 'off'}${localVideoOn ? ' · camera on' : ''}</span>
    </article>`];

    for (const member of members) {
      if (member.id === user?.id) continue;
      const peer = callPeers.get(member.id);
      const remote = peer?.remoteStream;
      const videoOn = remote?.getVideoTracks().some(track => track.readyState === 'live');
      const audioOn = remote?.getAudioTracks().some(track => track.readyState === 'live');
      tiles.push(`<article class="call-tile" data-peer-id="${escapeHtml(member.id)}">
        <video autoplay playsinline muted${videoOn ? '' : ' hidden'}></video>
        <audio autoplay></audio>
        <span class="call-avatar"${videoOn ? ' hidden' : ''}>${escapeHtml((member.name || '?').slice(0, 1).toUpperCase())}</span>
        <span class="call-tile-caption">${escapeHtml(member.name)} · ${audioOn ? 'mic on' : 'not on call'}${videoOn ? ' · camera on' : ''}</span>
      </article>`);
    }

    const grid = $('#call-grid');
    grid.innerHTML = tiles.join('');
    const localVideo = grid.querySelector('[data-local-tile] video');
    if (localVideoOn && localVideo) {
      localVideo.srcObject = localCallStream;
      localVideo.play().catch(error => console.warn('Local camera preview awaits a play gesture.', error));
    }
    for (const tile of grid.querySelectorAll('[data-peer-id]')) {
      const peer = callPeers.get(tile.dataset.peerId);
      if (!peer) continue;
      const video = tile.querySelector('video');
      const audio = tile.querySelector('audio');
      if (video) {
        video.srcObject = peer.remoteStream;
        video.play().catch(error => console.warn('Remote camera awaits a play gesture.', error));
      }
      if (audio) {
        audio.srcObject = peer.remoteStream;
        audio.play().catch(error => console.warn('Remote audio awaits a play gesture.', error));
      }
    }
  }

  function updateCallControls() {
    const micOn = callTracks.audio?.readyState === 'live' && callTracks.audio.enabled;
    const cameraOn = callTracks.video?.readyState === 'live' && callTracks.video.enabled;
    const micButton = $('#toggle-mic');
    const cameraButton = $('#toggle-camera');
    micButton.textContent = micOn ? 'Turn mic off' : 'Turn mic on';
    micButton.setAttribute('aria-pressed', String(micOn));
    cameraButton.textContent = cameraOn ? 'Turn camera off' : 'Turn camera on';
    cameraButton.setAttribute('aria-pressed', String(cameraOn));
    $('#call-status').textContent = micOn || cameraOn
      ? `${micOn ? 'Mic on' : 'Mic off'} · ${cameraOn ? 'Camera on' : 'Camera off'}`
      : 'Your mic and camera start off. Turn on either when you are ready.';
  }

  async function createCallPeer(peerId, initiator) {
    if (callPeers.has(peerId)) return callPeers.get(peerId);
    if (callPeerPromises.has(peerId)) return callPeerPromises.get(peerId);
    const creation = (async () => {
      const connection = new RTCPeerConnection({ iceServers: await loadIceServers() });
      const peer = {
        connection,
        remoteStream: new MediaStream(),
        candidates: [],
        audioSender: connection.addTransceiver('audio', { direction: 'sendrecv' }).sender,
        videoSender: connection.addTransceiver('video', { direction: 'sendrecv' }).sender,
      };
      callPeers.set(peerId, peer);
      if (callTracks.audio) await peer.audioSender.replaceTrack(callTracks.audio);
      if (callTracks.video) await peer.videoSender.replaceTrack(callTracks.video);
      connection.onicecandidate = event => {
        sendSignal(peerId, 'ice', { candidate: event.candidate ? event.candidate.toJSON() : null }, 'call')
          .catch(error => console.error('Could not send voice/video connection candidate.', error));
      };
      connection.ontrack = event => {
        const stream = event.streams[0];
        if (stream) peer.remoteStream = stream;
        else if (!peer.remoteStream.getTracks().some(track => track.id === event.track.id)) peer.remoteStream.addTrack(event.track);
        renderCallTiles(true);
      };
      connection.onconnectionstatechange = () => {
        renderCallTiles(true);
        if (connection.connectionState === 'failed') {
          showToast('Could not connect voice/video. Your network may require a TURN relay.');
        }
        if (connection.connectionState === 'closed') callPeers.delete(peerId);
      };
      if (initiator) {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        await sendSignal(peerId, 'offer', { description: connection.localDescription }, 'call');
      }
      return peer;
    })();
    callPeerPromises.set(peerId, creation);
    try { return await creation; }
    finally { callPeerPromises.delete(peerId); }
  }

  async function syncCallConnections() {
    if (!room || !Object.values(callTracks).some(track => track?.readyState === 'live' && track.enabled)) return;
    for (const member of room.members) {
      if (member.id === user?.id || callPeers.has(member.id)) continue;
      const initiator = String(user?.id) < String(member.id);
      try { await createCallPeer(member.id, initiator); }
      catch (error) {
        console.error(`Could not connect voice/video to ${member.name}.`, error);
        showToast(`Could not connect voice/video to ${member.name}.`);
      }
    }
    renderCallTiles();
  }

  async function handleCallSignal(signal) {
    if (seenSignals.has(signal.id)) return;
    seenSignals.add(signal.id);
    if (seenSignals.size > 1000) seenSignals.clear();
    const peer = await createCallPeer(signal.from, false);
    const connection = peer.connection;
    if (signal.type === 'offer') {
      await connection.setRemoteDescription(signal.description);
      for (const candidate of peer.candidates.splice(0)) await connection.addIceCandidate(candidate);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await sendSignal(signal.from, 'answer', { description: connection.localDescription }, 'call');
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

  async function toggleCallTrack(kind) {
    const currentTrack = callTracks[kind];
    if (currentTrack?.readyState === 'live') {
      callTracks[kind] = null;
      localCallStream.removeTrack(currentTrack);
      currentTrack.stop();
      const senderKey = kind === 'audio' ? 'audioSender' : 'videoSender';
      await Promise.all([...callPeers.values()].map(peer => peer[senderKey].replaceTrack(null)));
      updateCallControls();
      renderCallTiles(true);
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone and camera access requires HTTPS or a supported browser on localhost.');
      }
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio'
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
        : { audio: false, video: true });
      const track = stream.getTracks()[0];
      if (!track) throw new Error(`Could not start the ${kind === 'audio' ? 'microphone' : 'camera'}.`);
      callTracks[kind] = track;
      localCallStream.addTrack(track);
      track.addEventListener('ended', () => {
        if (callTracks[kind] !== track) return;
        callTracks[kind] = null;
        localCallStream.removeTrack(track);
        const senderKey = kind === 'audio' ? 'audioSender' : 'videoSender';
        Promise.all([...callPeers.values()].map(peer => peer[senderKey].replaceTrack(null)))
          .catch(error => console.error(`Could not stop sending the ${kind} track.`, error));
        updateCallControls();
        renderCallTiles(true);
      }, { once: true });
      await syncCallConnections();
      const senderKey = kind === 'audio' ? 'audioSender' : 'videoSender';
      await Promise.all([...callPeers.values()].map(peer => peer[senderKey].replaceTrack(track)));
      updateCallControls();
      renderCallTiles(true);
    } catch (error) {
      console.error(`Could not turn on the ${kind === 'audio' ? 'microphone' : 'camera'}.`, error);
      showToast(error.message || `Could not turn on the ${kind === 'audio' ? 'microphone' : 'camera'}. Check browser permissions.`);
    }
  }

  async function syncPeerConnections() {
    if (room.hostId !== user?.id || !localStream) return;
    for (const member of room.members) {
      if (member.id === user?.id || peers.has(member.id)) continue;
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
        try {
          if (signal.channel === 'call') await handleCallSignal(signal);
          else await handleSignal(signal);
        }
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
    list.innerHTML = messages.map(message => `<article class="chat-message${message.userId === user?.id ? ' mine' : ''}">
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

  function showGuestJoin(message = '') {
    $('#guest-join-shell').hidden = false;
    $('#room-shell').hidden = true;
    $('#guest-join-error').textContent = message;
    $('#guest-join-submit').disabled = !inviteToken;
  }

  async function enterRoom(guestName = '') {
    const body = {};
    if (inviteToken) body.inviteToken = inviteToken;
    if (guestName) body.name = guestName;
    room = await api(`/api/watch-rooms/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (room.guestSessionToken) {
      guestSessionToken = room.guestSessionToken;
      sessionStorage.setItem(`nx_watch_guest_${code}`, guestSessionToken);
      const guest = room.members.find(member => member.id === room.guestId);
      if (!guest) throw new Error('Could not identify your guest session.');
      user = { ...guest, guest: true };
      history.replaceState(null, '', `/watch-room.html?code=${encodeURIComponent(code)}`);
    } else {
      user = readUser();
    }

    $('#guest-join-shell').hidden = true;
    $('#room-shell').hidden = false;
    sourceUpdatedAt = room.sourceUpdatedAt;
    renderRoom(room);
    $('#room-code').textContent = `PRIVATE ROOM · ${room.code}`;
    await refreshRoom();
    await refreshChat();
    if (room.hostId === user?.id) {
      sourceInputChanged();
      $('#host-tools').hidden = false;
      $('#end-room').hidden = false;
      $('#source-panel').hidden = false;
    }
    roomTimer = setInterval(refreshRoom, 2500);
    chatTimer = setInterval(refreshChat, 2200);
    signalTimer = setInterval(pollSignals, 1400);
    pollSignals();
  }

  async function initialize() {
    if (!/^[A-F0-9]{8}$/.test(code)) {
      window.location.replace('/movies.html');
      return;
    }
    if (!token()) {
      showGuestJoin(inviteToken ? '' : 'Open an active invite link from the room host.');
      return;
    }
    try {
      await enterRoom();
    } catch (error) {
      console.error('Could not join private watch room.', error);
      if (!accountToken()) {
        showGuestJoin(error.message || 'Could not join the room.');
        return;
      }
      showToast(error.message || 'Could not join the room.');
      setTimeout(() => window.location.replace('/movies.html'), 2200);
    }
  }

  $('#guest-join-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#guest-name').value.trim();
    if (!name || name.length > 32) {
      $('#guest-join-error').textContent = 'Enter a name of up to 32 characters.';
      return;
    }
    const submit = $('#guest-join-submit');
    submit.disabled = true;
    $('#guest-join-error').textContent = '';
    try {
      await enterRoom(name);
    } catch (error) {
      console.error('Could not join as a guest.', error);
      $('#guest-join-error').textContent = error.message || 'Could not join the room.';
      submit.disabled = !inviteToken;
    }
  });

  $('#source-type').addEventListener('change', sourceInputChanged);
  $('#toggle-mic').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await toggleCallTrack('audio'); }
    finally { button.disabled = false; }
  });
  $('#toggle-camera').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await toggleCallTrack('video'); }
    finally { button.disabled = false; }
  });
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
      const { inviteToken: shareToken } = await api(`/api/watch-rooms/${encodeURIComponent(code)}/invite-link`, {
        method: 'POST',
        body: '{}',
      });
      const invite = new URLSearchParams({ code, invite: shareToken });
      await navigator.clipboard.writeText(`${location.origin}/watch-room.html?${invite.toString()}`);
      showToast('Invite link copied. Anyone with this link can join while the room is active.');
    } catch (error) {
      console.error('Could not copy room invite link.', error);
      showToast('Could not copy the invite link in this browser.');
    }
  });

  async function leaveRoom(endRoom = false) {
    if (endRoom && !window.confirm('End this room for everyone?')) return;
    try {
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      Object.values(callTracks).forEach(track => track?.stop());
      peers.forEach(peer => peer.connection.close());
      callPeers.forEach(peer => peer.connection.close());
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
    Object.values(callTracks).forEach(track => track?.stop());
    peers.forEach(peer => peer.connection.close());
    callPeers.forEach(peer => peer.connection.close());
  });

  // ── Video Player Controls ───────────────────────
  function getActiveVideo() {
    return $('#remote-video') || $('#local-video');
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function toggleFullscreen() {
    const stage = $('#watch-stage');
    try {
      if (!document.fullscreenElement) {
        await stage.requestFullscreen();
        $('#fullscreen-btn').textContent = '✕';
        $('#fullscreen-btn').title = 'Exit Fullscreen (F)';
      } else {
        await document.exitFullscreen();
        $('#fullscreen-btn').textContent = '⛶';
        $('#fullscreen-btn').title = 'Fullscreen (F)';
      }
    } catch (error) {
      console.warn('Fullscreen not available.', error);
      showToast('Fullscreen is not available in this browser.');
    }
  }

  async function togglePiP() {
    try {
      const video = getActiveVideo();
      if (!video) return;
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.warn('Picture-in-Picture not available.', error);
      showToast('Picture-in-Picture is not supported by this browser.');
    }
  }

  let controlsHideTimer;
  function setupVideoOverlay(video) {
    // Remove any old overlay
    $('#video-controls-overlay')?.remove();
    $('#video-progress-wrap')?.remove();
    $('#play-pause-center')?.remove();

    if (!video || !(video instanceof HTMLVideoElement)) return;

    const stage = $('#watch-stage');

    // Show PiP button if supported
    const pipBtn = $('#pip-btn');
    if (pipBtn) pipBtn.hidden = !document.pictureInPictureEnabled;

    // Play/Pause center button
    const playCenter = document.createElement('button');
    playCenter.className = 'play-pause-center';
    playCenter.id = 'play-pause-center';
    playCenter.setAttribute('aria-label', 'Play / Pause');
    playCenter.textContent = video.paused ? '▶' : '⏸';
    stage.appendChild(playCenter);

    // Progress bar
    const progressWrap = document.createElement('div');
    progressWrap.className = 'video-progress-wrap';
    progressWrap.id = 'video-progress-wrap';
    progressWrap.innerHTML = `<input class="video-progress" id="video-progress" type="range" min="0" max="100" value="0" step="0.1" aria-label="Video progress" />`;
    stage.appendChild(progressWrap);

    // Controls overlay
    const overlay = document.createElement('div');
    overlay.className = 'video-controls-overlay';
    overlay.id = 'video-controls-overlay';
    overlay.innerHTML = `
      <div class="video-controls-row">
        <button class="video-ctrl-btn" id="vc-playpause" aria-label="Play/Pause">▶</button>
        <span class="video-time" id="vc-time">0:00 / 0:00</span>
        <div style="flex:1"></div>
        <div class="video-volume">
          <button class="video-ctrl-btn" id="vc-mute" aria-label="Mute">🔊</button>
          <input class="video-volume-slider" id="vc-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
        </div>
      </div>`;
    stage.appendChild(overlay);

    function updatePlayState() {
      const paused = video.paused;
      if ($('#play-pause-center')) $('#play-pause-center').textContent = paused ? '▶' : '⏸';
      if ($('#vc-playpause')) $('#vc-playpause').textContent = paused ? '▶' : '⏸';
    }

    function updateTime() {
      const dur = video.duration;
      const cur = video.currentTime;
      if ($('#vc-time')) $('#vc-time').textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      const progress = $('#video-progress');
      if (progress && Number.isFinite(dur) && dur > 0) {
        progress.value = (cur / dur) * 100;
      }
    }

    function updateMute() {
      if ($('#vc-mute')) $('#vc-mute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
    }

    video.addEventListener('play', updatePlayState);
    video.addEventListener('pause', updatePlayState);
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('durationchange', updateTime);
    video.addEventListener('volumechange', updateMute);

    updatePlayState();
    updateTime();
    updateMute();

    // Auto-hide controls
    function showControls() {
      overlay.classList.add('visible');
      progressWrap.style.opacity = '1';
      progressWrap.style.pointerEvents = 'auto';
      clearTimeout(controlsHideTimer);
      controlsHideTimer = setTimeout(() => {
        overlay.classList.remove('visible');
        progressWrap.style.opacity = '0';
        progressWrap.style.pointerEvents = 'none';
      }, 3000);
    }

    stage.addEventListener('mousemove', showControls);
    stage.addEventListener('touchstart', showControls, { passive: true });

    // Click events
    playCenter.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    $('#vc-playpause')?.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    $('#vc-mute')?.addEventListener('click', () => {
      video.muted = !video.muted;
    });

    $('#vc-volume')?.addEventListener('input', e => {
      video.volume = Number(e.target.value);
      video.muted = video.volume === 0;
    });

    $('#video-progress')?.addEventListener('input', e => {
      if (Number.isFinite(video.duration)) {
        video.currentTime = (Number(e.target.value) / 100) * video.duration;
      }
    });
  }

  // Fullscreen button
  $('#fullscreen-btn').addEventListener('click', toggleFullscreen);
  $('#pip-btn').addEventListener('click', togglePiP);

  // Double-click stage to fullscreen
  $('#watch-stage').addEventListener('dblclick', event => {
    if (event.target.closest('button, input, select, a, iframe')) return;
    toggleFullscreen();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    }
    if (event.key === 'm' || event.key === 'M') {
      const video = getActiveVideo();
      if (video) { video.muted = !video.muted; showToast(video.muted ? 'Muted' : 'Unmuted'); }
    }
    if (event.key === ' ') {
      const video = getActiveVideo();
      if (video) {
        event.preventDefault();
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      }
    }
  });

  // Update fullscreen icon on change
  document.addEventListener('fullscreenchange', () => {
    const btn = $('#fullscreen-btn');
    if (!btn) return;
    btn.textContent = document.fullscreenElement ? '✕' : '⛶';
    btn.title = document.fullscreenElement ? 'Exit Fullscreen (F)' : 'Fullscreen (F)';
  });
  initialize();
})();
