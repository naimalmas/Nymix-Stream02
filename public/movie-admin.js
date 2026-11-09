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
      throw new Error('আপনার লগইন শেষ হয়েছে। আবার লগইন করুন।');
    }
    if (response.status === 403) {
      window.location.replace('/movies.html');
      throw new Error('এই ড্যাশবোর্ড ব্যবহারের অনুমতি নেই।');
    }
    return response;
  }

  async function loadMovies() {
    const message = $('#list-message');
    message.hidden = false;
    message.textContent = 'ক্যাটালগ লোড হচ্ছে…';
    try {
      const response = await authorizedFetch('/api/movies');
      if (!response.ok) throw new Error('সিনেমার তালিকা লোড করা যায়নি।');
      movies = await response.json();
      if (!Array.isArray(movies)) throw new Error('সার্ভার থেকে ভুল তালিকা এসেছে।');
      renderMovies();
    } catch (error) {
      console.error('Could not load movie catalog.', error);
      message.textContent = error.message || 'সিনেমার তালিকা লোড করা যায়নি।';
    }
  }

  function renderMovies() {
    $('#movie-count').textContent = String(movies.length);
    $('#list-message').hidden = movies.length > 0;
    $('#list-message').textContent = 'এখনো কোনো সিনেমা যোগ করা হয়নি।';
    list.innerHTML = movies.map(movie => `<article class="movie-row">
      <div class="movie-art" aria-hidden="true">▶</div>
      <div class="movie-details"><strong>${escapeHtml(movie.title)}</strong><span>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</span></div>
      <button class="delete-button" type="button" data-delete="${escapeHtml(movie.id)}" aria-label="${escapeHtml(movie.title)} সরান">সরান</button>
    </article>`).join('');
  }

  async function checkAdmin() {
    if (!token()) {
      window.location.replace('/login.html?next=movies');
      return;
    }
    try {
      const response = await authorizedFetch('/api/auth/me');
      if (!response.ok) throw new Error('অ্যাকাউন্ট যাচাই করা যায়নি।');
      const account = await response.json();
      if (!['admin', 'super_admin'].includes(account.role)) {
        window.location.replace('/movies.html');
        return;
      }
      $('#admin-name').textContent = account.name || 'অ্যাডমিন';
      await loadMovies();
    } catch (error) {
      console.error('Could not verify movie dashboard access.', error);
      if (error instanceof TypeError) {
        $('#list-message').textContent = 'সার্ভারের সঙ্গে সংযোগ করা যাচ্ছে না।';
      }
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const libraryId = String(data.get('libraryId')).trim();
    const videoId = String(data.get('videoId')).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(libraryId) || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
      showFormMessage('Library ID ও Video ID-তে শুধু ইংরেজি অক্ষর, সংখ্যা, _ অথবা - ব্যবহার করুন।');
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
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'সিনেমা যোগ করা যায়নি।');
      movies = [...movies, result];
      renderMovies();
      form.reset();
      showFormMessage('সিনেমাটি পোর্টালের ক্যাটালগে যোগ হয়েছে।', true);
    } catch (error) {
      console.error('Could not add movie.', error);
      showFormMessage(error.message || 'সিনেমা যোগ করা যায়নি।');
    } finally {
      submit.disabled = false;
    }
  });

  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    const movie = movies.find(item => item.id === button.dataset.delete);
    if (!movie || !window.confirm(`"${movie.title}" ক্যাটালগ থেকে সরাবেন?`)) return;
    button.disabled = true;
    try {
      const response = await authorizedFetch(`/api/admin/movies/${encodeURIComponent(movie.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'সিনেমাটি সরানো যায়নি।');
      movies = movies.filter(item => item.id !== movie.id);
      renderMovies();
    } catch (error) {
      console.error('Could not remove movie.', error);
      button.disabled = false;
      showFormMessage(error.message || 'সিনেমাটি সরানো যায়নি।');
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
