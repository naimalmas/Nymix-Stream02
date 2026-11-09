(() => {
  const WATCHLIST_KEY = 'nymix-cinema-watchlist-v1';
  const colors = [
    'radial-gradient(ellipse at 70% 27%,#e0ad7b 0 4%,transparent 5%),radial-gradient(ellipse at 70% 51%,#e36e68 0 13%,transparent 14%),linear-gradient(145deg,#58364a,#a95565 57%,#271c31)',
    'radial-gradient(ellipse at 35% 36%,#f5c586 0 5%,transparent 6%),linear-gradient(160deg,#1d4860,#39898a 46%,#14232e)',
    'radial-gradient(ellipse at 63% 34%,#f7d8a9 0 6%,transparent 7%),linear-gradient(150deg,#734b31,#d29153 48%,#362b39)',
    'radial-gradient(ellipse at 48% 32%,#e99872 0 7%,transparent 8%),linear-gradient(150deg,#313e67,#6e5f91 48%,#241a35)',
    'radial-gradient(ellipse at 67% 28%,#ddc796 0 6%,transparent 7%),linear-gradient(150deg,#1d4540,#427761 48%,#142821)',
    'radial-gradient(ellipse at 38% 36%,#e8c38b 0 6%,transparent 7%),linear-gradient(150deg,#573b4e,#9b5b79 52%,#241b30)',
  ];
  const samples = [
    { id: 'demo-1', title: 'শেষ বিকেলের গল্প', year: 2025, genre: 'ড্রামা', description: 'একটি ছোট শহর, পুরোনো বন্ধুত্ব আর নতুন করে শুরু করার গল্প।', demo: true },
    { id: 'demo-2', title: 'নীল দিগন্ত', year: 2024, genre: 'অ্যাডভেঞ্চার', description: 'অজানা পথের শেষে কী অপেক্ষা করছে—সেই খোঁজে এক রোমাঞ্চকর যাত্রা।', demo: true },
    { id: 'demo-3', title: 'চায়ের কাপে ঝড়', year: 2025, genre: 'কমেডি', description: 'এক কাপ চা আর একগুচ্ছ ভুল বোঝাবুঝি থেকে শুরু হওয়া মজার কাহিনি।', demo: true },
    { id: 'demo-4', title: 'নীরব সংকেত', year: 2023, genre: 'থ্রিলার', description: 'শহরের অন্ধকারে পাওয়া একটি সংকেত বদলে দেয় সবার পরিচিত জীবন।', demo: true },
    { id: 'demo-5', title: 'সবুজের দিনলিপি', year: 2024, genre: 'ডকুমেন্টারি', description: 'প্রকৃতি, মানুষ আর আমাদের আগামী দিনের জন্য একটি আশাবাদী গল্প।', demo: true },
    { id: 'demo-6', title: 'আলোর ঠিকানা', year: 2022, genre: 'ড্রামা', description: 'পরিবার আর স্বপ্নকে ঘিরে তৈরি একটি আন্তরিক গল্প।', demo: true },
  ];

  const $ = (selector) => document.querySelector(selector);
  const grid = $('#movie-grid');
  const filters = $('#genre-filters');
  const search = $('#movie-search');
  const movieDialog = $('#movie-dialog');
  let selectedGenre = 'সব';
  let watchlistOnly = false;
  let toastTimer;

  function readList(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value) ? value : fallback;
    } catch (error) {
      console.error(`Could not read ${key} from local storage.`, error);
      return fallback;
    }
  }

  let movies = samples;
  let watchlist = readList(WATCHLIST_KEY, []);

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Could not save ${key} to local storage.`, error);
      showToast('ব্রাউজারে তথ্য সংরক্ষণ করা যায়নি।');
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function renderFilters() {
    const genres = ['সব', ...new Set(movies.map(movie => movie.genre))];
    filters.innerHTML = genres.map(genre => `<button class="filter-chip${genre === selectedGenre ? ' active' : ''}" type="button" data-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`).join('');
  }

  function renderMovies() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = movies.filter(movie => {
      const matchesQuery = `${movie.title} ${movie.genre} ${movie.year}`.toLocaleLowerCase().includes(query);
      const matchesGenre = selectedGenre === 'সব' || movie.genre === selectedGenre;
      const matchesList = !watchlistOnly || watchlist.includes(movie.id);
      return matchesQuery && matchesGenre && matchesList;
    });

    $('#catalog-title').textContent = watchlistOnly ? 'আমার তালিকা' : 'জনপ্রিয় সিনেমা';
    $('#empty-state').hidden = visible.length > 0;
    grid.innerHTML = visible.map(movie => {
      const index = Math.max(0, movies.indexOf(movie)) % colors.length;
      return `<article class="movie-card">
        <button class="movie-open" type="button" data-movie="${escapeHtml(movie.id)}" style="--poster:${colors[index]}" aria-label="${escapeHtml(movie.title)} - বিস্তারিত দেখুন">
          <span class="card-play" aria-hidden="true">▶</span>
          <span class="poster-copy"><small>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</small><strong>${escapeHtml(movie.title)}</strong></span>
        </button>
        <div class="movie-meta"><div><h3>${escapeHtml(movie.title)}</h3><p>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</p></div><span class="rating">${movie.demo ? 'DEMO' : 'HD'}</span></div>
      </article>`;
    }).join('');
    $('#watchlist-count').textContent = String(watchlist.length);
  }

  async function loadMovies() {
    try {
      const response = await fetch('/api/movies');
      if (!response.ok) throw new Error(`Movie catalog request failed (${response.status})`);
      const catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Movie catalog response is invalid');
      movies = [...samples, ...catalog];
      renderFilters();
      renderMovies();
    } catch (error) {
      console.error('Could not load the movie catalog.', error);
      showToast('ক্যাটালগ লোড করা যায়নি।');
    }
  }

  function showMovie(movie) {
    const inList = watchlist.includes(movie.id);
    const video = movie.embedUrl
      ? `<iframe class="detail-video" src="${escapeHtml(movie.embedUrl)}" title="${escapeHtml(movie.title)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `<div class="video-placeholder"><div><span>▶</span><br />এটি একটি নমুনা শিরোনাম। দেখার জন্য আপনার অনুমোদিত Bunny Stream ভিডিও যোগ করুন।</div></div>`;
    $('#movie-detail').innerHTML = `<div class="detail-content">
      <p class="eyebrow">${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}${movie.demo ? ' · DEMO' : ''}</p>
      <h2 id="dialog-title">${escapeHtml(movie.title)}</h2>
      <p>${escapeHtml(movie.description || 'আপনার নিজের ক্যাটালগের একটি সিনেমা।')}</p>
      ${video}
      <div class="detail-actions">
        <button class="button button-quiet" id="toggle-watchlist" type="button">${inList ? '✓ তালিকা থেকে সরান' : '＋ আমার তালিকায় রাখুন'}</button>
      </div>
    </div>`;
    $('#toggle-watchlist').addEventListener('click', () => {
      const next = inList ? watchlist.filter(id => id !== movie.id) : [...watchlist, movie.id];
      if (!save(WATCHLIST_KEY, next)) return;
      watchlist = next;
      showMovie(movie);
      renderMovies();
      showToast(inList ? 'আমার তালিকা থেকে সরানো হয়েছে।' : 'আমার তালিকায় যোগ হয়েছে।');
    });
    movieDialog.showModal();
  }

  filters.addEventListener('click', event => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    selectedGenre = button.dataset.genre;
    watchlistOnly = false;
    renderFilters();
    renderMovies();
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-movie]');
    if (!button) return;
    const movie = movies.find(item => item.id === button.dataset.movie);
    if (movie) showMovie(movie);
  });
  search.addEventListener('input', () => { watchlistOnly = false; renderMovies(); });
  $('#watchlist-nav').addEventListener('click', () => {
    watchlistOnly = !watchlistOnly;
    selectedGenre = 'সব';
    renderFilters();
    renderMovies();
    $('#catalog').scrollIntoView({ behavior: 'smooth' });
  });
  $('#dialog-close').addEventListener('click', () => movieDialog.close());
  renderFilters();
  renderMovies();
  loadMovies();
})();
