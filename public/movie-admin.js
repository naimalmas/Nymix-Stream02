(() => {
  const token = () => localStorage.getItem('nx_token');
  const $ = selector => document.querySelector(selector);
  const form = $('#movie-form');
  const list = $('#movie-list');
  let movies = [];

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
      ${movie.thumbnailUrl ? `<img class="movie-art" src="${escapeHtml(movie.thumbnailUrl)}" alt="" loading="lazy" />` : '<div class="movie-art" aria-hidden="true">N</div>'}
      <div class="movie-details"><strong>${escapeHtml(movie.title)}</strong><span>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</span></div>
      <button class="delete-button" type="button" data-delete="${escapeHtml(movie.id)}" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>
    </article>`).join('');
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
    const thumbnailUrl = String(data.get('thumbnailUrl')).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(libraryId) || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
      showFormMessage('Library ID and Video ID can only contain letters, numbers, underscores, and hyphens.');
      return;
    }
    try {
      if (new URL(thumbnailUrl).protocol !== 'https:') throw new Error('invalid protocol');
    } catch {
      showFormMessage('Enter a valid HTTPS thumbnail image URL.');
      return;
    }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    $('#form-message').hidden = true;
    try {
      const response = await authorizedFetch('/api/admin/movies', {
        method: 'POST',
        body: JSON.stringify({
          title: String(data.get('title')).trim(),
          year: Number(data.get('year')),
          genre: String(data.get('genre')),
          description: String(data.get('description')).trim(),
          libraryId,
          videoId,
          thumbnailUrl,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add the movie.');
      movies = [...movies, result];
      renderMovies();
      form.reset();
      $('#thumbnail-preview').hidden = true;
      $('#thumbnail-preview').removeAttribute('src');
      showFormMessage('Movie published to the public catalog.', true);
    } catch (error) {
      console.error('Could not add movie.', error);
      showFormMessage(error.message || 'Could not publish the movie.');
    } finally {
      submit.disabled = false;
    }
  });

  form.elements.thumbnailUrl.addEventListener('input', event => {
    const preview = $('#thumbnail-preview');
    let url;
    try {
      url = new URL(event.currentTarget.value.trim());
      if (url.protocol !== 'https:') throw new Error('Unsupported image URL protocol');
    } catch {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    preview.src = url.toString();
    preview.hidden = false;
  });
  $('#thumbnail-preview').addEventListener('error', event => {
    event.currentTarget.hidden = true;
  });

  list.addEventListener('click', async event => {
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

  $('#refresh').addEventListener('click', loadMovies);
  $('#logout').addEventListener('click', () => {
    localStorage.removeItem('nx_token');
    localStorage.removeItem('nx_user');
    window.location.replace('/login.html');
  });
  checkAdmin();
})();
