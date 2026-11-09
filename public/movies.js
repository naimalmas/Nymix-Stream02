(() => {
  const WATCHLIST_KEY = 'nymix-cinema-watchlist-v1';

  const $ = (selector) => document.querySelector(selector);
  const grid = $('#movie-grid');
  const filters = $('#genre-filters');
  const search = $('#movie-search');
  const movieDialog = $('#movie-dialog');
  const promoDialog = $('#promo-dialog');
  let selectedGenre = 'All';
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

  let movies = [];
  let watchlist = readList(WATCHLIST_KEY, []);

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Could not save ${key} to local storage.`, error);
      showToast('Could not save your list in this browser.');
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
    const genres = [...new Set(['All', ...movies.map(movie => movie.genre)])];
    filters.innerHTML = genres.map(genre => `<button class="filter-chip${genre === selectedGenre ? ' active' : ''}" type="button" data-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`).join('');
  }

  function renderMovies() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = movies.filter(movie => {
      const matchesQuery = `${movie.title} ${movie.genre} ${movie.year}`.toLocaleLowerCase().includes(query);
      const matchesGenre = selectedGenre === 'All' || movie.genre === selectedGenre;
      const matchesList = !watchlistOnly || watchlist.includes(movie.id);
      return matchesQuery && matchesGenre && matchesList;
    });

    $('#catalog-title').textContent = watchlistOnly ? 'My List' : 'Movies';
    $('#empty-state').hidden = visible.length > 0;
    $('#empty-state').textContent = visible.length || movies.length
      ? 'No movies match your search.'
      : 'No movies are available yet. Check back soon.';
    grid.innerHTML = visible.map(movie => {
      const thumbnail = movie.thumbnailData || movie.thumbnailUrl;
      const poster = thumbnail
        ? `<img class="movie-poster" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />`
        : '<span class="poster-placeholder" aria-hidden="true">N</span>';
      return `<article class="movie-card">
        <button class="movie-open" type="button" data-movie="${escapeHtml(movie.id)}" aria-label="Watch ${escapeHtml(movie.title)}">
          ${poster}<span class="poster-gradient" aria-hidden="true"></span>
          <span class="card-play" aria-hidden="true">▶</span>
          <span class="poster-copy"><small>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</small><strong>${escapeHtml(movie.title)}</strong></span>
        </button>
        <div class="movie-meta"><div><h3>${escapeHtml(movie.title)}</h3><p>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</p></div></div>
      </article>`;
    }).join('');
    $('#watchlist-count').textContent = String(watchlist.length);
  }

  async function loadMovies() {
    $('#empty-state').hidden = true;
    grid.innerHTML = '';
    filters.innerHTML = '';
    try {
      const response = await fetch('/api/movies');
      if (!response.ok) throw new Error(`Movie catalog request failed (${response.status})`);
      const catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Movie catalog response is invalid');
      movies = catalog.filter(movie => movie && typeof movie.id === 'string' && typeof movie.title === 'string' && typeof movie.embedUrl === 'string');
      renderFeaturedMovie(movies.find(movie => movie.featured));
      watchlist = watchlist.filter(id => movies.some(movie => movie.id === id));
      save(WATCHLIST_KEY, watchlist);
      renderFilters();
      renderMovies();
    } catch (error) {
      console.error('Could not load the movie catalog.', error);
      $('#empty-state').hidden = false;
      $('#empty-state').textContent = 'Could not load movies right now. Please try again later.';
      showToast('Could not load the movie catalog.');
    }
  }

  function showMovie(movie) {
    const inList = watchlist.includes(movie.id);
    const thumbnail = movie.thumbnailData || movie.thumbnailUrl;
    const video = movie.embedUrl
      ? `<section class="player-shell" id="player-shell" aria-label="Movie player">
          <div class="player-toolbar"><span class="player-brand"><i></i> NYMIX CINEMA</span><button class="fullscreen-button" id="fullscreen-player" type="button" aria-label="Enter fullscreen">⛶</button></div>
          <iframe class="detail-video" src="${escapeHtml(movie.embedUrl)}" title="${escapeHtml(movie.title)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="eager" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="player-footer"><span>${escapeHtml(movie.title)}</span><span>Now playing</span></div>
        </section>`
      : `<div class="video-placeholder"><div><span>▶</span><br />This movie is not available to play yet.</div></div>`;
    $('#movie-detail').innerHTML = `<div class="detail-content">
      ${video}
      <div class="detail-heading"><div><p class="eyebrow">${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</p><h2 id="dialog-title">${escapeHtml(movie.title)}</h2><p>${escapeHtml(movie.description || '')}</p></div>
        ${thumbnail ? `<img class="detail-poster" src="${escapeHtml(thumbnail)}" alt="${escapeHtml(movie.title)} poster" />` : ''}
      </div>
      <div class="detail-actions">
        <button class="button button-quiet" id="toggle-watchlist" type="button">${inList ? '✓ Remove from My List' : '＋ Add to My List'}</button>
      </div>
    </div>`;
    $('#fullscreen-player')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await $('#player-shell').requestFullscreen();
      } catch (error) {
        console.error('Could not enter fullscreen playback.', error);
        showToast('Fullscreen is not available in this browser.');
      }
    });
    $('#toggle-watchlist').addEventListener('click', () => {
      const next = inList ? watchlist.filter(id => id !== movie.id) : [...watchlist, movie.id];
      if (!save(WATCHLIST_KEY, next)) return;
      watchlist = next;
      showMovie(movie);
      renderMovies();
      showToast(inList ? 'Removed from My List.' : 'Added to My List.');
    });
    movieDialog.showModal();
  }

  function renderFeaturedMovie(movie) {
    const hero = $('#hero-art');
    const image = $('#hero-promo-image');
    const watchButton = $('#hero-watch-promo');
    if (!movie) {
      hero.classList.remove('has-promo');
      image.removeAttribute('src');
      watchButton.hidden = true;
      return;
    }
    $('#hero-label').textContent = 'NOW FEATURING';
    $('#hero-title').textContent = movie.title;
    $('#hero-description').textContent = movie.description || `${movie.genre} · ${movie.year}`;
    $('#hero-note').textContent = `${movie.genre} · ${movie.year}`;
    $('#hero-promo-caption').textContent = movie.title;
    $('#hero-promo-caption').hidden = false;
    const thumbnail = movie.thumbnailData || movie.thumbnailUrl || '';
    image.src = thumbnail;
    hero.classList.add('has-promo');
    hero.classList.toggle('has-promo-image', Boolean(thumbnail));
    watchButton.hidden = false;
    if (movie.promoEmbedUrl) {
      watchButton.innerHTML = '<span aria-hidden="true">▶</span> Watch trailer';
      watchButton.onclick = () => {
        $('#promo-player').innerHTML = `<iframe class="promo-video" src="${escapeHtml(movie.promoEmbedUrl)}" title="${escapeHtml(`${movie.title} trailer`)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        promoDialog.showModal();
      };
    } else {
      watchButton.innerHTML = '<span aria-hidden="true">▶</span> Watch movie';
      watchButton.onclick = () => showMovie(movie);
    }
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
    selectedGenre = 'All';
    renderFilters();
    renderMovies();
    $('#catalog').scrollIntoView({ behavior: 'smooth' });
  });
  $('#dialog-close').addEventListener('click', () => movieDialog.close());
  movieDialog.addEventListener('close', () => { $('#movie-detail').replaceChildren(); });
  $('#promo-close').addEventListener('click', () => promoDialog.close());
  promoDialog.addEventListener('close', () => { $('#promo-player').replaceChildren(); });
  document.addEventListener('fullscreenchange', () => {
    const fullscreenButton = $('#fullscreen-player');
    if (fullscreenButton) fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  });
  loadMovies();
})();
