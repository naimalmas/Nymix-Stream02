(() => {
  const token = () => localStorage.getItem('nx_token');
  const $ = selector => document.querySelector(selector);
  const form = $('#movie-form');
  const list = $('#movie-list');
  let movies = [];
  let editingMovieId = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function showFormMessage(message, success = false) {
    const element = $('#form-message');
    element.textContent = message;
    element.classList.toggle('success', success);
    element.hidden = false;
  }

  async function authorizedFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token()}`,
        ...options.headers,
      },
    });
    if (response.status === 401) {
      localStorage.removeItem('nx_token');
      localStorage.removeItem('nx_user');
      window.location.replace('/login.html?next=movies');
      throw new Error('Your session expired. Please sign in again.');
    }
    if (response.status === 403) {
      window.location.replace('/movies.html');
      throw new Error('You do not have permission to access this dashboard.');
    }
    return response;
  }

  async function loadMovies() {
    const message = $('#list-message');
    message.hidden = false;
    message.textContent = 'Loading catalog…';
    try {
      const response = await authorizedFetch('/api/movies');
      if (!response.ok) throw new Error('Could not load the movie catalog.');
      movies = await response.json();
      if (!Array.isArray(movies)) throw new Error('The server returned an invalid movie catalog.');
      renderMovies();
    } catch (error) {
      console.error('Could not load movie catalog.', error);
      message.textContent = error.message || 'Could not load the movie catalog.';
    }
  }

  function renderMovies() {
    $('#movie-count').textContent = String(movies.length);
    $('#list-message').hidden = movies.length > 0;
    $('#list-message').textContent = 'No movies have been added yet.';
    list.innerHTML = movies.map(movie => `<article class="movie-row">
      ${(movie.thumbnailData || movie.thumbnailUrl) ? `<img class="movie-art" src="${escapeHtml(movie.thumbnailData || movie.thumbnailUrl)}" alt="" loading="lazy" />` : '<div class="movie-art" aria-hidden="true">N</div>'}
      <div class="movie-details"><strong>${escapeHtml(movie.title)}${movie.featured ? ' <span class="featured-badge">FEATURED</span>' : ''}</strong><span>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</span></div>
      ${movie.promoEmbedUrl ? `<button class="feature-button" type="button" data-feature="${escapeHtml(movie.id)}" data-featured="${movie.featured ? 'true' : 'false'}">${movie.featured ? 'Remove promo' : 'Feature on home'}</button>` : ''}
      <button class="edit-button" type="button" data-edit="${escapeHtml(movie.id)}">Edit</button>
      <button class="delete-button" type="button" data-delete="${escapeHtml(movie.id)}" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>
    </article>`).join('');
  }

  function getEmbedIds(embedUrl) {
    try {
      const url = new URL(embedUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname !== 'iframe.mediadelivery.net' || parts.length < 3 || parts[0] !== 'embed') return ['', ''];
      return [decodeURIComponent(parts[1]), decodeURIComponent(parts[2])];
    } catch (error) {
      console.error('Could not read the saved Bunny Stream video IDs.', error);
      return ['', ''];
    }
  }

  function setEditingMovie(movie) {
    editingMovieId = movie.id;
    const [libraryId, videoId] = getEmbedIds(movie.embedUrl);
    const [promoLibraryId, promoVideoId] = movie.promoEmbedUrl
      ? getEmbedIds(movie.promoEmbedUrl)
      : ['', ''];
    form.elements.title.value = movie.title;
    form.elements.year.value = movie.year;
    form.elements.genre.value = movie.genre;
    form.elements.description.value = movie.description || '';
    form.elements.libraryId.value = libraryId;
    form.elements.videoId.value = videoId;
    form.elements.promoLibraryId.value = promoLibraryId;
    form.elements.promoVideoId.value = promoVideoId;
    form.elements.featured.checked = movie.featured === true;
    form.elements.thumbnailFile.required = false;
    form.elements.licensed.required = false;
    $('#license-consent').hidden = true;
    $('#thumbnail-preview').src = movie.thumbnailData || movie.thumbnailUrl || '';
    $('#thumbnail-preview').hidden = !$('#thumbnail-preview').src;
    $('#thumbnail-note').textContent = 'Choose a new JPG, PNG, or WebP image to replace the current thumbnail, or leave empty to keep it.';
    $('#form-eyebrow').textContent = 'EDIT CONTENT';
    $('#form-title').textContent = 'Edit movie';
    form.querySelector('[type=submit]').innerHTML = 'Save changes';
    $('#cancel-edit').hidden = false;
    $('#form-message').hidden = true;
    $('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetMovieForm() {
    editingMovieId = null;
    form.reset();
    form.elements.thumbnailFile.required = false;
    form.elements.licensed.required = true;
    $('#license-consent').hidden = false;
    $('#thumbnail-preview').hidden = true;
    $('#thumbnail-preview').removeAttribute('src');
    $('#thumbnail-note').textContent = 'Choose a JPG, PNG, or WebP image from your device. It will be resized before saving.';
    $('#form-eyebrow').textContent = 'NEW CONTENT';
    $('#form-title').textContent = 'Add a movie';
    form.querySelector('[type=submit]').innerHTML = '<span aria-hidden="true">＋</span> Publish movie';
    $('#cancel-edit').hidden = true;
    $('#form-message').hidden = true;
  }

  async function checkAdmin() {
    if (!token()) {
      window.location.replace('/login.html?next=movies');
      return;
    }
    try {
      const response = await authorizedFetch('/api/auth/me');
      if (!response.ok) throw new Error('Could not verify your account.');
      const account = await response.json();
      if (!['admin', 'super_admin'].includes(account.role)) {
        window.location.replace('/movies.html');
        return;
      }
      $('#admin-name').textContent = account.name || 'Admin';
      await loadMovies();
    } catch (error) {
      console.error('Could not verify movie dashboard access.', error);
      if (error instanceof TypeError) {
        $('#list-message').textContent = 'Could not connect to the server.';
      }
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const libraryId = String(data.get('libraryId')).trim();
    const videoId = String(data.get('videoId')).trim();
    const promoLibraryId = String(data.get('promoLibraryId')).trim();
    const promoVideoId = String(data.get('promoVideoId')).trim();
    const thumbnailFile = data.get('thumbnailFile');
    let thumbnailData = '';
    if (!/^[A-Za-z0-9_-]+$/.test(libraryId) || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
      showFormMessage('Library ID and Video ID can only contain letters, numbers, underscores, and hyphens.');
      return;
    }
    const hasThumbnailFile = thumbnailFile instanceof File && thumbnailFile.size > 0;
    if (!hasThumbnailFile && !editingMovieId) {
      showFormMessage('Choose a JPG, PNG, or WebP thumbnail image.');
      return;
    }
    if (hasThumbnailFile && !['image/jpeg', 'image/png', 'image/webp'].includes(thumbnailFile.type)) {
      showFormMessage('Choose a JPG, PNG, or WebP thumbnail image.');
      return;
    }
    if (hasThumbnailFile && thumbnailFile.size > 10 * 1024 * 1024) {
      showFormMessage('The source thumbnail must be 10 MB or smaller.');
      return;
    }
    const featured = data.has('featured');
    if ((promoLibraryId && !promoVideoId) || (!promoLibraryId && promoVideoId) || (featured && (!promoLibraryId || !promoVideoId))) {
      showFormMessage('Enter both promo video IDs to add or feature a trailer.');
      return;
    }
    if (promoLibraryId && (!/^[A-Za-z0-9_-]+$/.test(promoLibraryId) || !/^[A-Za-z0-9_-]+$/.test(promoVideoId))) {
      showFormMessage('Promo IDs can only contain letters, numbers, underscores, and hyphens.');
      return;
    }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    $('#form-message').hidden = true;
    if (hasThumbnailFile) {
      try {
        thumbnailData = await makeThumbnail(thumbnailFile);
      } catch (error) {
        console.error('Could not process the uploaded thumbnail.', error);
        showFormMessage(error.message || 'Could not process the thumbnail image.');
        submit.disabled = false;
        return;
      }
    }
    try {
      const payload = {
        title: String(data.get('title')).trim(),
        year: Number(data.get('year')),
        genre: String(data.get('genre')),
        description: String(data.get('description')).trim(),
        libraryId,
        videoId,
        promoLibraryId,
        promoVideoId,
        featured,
      };
      if (thumbnailData) payload.thumbnailData = thumbnailData;
      const isEditing = Boolean(editingMovieId);
      const response = await authorizedFetch(
        isEditing ? `/api/admin/movies/${encodeURIComponent(editingMovieId)}` : '/api/admin/movies',
        { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || (isEditing ? 'Could not save movie changes.' : 'Could not add the movie.'));
      if (result.featured) movies = movies.map(movie => ({ ...movie, featured: false }));
      movies = isEditing
        ? movies.map(movie => movie.id === result.id ? result : movie)
        : [...movies, result];
      renderMovies();
      resetMovieForm();
      showFormMessage(isEditing ? 'Movie changes saved.' : 'Movie published to the public catalog.', true);
    } catch (error) {
      console.error(editingMovieId ? 'Could not update movie.' : 'Could not add movie.', error);
      showFormMessage(error.message || (editingMovieId ? 'Could not save movie changes.' : 'Could not publish the movie.'));
    } finally {
      submit.disabled = false;
    }
  });

  function makeThumbnail(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected thumbnail.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('The selected file is not a valid image.'));
        image.onload = () => {
          const scale = Math.min(1, 1200 / image.width, 1800 / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) return reject(new Error('Could not resize the thumbnail image.'));
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let quality = 0.84;
          const encode = () => {
            canvas.toBlob(blob => {
              if (!blob) return reject(new Error('Could not resize the thumbnail image.'));
              if (blob.size > 450 * 1024 && quality > 0.5) {
                quality -= 0.1;
                encode();
                return;
              }
              if (blob.size > 450 * 1024) return reject(new Error('Thumbnail is too large after compression. Choose a smaller image.'));
              const output = new FileReader();
              output.onerror = () => reject(new Error('Could not prepare the thumbnail image.'));
              output.onload = () => resolve(output.result);
              output.readAsDataURL(blob);
            }, 'image/jpeg', quality);
          };
          encode();
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  form.elements.thumbnailFile.addEventListener('change', event => {
    const preview = $('#thumbnail-preview');
    const file = event.currentTarget.files?.[0];
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      event.currentTarget.value = '';
      preview.hidden = true;
      showFormMessage('Choose a JPG, PNG, or WebP thumbnail image.');
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });
  $('#thumbnail-preview').addEventListener('error', event => {
    event.currentTarget.hidden = true;
  });
  $('#thumbnail-preview').addEventListener('load', event => {
    if (event.currentTarget.src.startsWith('blob:')) URL.revokeObjectURL(event.currentTarget.src);
  });

  list.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) {
      const movie = movies.find(item => item.id === editButton.dataset.edit);
      if (movie) setEditingMovie(movie);
      return;
    }
    const featureButton = event.target.closest('[data-feature]');
    if (featureButton) {
      const movie = movies.find(item => item.id === featureButton.dataset.feature);
      if (!movie) return;
      featureButton.disabled = true;
      try {
        const response = await authorizedFetch(`/api/admin/movies/${encodeURIComponent(movie.id)}/feature`, {
          method: 'PUT',
          body: JSON.stringify({ featured: featureButton.dataset.featured !== 'true' }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not update the homepage promo.');
        movies = movies.map(item => ({ ...item, featured: item.id === result.id && result.featured }));
        renderMovies();
      } catch (error) {
        console.error('Could not update homepage promo.', error);
        featureButton.disabled = false;
        showFormMessage(error.message || 'Could not update the homepage promo.');
      }
      return;
    }
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    const movie = movies.find(item => item.id === button.dataset.delete);
    if (!movie || !window.confirm(`Remove "${movie.title}" from the catalog?`)) return;
    button.disabled = true;
    try {
      const response = await authorizedFetch(`/api/admin/movies/${encodeURIComponent(movie.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove the movie.');
      movies = movies.filter(item => item.id !== movie.id);
      renderMovies();
    } catch (error) {
      console.error('Could not remove movie.', error);
      button.disabled = false;
      showFormMessage(error.message || 'Could not remove the movie.');
    }
  });

  $('#cancel-edit').addEventListener('click', resetMovieForm);
  $('#refresh').addEventListener('click', loadMovies);
  $('#logout').addEventListener('click', () => {
    localStorage.removeItem('nx_token');
    localStorage.removeItem('nx_user');
    window.location.replace('/login.html');
  });
  checkAdmin();
})();
