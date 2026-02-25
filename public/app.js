const CONFIG = {
    BACKEND_URL: '/api',
    STORAGE_KEYS: {
        USERNAME: 'lastfm_username',
        USER_IMAGE: 'lastfm_user_image'
    }
};

const EDIT_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" class="icon"><use href="assets/icons/sprite.svg#icon-edit"/></svg>`;
const DONE_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" class="icon"><use href="assets/icons/sprite.svg#icon-check"/></svg>`;
const DELETE_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" class="icon"><use href="assets/icons/sprite.svg#icon-delete"/></svg>`;
const CHECKMARK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" class="icon-checkmark"><use href="assets/icons/sprite.svg#icon-check-bold"/></svg>`;

const authSection = document.getElementById('auth-section');
const scrobbleSection = document.getElementById('scrobble-section');
const headerUserInfo = document.getElementById('header-user-info');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const scrobbleForm = document.getElementById('scrobble-form');
const statusMessage = document.getElementById('status-message');
const loadingSpinnerContainer = document.getElementById('loading-spinner-container');
const usernameDisplay = document.getElementById('username-display');
const userAvatar = document.getElementById('user-avatar');

const artistInput = document.getElementById('artist');
const trackInput = document.getElementById('track');
const albumInput = document.getElementById('album');
const albumArtistInput = document.getElementById('album-artist');
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');
const trackNowBtn = document.getElementById('track-now-btn');
const vaBtn = document.getElementById('va-btn');

const modeTrackBtn = document.getElementById('mode-track');
const modeAlbumBtn = document.getElementById('mode-album');
const modeFixPastBtn = document.getElementById('mode-fix-past');
const albumScrobbleContainer = document.getElementById('album-scrobble-container');

const pinArtistBtn = document.getElementById('pin-artist');
const pinTrackBtn = document.getElementById('pin-track');
const pinAlbumBtn = document.getElementById('pin-album');
const pinAlbumArtistBtn = document.getElementById('pin-album-artist');

const fixPastSection = document.getElementById('fix-past-section');
const reloadHistoryBtn = document.getElementById('reload-history-btn');
const historyList = document.getElementById('history-list');
const filterNoAlbum = document.getElementById('filter-no-album');
const filterDuplicates = document.getElementById('filter-duplicates');

const albumSearchView = document.getElementById('album-search-view');
const albumSearchInput = document.getElementById('album-search-input');
const albumSearchBtn = document.getElementById('album-search-btn');
const albumResults = document.getElementById('album-results');

const albumVerificationView = document.getElementById('album-verification-view');
const backToSearchBtn = document.getElementById('back-to-search');
const selectedAlbumName = document.getElementById('selected-album-name');
const selectedAlbumArtist = document.getElementById('selected-album-artist');
const albumLinkDisplay = document.getElementById('album-link-display');
const artistLinkDisplay = document.getElementById('artist-link-display');
const selectedAlbumCover = document.getElementById('selected-album-cover');
const editAlbumBtn = document.getElementById('edit-album-btn');
const albumViewMode = document.getElementById('album-view-mode');
const albumEditMode = document.getElementById('album-edit-mode');
const albumDateInput = document.getElementById('album-date');
const albumTimeInput = document.getElementById('album-time');
const albumNowBtn = document.getElementById('album-now-btn');
const tracklistContainer = document.getElementById('tracklist-container');
const confirmAlbumScrobbleBtn = document.getElementById('confirm-album-scrobble-btn');
const loadMoreHistoryBtn = document.getElementById('load-more-history-btn');
const albumTracksNotFound = document.getElementById('album-tracks-not-found');
const continueManualBtn = document.getElementById('continue-manual-btn');

let username = localStorage.getItem(CONFIG.STORAGE_KEYS.USERNAME);
let userImage = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_IMAGE);
let statusTimeout;
let currentAlbumTracks = [];
let historyPage = 1;
const HISTORY_LIMIT = 50;
const DUPLICATE_WINDOW_SECONDS = 300;

// --- Auth Functions ---

async function checkAuthStatus(showSpinner = true) {
    if (showSpinner) toggleSpinner(true);
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/check-auth`);
        const data = await response.json();

        if (data.authenticated) {
            if (data.user) {
                updateUserSession(data.user.name, data.user.image);
            }
            showScrobbleUI();
        } else {
            showAuthUI();
        }
    } catch (error) {
        console.error('Check Auth Error:', error);
        showAuthUI();
    } finally {
        if (showSpinner) toggleSpinner(false);
    }
}

function showAuthUI() {
    authSection.classList.remove('hidden');
    scrobbleSection.classList.add('hidden');
    headerUserInfo.classList.add('hidden');
}

function showScrobbleUI() {
    authSection.classList.add('hidden');
    scrobbleSection.classList.remove('hidden');
    headerUserInfo.classList.remove('hidden');
    if (username) {
        usernameDisplay.textContent = username;
        usernameDisplay.href = `https://www.last.fm/user/${encodeLastFmParam(username)}`;
    }

    if (userImage) {
        userAvatar.src = userImage;
        userAvatar.classList.remove('hidden');
    } else {
        userAvatar.classList.add('hidden');
        userAvatar.src = '';
    }

    renderStateFromUrl();
}

loginBtn.addEventListener('click', async () => {
    toggleSpinner(true);

    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/login-url`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.url) {
            globalThis.location.href = data.url;
        } else {
            throw new Error('No login URL returned from server');
        }
    } catch (error) {
        console.error('Login Error:', error);
        showStatus(`Login Failed: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
});

async function handleAuthCallback(token) {
    toggleSpinner(true);

    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.message || 'Authentication failed');
        }

        updateUserSession(data.session.name, data.session.image);

        globalThis.history.replaceState({}, document.title, globalThis.location.pathname);
        showScrobbleUI();

    } catch (error) {
        console.error('Auth Error:', error);
        showStatus(`Login Failed: ${error.message}`, 'error');
        showAuthUI();
    } finally {
        toggleSpinner(false);
    }
}

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch(`${CONFIG.BACKEND_URL}/logout`, { method: 'POST' });
    } catch (error) {
        console.error('Logout Error:', error);
    }

    localStorage.removeItem(CONFIG.STORAGE_KEYS.USERNAME);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER_IMAGE);
    username = null;
    userImage = null;
    showAuthUI();
});

// --- Utility Functions ---

function encodeLastFmParam(param) {
    if (!param) return '';
    return encodeURIComponent(param).replaceAll('%20', '+').replaceAll('%2B', '%252B');
}

function updateUserSession(name, images) {
    username = name;
    localStorage.setItem(CONFIG.STORAGE_KEYS.USERNAME, username);

    userImage = null;
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER_IMAGE);

    if (images) {
        const imageUrls = getSortedImageUrls(images, ['small']);
        if (imageUrls.length > 0) {
            userImage = imageUrls[0];

            if (userImage.startsWith('https://lastfm.freetls.fastly.net/i/u/')) {
                userImage = userImage.replace('https://lastfm.freetls.fastly.net/i/u/34', 'https://lastfm.freetls.fastly.net/i/u/avatar42');
            }

            localStorage.setItem(CONFIG.STORAGE_KEYS.USER_IMAGE, userImage);
        }
    }
}

function getSortedImageUrls(images, preferences = ['large', 'extralarge', 'medium', 'small']) {
    if (!images || !Array.isArray(images)) return [];

    const sortedUrls = [];
    const seenUrls = new Set();

    for (const size of preferences) {
        const img = images.find(i => i.size === size);
        if (img?.['#text']) {
            if (!seenUrls.has(img['#text'])) {
                sortedUrls.push(img['#text']);
                seenUrls.add(img['#text']);
            }
        }
    }

    return sortedUrls;
}

function setImageWithFallback(imgElement, imageUrls) {
    imgElement.onerror = null;

    const setFallback = () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", imgElement.className);
        if (imgElement.id) svg.setAttribute("id", imgElement.id);
        if (imgElement.alt) svg.setAttribute("aria-label", imgElement.alt);

        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "assets/icons/sprite.svg#icon-laser-disc");
        svg.appendChild(use);

        if (imgElement.parentNode) {
            imgElement.parentNode.replaceChild(svg, imgElement);
        }
        return svg;
    };

    if (!imageUrls || imageUrls.length === 0) {
        return setFallback();
    }

    let currentIndex = 0;

    const loadNext = () => {
        if (currentIndex >= imageUrls.length) {
            setFallback();
            return;
        }

        const url = imageUrls[currentIndex];
        currentIndex++;
        imgElement.src = url;
    };

    imgElement.onerror = () => {
        loadNext();
    };

    loadNext();
    return imgElement;
}

function showStatus(message, type) {
    if (typeof message === 'string' && message.endsWith('.')) {
        message = message.slice(0, -1);
    }

    if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }

    statusMessage.textContent = message;
    statusMessage.className = type;
    statusMessage.classList.remove('hidden');

    statusMessage.classList.add('toast');

    statusTimeout = setTimeout(() => {
        statusMessage.classList.add('hidden');
        statusTimeout = null;
    }, 5000);
}

function hideStatus() {
    if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
    statusMessage.classList.add('hidden');
}

function toggleSpinner(show) {
    if (show) {
        loadingSpinnerContainer.classList.remove('hidden');
    } else {
        loadingSpinnerContainer.classList.add('hidden');
    }
}

function updateDateTimeInputs(dateObj, dateEl, timeEl) {
    if (!dateObj) return;

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');

    if (dateEl) dateEl.value = `${year}-${month}-${day}`;
    if (timeEl) timeEl.value = `${hours}:${minutes}:${seconds}`;
}

function setTimestampToNow(dateEl, timeEl) {
    const now = new Date();
    updateDateTimeInputs(now, dateEl, timeEl);
}

function getTimestampFromInputs(dateEl, timeEl) {
    const dateVal = dateEl.value;
    const timeVal = timeEl.value;

    if (!dateVal || !timeVal) return null;

    const dateObj = new Date(`${dateVal}T${timeVal}`);
    return Math.floor(dateObj.getTime() / 1000);
}

// --- Toggle Logic ---

function showTrackMode() {
    modeTrackBtn.classList.add('active');
    modeAlbumBtn.classList.remove('active');
    modeFixPastBtn.classList.remove('active');
    scrobbleForm.classList.remove('hidden');
    albumScrobbleContainer.classList.add('hidden');
    fixPastSection.classList.add('hidden');
    artistInput.focus();
}

function showAlbumMode() {
    modeAlbumBtn.classList.add('active');
    modeTrackBtn.classList.remove('active');
    modeFixPastBtn.classList.remove('active');
    scrobbleForm.classList.add('hidden');
    albumScrobbleContainer.classList.remove('hidden');
    fixPastSection.classList.add('hidden');
    albumSearchInput.focus();
}

function showHistoryMode() {
    modeFixPastBtn.classList.add('active');
    modeTrackBtn.classList.remove('active');
    modeAlbumBtn.classList.remove('active');
    scrobbleForm.classList.add('hidden');
    albumScrobbleContainer.classList.add('hidden');
    fixPastSection.classList.remove('hidden');
    loadHistory();
}

modeTrackBtn.addEventListener('click', () => {
    updateUrl({ mode: 'track' });
});

modeAlbumBtn.addEventListener('click', () => {
    updateUrl({ mode: 'album' });
});

modeFixPastBtn.addEventListener('click', () => {
    updateUrl({ mode: 'history' });
});

// --- Pin Logic ---

function setupPin(btn) {
    if (!btn) return;
    btn.addEventListener('click', () => {
        btn.classList.toggle('active');
    });
}

setupPin(pinArtistBtn);
setupPin(pinTrackBtn);
setupPin(pinAlbumBtn);
setupPin(pinAlbumArtistBtn);

// --- Track Scrobble Logic ---

scrobbleForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const artist = artistInput.value;
    const track = trackInput.value;
    const album = albumInput.value;
    const albumArtist = albumArtistInput.value;
    const timestamp = getTimestampFromInputs(dateInput, timeInput);

    if (!artist || !track || !timestamp) {
        showStatus('Please fill in all required fields', 'error');
        return;
    }

    const payload = {
        artist,
        track,
        timestamp
    };

    if (album) payload.album = album;
    if (albumArtist) payload.albumArtist = albumArtist;

    toggleSpinner(true);

    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/scrobble`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.message || 'Scrobble failed');
        }

        showStatus(`Scrobbled`, 'success');

        if (!pinArtistBtn.classList.contains('active')) artistInput.value = '';
        if (!pinTrackBtn.classList.contains('active')) trackInput.value = '';
        if (!pinAlbumBtn.classList.contains('active')) albumInput.value = '';
        if (!pinAlbumArtistBtn.classList.contains('active')) albumArtistInput.value = '';

        setTimestampToNow(dateInput, timeInput);

    } catch (error) {
        console.error('Scrobble Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
});

// --- Track Album Lookup Logic ---

const findAlbumBtn = document.getElementById('find-album-btn');
const trackAlbumResults = document.getElementById('track-album-results');

if (findAlbumBtn) {
    findAlbumBtn.addEventListener('click', async () => {
        const artist = artistInput.value.trim();
        const track = trackInput.value.trim();

        if (!artist || !track) {
            showStatus('Please enter Artist and Track first', 'error');
            return;
        }

        toggleSpinner(true);
        trackAlbumResults.innerHTML = '';
        trackAlbumResults.classList.remove('hidden');

        try {
            const response = await fetch(`${CONFIG.BACKEND_URL}/lookup-track-albums?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.message || 'Lookup failed');
            }

            const albums = data.albums || [];

            if (albums.length === 0) {
                showStatus('No suitable albums found', 'error');
                trackAlbumResults.classList.add('hidden');
                return;
            }

            renderTrackAlbumResults(albums);

        } catch (error) {
            console.error('Lookup Error:', error);
            showStatus(`Error: ${error.message}`, 'error');
            trackAlbumResults.classList.add('hidden');
        } finally {
            toggleSpinner(false);
        }
    });
}

function renderTrackAlbumResults(albums) {
    trackAlbumResults.innerHTML = '';

    albums.forEach(album => {
        const imageUrls = getSortedImageUrls(album.image);

        const card = document.createElement('div');
        card.className = 'album-card';

        const img = document.createElement('img');
        img.className = 'album-cover';
        const coverEl = setImageWithFallback(img, imageUrls);

        const info = document.createElement('div');
        info.className = 'album-info';

        const nameStr = document.createElement('strong');
        nameStr.textContent = album.name;

        const artistStr = document.createElement('span');
        artistStr.textContent = album.artist;

        info.appendChild(nameStr);
        info.appendChild(artistStr);

        card.appendChild(coverEl);
        card.appendChild(info);

        card.addEventListener('click', () => {
            albumInput.value = album.name;
            if (album.artist) {
                albumArtistInput.value = album.artist;
                if (vaBtn) {
                     if (album.artist === 'Various Artists') {
                        vaBtn.classList.add('active');
                     } else {
                        vaBtn.classList.remove('active');
                     }
                }
            }

            trackAlbumResults.classList.add('hidden');
            trackAlbumResults.innerHTML = '';
        });

        trackAlbumResults.appendChild(card);
    });
}

// --- Album Search Logic ---

async function performAlbumSearch() {
    const query = albumSearchInput.value.trim();
    if (!query) {
        showStatus('Please enter an artist or album name', 'error');
        return;
    }

    const currentParams = new URLSearchParams(globalThis.location.search);
    if (currentParams.get('q') !== query) {
        updateUrl({ mode: 'album', q: query, artist: null, album: null });
        return;
    }

    toggleSpinner(true);
    albumResults.innerHTML = '';

    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/search-album?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.message || 'Search failed');
        }

        const albums = data.results?.albummatches?.album || [];

        if (albums.length === 0) {
            showStatus('No albums found', 'error');
            return;
        }

        renderAlbumResults(albums);
        albumResults.dataset.query = query;

    } catch (error) {
        console.error('Search Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
}

albumSearchBtn.addEventListener('click', performAlbumSearch);
albumSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performAlbumSearch();
});

function renderAlbumResults(albums) {
    albumResults.innerHTML = '';
    const fragment = document.createDocumentFragment();

    albums.forEach(album => {
        const imageUrls = getSortedImageUrls(album.image);

        const card = document.createElement('div');
        card.className = 'album-card';

        const img = document.createElement('img');
        img.alt = album.name;
        img.className = 'album-cover';
        const coverEl = setImageWithFallback(img, imageUrls);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'album-info';

        const strong = document.createElement('strong');
        strong.textContent = album.name;

        const span = document.createElement('span');
        span.textContent = album.artist;

        infoDiv.appendChild(strong);
        infoDiv.appendChild(span);
        card.appendChild(coverEl);
        card.appendChild(infoDiv);

        card.addEventListener('click', () => selectAlbum(album));
        fragment.appendChild(card);
    });

    albumResults.appendChild(fragment);
}

// --- Album Selection & Verification Logic ---

async function selectAlbum(album) {
    const currentParams = new URLSearchParams(globalThis.location.search);
    const urlArtist = currentParams.get('artist');
    const urlAlbum = currentParams.get('album');
    const urlQuery = currentParams.get('q');

    if (urlArtist !== album.artist || urlAlbum !== album.name) {
         updateUrl({
             mode: 'album',
             q: urlQuery,
             artist: album.artist,
             album: album.name
         });
         return;
    }

    toggleSpinner(true);
    try {
        let url = `${CONFIG.BACKEND_URL}/get-album-info?`;
        if (album.mbid) {
            url += `mbid=${album.mbid}`;
        } else {
            url += `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.message || 'Failed to load album info');
        }

        const albumInfo = data.album;
        prepareVerificationView(albumInfo);

    } catch (error) {
        console.error('Album Info Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
}

function prepareVerificationView(albumInfo) {
    toggleVerificationView(true);
    updateAlbumDetails(albumInfo);

    currentAlbumTracks = [];
    const tracks = albumInfo.tracks?.track || [];
    const trackArray = Array.isArray(tracks) ? tracks : [tracks];

    if (trackArray.length === 0) {
        handleEmptyAlbum(albumInfo);
    } else {
        renderAlbumTracks(trackArray, albumInfo);
    }
}

function toggleVerificationView(show) {
    if (show) {
        albumSearchView.classList.add('hidden');
        albumVerificationView.classList.remove('hidden');
        if (albumViewMode) albumViewMode.classList.remove('hidden');
        if (albumEditMode) albumEditMode.classList.add('hidden');
        if (editAlbumBtn) {
            editAlbumBtn.innerHTML = EDIT_ICON_SVG;
            editAlbumBtn.title = "Edit Album Details";
        }
    }
}

function updateAlbumDetails(albumInfo) {
    selectedAlbumName.value = albumInfo.name;
    selectedAlbumArtist.value = albumInfo.artist;

    if (artistLinkDisplay) {
        artistLinkDisplay.textContent = albumInfo.artist;
        artistLinkDisplay.href = `https://www.last.fm/music/${encodeLastFmParam(albumInfo.artist)}`;
    }
    if (albumLinkDisplay) {
        albumLinkDisplay.textContent = albumInfo.name;
        albumLinkDisplay.href = `https://www.last.fm/music/${encodeLastFmParam(albumInfo.artist)}/${encodeLastFmParam(albumInfo.name)}`;
    }

    const imageUrls = getSortedImageUrls(albumInfo.image);
    if (selectedAlbumCover) {
        setImageWithFallback(selectedAlbumCover, imageUrls);
    }
}

function handleEmptyAlbum(albumInfo) {
    const albumDateGroup = document.getElementById('album-date').closest('.form-group');

    tracklistContainer.classList.add('hidden');
    confirmAlbumScrobbleBtn.classList.add('hidden');
    if (albumDateGroup) albumDateGroup.classList.add('hidden');

    if (albumTracksNotFound) albumTracksNotFound.classList.remove('hidden');

    if (continueManualBtn) {
        continueManualBtn.onclick = () => {
            modeTrackBtn.click();

            artistInput.value = albumInfo.artist;
            albumInput.value = albumInfo.name;
            albumArtistInput.value = albumInfo.artist;

            if (vaBtn) {
                if (albumInfo.artist === 'Various Artists') {
                    vaBtn.classList.add('active');
                } else {
                    vaBtn.classList.remove('active');
                }
            }

            if (!pinArtistBtn.classList.contains('active')) pinArtistBtn.click();
            if (!pinAlbumBtn.classList.contains('active')) pinAlbumBtn.click();
            if (!pinAlbumArtistBtn.classList.contains('active')) pinAlbumArtistBtn.click();

            trackInput.focus();
        };
    }
}

function renderAlbumTracks(trackArray, albumInfo) {
    const albumDateGroup = document.getElementById('album-date').closest('.form-group');

    tracklistContainer.classList.remove('hidden');
    confirmAlbumScrobbleBtn.classList.remove('hidden');
    if (albumDateGroup) albumDateGroup.classList.remove('hidden');
    if (albumTracksNotFound) albumTracksNotFound.classList.add('hidden');

    tracklistContainer.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'track-row header';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'btn secondary small-btn active';
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.addEventListener('click', () => {
        selectAllBtn.classList.toggle('active');
        const checked = selectAllBtn.classList.contains('active');

        currentAlbumTracks.forEach(track => {
            if (track.checkbox) {
                track.checkbox.checked = checked;
            }
        });
        updateTrackTimestamps();
    });

    headerRow.appendChild(selectAllBtn);
    tracklistContainer.appendChild(headerRow);

    albumDateInput.removeEventListener('input', updateTrackTimestamps);
    albumTimeInput.removeEventListener('input', updateTrackTimestamps);

    const fragment = document.createDocumentFragment();

    trackArray.forEach((track, index) => {
        const row = createTrackRow(track, index, albumInfo);
        fragment.appendChild(row);
    });

    tracklistContainer.appendChild(fragment);

    setTimestampToNow(albumDateInput, albumTimeInput);

    albumDateInput.addEventListener('input', updateTrackTimestamps);
    albumTimeInput.addEventListener('input', updateTrackTimestamps);

    setTimeout(updateTrackTimestamps, 0);
}

function createTrackRow(track, index, albumInfo) {
    const duration = Number.parseInt(track.duration) || 180;

    const trackObj = {
        name: track.name,
        artist: track.artist?.name || albumInfo.artist,
        duration: duration,
        album: albumInfo.name,
        albumArtist: albumInfo.artist
    };
    currentAlbumTracks.push(trackObj);

    const row = document.createElement('div');
    row.className = 'track-row';

    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'checkbox-wrapper';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `track-${index}`;
    checkbox.checked = true;
    checkbox.addEventListener('change', updateTrackTimestamps);
    trackObj.checkbox = checkbox;

    const customCheckbox = document.createElement('div');
    customCheckbox.className = 'custom-checkbox';
    customCheckbox.innerHTML = CHECKMARK_SVG;

    checkboxWrapper.appendChild(checkbox);
    checkboxWrapper.appendChild(customCheckbox);

    row.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        if (e.target.tagName === 'A') return;

        checkbox.checked = !checkbox.checked;
        updateTrackTimestamps();
    });

    const trackInfo = document.createElement('div');
    trackInfo.className = 'track-info';

    const numSpan = document.createElement('span');
    numSpan.className = 'track-number';
    numSpan.textContent = `${index + 1}.`;

    const nameLink = document.createElement('a');
    nameLink.className = 'track-name';
    nameLink.textContent = track.name;

    if (track.url) {
        nameLink.href = track.url;
    } else {
        nameLink.href = `https://www.last.fm/music/${encodeLastFmParam(track.artist?.name || albumInfo.artist)}/_/${encodeLastFmParam(track.name)}`;
    }
    nameLink.target = '_blank';
    nameLink.rel = 'noopener noreferrer';

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'track-timestamp';
    timestampSpan.id = `timestamp-${index}`;
    trackObj.timestampSpan = timestampSpan;

    trackInfo.appendChild(numSpan);
    trackInfo.appendChild(nameLink);
    trackInfo.appendChild(timestampSpan);

    row.appendChild(checkboxWrapper);
    row.appendChild(trackInfo);

    return row;
}

function updateTrackTimestamps() {
    const endTimestamp = getTimestampFromInputs(albumDateInput, albumTimeInput);
    if (!endTimestamp) return;

    const checkedIndices = [];
    currentAlbumTracks.forEach((track, index) => {
        if (track.checkbox?.checked) {
            checkedIndices.push(index);
        } else if (track.timestampSpan) {
            track.timestampSpan.textContent = '';
        }
    });

    if (checkedIndices.length === 0) return;

    let currentStart = endTimestamp;

    for (let i = checkedIndices.length - 1; i >= 0; i--) {
        const trackIndex = checkedIndices[i];
        const track = currentAlbumTracks[trackIndex];

        track.calculatedTimestamp = currentStart;

        const span = track.timestampSpan;
        if (span) {
            const dateObj = new Date(currentStart * 1000);
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const seconds = String(dateObj.getSeconds()).padStart(2, '0');
            span.textContent = `${hours}:${minutes}:${seconds}`;
        }

        if (i > 0) {
            const prevTrackIndex = checkedIndices[i-1];
            const prevTrack = currentAlbumTracks[prevTrackIndex];
            currentStart -= prevTrack.duration;
        }
    }
}

backToSearchBtn.addEventListener('click', () => {
    const q = new URLSearchParams(globalThis.location.search).get('q');
    updateUrl({ mode: 'album', q: q, artist: null, album: null });
});

if (editAlbumBtn) {
    editAlbumBtn.addEventListener('click', () => {
        if (albumViewMode && albumEditMode) {
            const isEditing = !albumEditMode.classList.contains('hidden');

            if (isEditing) {
                // Save Changes
                const newAlbumName = selectedAlbumName.value.trim();
                const newArtistName = selectedAlbumArtist.value.trim();

                if (newAlbumName) albumLinkDisplay.textContent = newAlbumName;
                if (newArtistName) artistLinkDisplay.textContent = newArtistName;

                if (newAlbumName && newArtistName) {
                    albumLinkDisplay.href = `https://www.last.fm/music/${encodeLastFmParam(newArtistName)}/${encodeLastFmParam(newAlbumName)}`;
                    artistLinkDisplay.href = `https://www.last.fm/music/${encodeLastFmParam(newArtistName)}`;
                }

                albumViewMode.classList.remove('hidden');
                albumEditMode.classList.add('hidden');

                editAlbumBtn.innerHTML = EDIT_ICON_SVG;
                editAlbumBtn.title = "Edit Album Details";
            } else {
                // Enter Edit Mode
                albumViewMode.classList.add('hidden');
                albumEditMode.classList.remove('hidden');
                selectedAlbumName.focus();

                editAlbumBtn.innerHTML = DONE_ICON_SVG;
                editAlbumBtn.title = "Save Changes";
            }
        }
    });
}

// --- Batch Scrobbling Logic ---

confirmAlbumScrobbleBtn.addEventListener('click', async () => {
    const endTimestamp = getTimestampFromInputs(albumDateInput, albumTimeInput);

    if (!endTimestamp) {
        showStatus('Please select a valid timestamp', 'error');
        return;
    }

    updateTrackTimestamps();

    const tracksToScrobble = [];
    const finalAlbumName = selectedAlbumName.value;
    const finalAlbumArtist = selectedAlbumArtist.value;

    currentAlbumTracks.forEach((track) => {
        if (track.checkbox?.checked) {
            if (!track.calculatedTimestamp) return;

            let finalArtist = track.artist;
            if (track.artist === track.albumArtist) {
                finalArtist = finalAlbumArtist;
            }

            tracksToScrobble.push({
                artist: finalArtist,
                track: track.name,
                album: finalAlbumName,
                albumArtist: finalAlbumArtist,
                timestamp: track.calculatedTimestamp
            });
        }
    });

    if (tracksToScrobble.length === 0) {
        showStatus('No tracks selected', 'error');
        return;
    }

    toggleSpinner(true);

    const batches = [];
    while (tracksToScrobble.length > 0) {
        batches.push(tracksToScrobble.splice(0, 50));
    }

    try {
        await Promise.all(batches.map(async (batch) => {
             const response = await fetch(`${CONFIG.BACKEND_URL}/scrobble-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tracks: batch })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.message || 'Batch scrobble failed');
            }
        }));

        showStatus('Scrobbled', 'success');

    } catch (error) {
        console.error('Batch Scrobble Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
});

// --- Fix Past Logic ---

if (reloadHistoryBtn) {
    reloadHistoryBtn.addEventListener('click', () => loadHistory(false));
}

if (loadMoreHistoryBtn) {
    loadMoreHistoryBtn.addEventListener('click', () => {
        historyPage++;
        loadHistory(true);
    });
}

function resetHistoryView() {
    historyPage = 1;
    historyList.innerHTML = '';
    globalThis.cachedHistoryTracks = [];
    if (loadMoreHistoryBtn) loadMoreHistoryBtn.classList.add('hidden');
}

async function fetchHistoryTracks(page) {
    const response = await fetch(`${CONFIG.BACKEND_URL}/get-recent-tracks?user=${username}&limit=${HISTORY_LIMIT}&page=${page}`);
    const data = await response.json();

    if (data.error) {
        throw new Error(data.message || 'Failed to load history');
    }

    return data.recenttracks?.track || [];
}

function updateLoadMoreButton(trackCount) {
    if (!loadMoreHistoryBtn) return;

    if (trackCount < HISTORY_LIMIT) {
        loadMoreHistoryBtn.classList.add('hidden');
    } else {
        loadMoreHistoryBtn.classList.remove('hidden');
    }
}

function updateHistoryCache(newTracks, append) {
    if (append && globalThis.cachedHistoryTracks) {
        globalThis.cachedHistoryTracks = [...globalThis.cachedHistoryTracks, ...newTracks];
    } else {
        globalThis.cachedHistoryTracks = newTracks;
    }
}

async function loadHistory(append = false) {
    if (!username) {
        showStatus('Please login first', 'error');
        return;
    }

    if (!append) {
        resetHistoryView();
    }

    toggleSpinner(true);

    try {
        const newTracks = await fetchHistoryTracks(historyPage);

        updateLoadMoreButton(newTracks.length);
        updateHistoryCache(newTracks, append);

        const scrollPos = globalThis.scrollY;
        renderHistory(globalThis.cachedHistoryTracks);
        if (append) globalThis.scrollTo(0, scrollPos);

    } catch (error) {
        console.error('History Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        toggleSpinner(false);
    }
}

function renderHistory(tracks) {
    historyList.innerHTML = '';
    const showNoAlbum = filterNoAlbum.classList.contains('active');
    const showDuplicates = filterDuplicates.classList.contains('active');

    let filteredTracks = tracks.filter(track => track['@attr']?.nowplaying !== 'true');

    if (showNoAlbum) {
        filteredTracks = filteredTracks.filter(track => !track.album?.['#text']);
    }

    if (showDuplicates) {
        const duplicates = new Set();
        // 5 minute window for duplicates
        for (let i = 0; i < filteredTracks.length - 1; i++) {
            const current = filteredTracks[i];
            const next = filteredTracks[i+1];

            if (current.name === next.name && current.artist['#text'] === next.artist['#text']) {
                 const timeDiff = Math.abs(Number.parseInt(current.date.uts) - Number.parseInt(next.date.uts));
                 if (timeDiff < DUPLICATE_WINDOW_SECONDS) {
                     duplicates.add(current);
                     duplicates.add(next);
                 }
            }
        }
        filteredTracks = filteredTracks.filter(track => duplicates.has(track));
    }

    if (filteredTracks.length === 0) {
        historyList.innerHTML = '<p class="no-tracks-message">No tracks found matching criteria.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    let lastDateStr = '';

    filteredTracks.forEach(track => {
        const dateObj = track.date ? new Date(track.date.uts * 1000) : new Date();
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const dateStr = `${day}.${month}.${year}`;

        if (dateStr !== lastDateStr) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.textContent = dateStr;
            fragment.appendChild(sep);
            lastDateStr = dateStr;
        }

        const item = document.createElement('div');
        item.className = 'history-item';

        const isNoAlbum = !track.album?.['#text'];

        const imageUrls = getSortedImageUrls(track.image);

        const coverImg = document.createElement('img');
        coverImg.className = 'history-cover';
        coverImg.alt = track.album?.['#text'] || 'Album Cover';
        const coverEl = setImageWithFallback(coverImg, imageUrls);
        item.appendChild(coverEl);

        const info = document.createElement('div');
        info.className = 'history-info';

        const title = document.createElement('a');
        title.className = 'history-track';
        title.textContent = track.name;
        title.href = `https://www.last.fm/music/${encodeLastFmParam(track.artist['#text'])}/_/${encodeLastFmParam(track.name)}`;
        title.target = '_blank';

        const artist = document.createElement('a');
        artist.className = 'history-artist';
        artist.textContent = track.artist['#text'];
        artist.href = `https://www.last.fm/music/${encodeLastFmParam(track.artist['#text'])}`;
        artist.target = '_blank';

        info.appendChild(title);
        info.appendChild(artist);

        if (!isNoAlbum) {
            const meta = document.createElement('div');
            meta.className = 'history-meta';

            const albumLink = document.createElement('a');
            albumLink.className = 'history-album-link';
            albumLink.textContent = track.album['#text'];
            albumLink.href = `https://www.last.fm/music/${encodeLastFmParam(track.artist['#text'])}/${encodeLastFmParam(track.album['#text'])}`;
            albumLink.target = '_blank';
            meta.appendChild(albumLink);

            info.appendChild(meta);
        }

        const rightDiv = document.createElement('div');
        rightDiv.className = 'history-right';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'history-time';
        timeSpan.textContent = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'history-buttons';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-scrobble-btn';
        editBtn.innerHTML = EDIT_ICON_SVG;
        editBtn.title = 'Edit Scrobble';
        editBtn.addEventListener('click', () => {
            modeTrackBtn.click();
            artistInput.value = track.artist['#text'];
            trackInput.value = track.name;
            if (track.album?.['#text']) {
                albumInput.value = track.album['#text'];
            } else {
                albumInput.value = '';
            }

            if (track.albumArtist?.['#text']) {
                 albumArtistInput.value = track.albumArtist['#text'];
            } else {
                 albumArtistInput.value = '';
            }

            if (track.date?.uts) {
                const dateObj = new Date(track.date.uts * 1000);
                updateDateTimeInputs(dateObj, dateInput, timeInput);
            }

            if (pinArtistBtn.classList.contains('active')) pinArtistBtn.click();
            if (pinTrackBtn.classList.contains('active')) pinTrackBtn.click();
            if (pinAlbumBtn.classList.contains('active')) pinAlbumBtn.click();
            if (pinAlbumArtistBtn.classList.contains('active')) pinAlbumArtistBtn.click();

            globalThis.scrollTo({ top: 0, behavior: 'smooth' });
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-scrobble-btn';
        deleteBtn.innerHTML = DELETE_ICON_SVG;
        deleteBtn.title = 'Delete Scrobble';
        deleteBtn.dataset.artist = track.artist['#text'];
        deleteBtn.dataset.track = track.name;
        if (track.date?.uts) {
            deleteBtn.dataset.timestamp = track.date.uts;
        }

        buttonsDiv.appendChild(editBtn);
        buttonsDiv.appendChild(deleteBtn);

        rightDiv.appendChild(timeSpan);
        rightDiv.appendChild(buttonsDiv);

        item.appendChild(info);
        item.appendChild(rightDiv);
        fragment.appendChild(item);
    });

    historyList.appendChild(fragment);
}

filterNoAlbum.addEventListener('click', () => {
   filterNoAlbum.classList.toggle('active');
   if (globalThis.cachedHistoryTracks) {
       renderHistory(globalThis.cachedHistoryTracks);
   } else {
       loadHistory();
   }
});

filterDuplicates.addEventListener('click', () => {
   filterDuplicates.classList.toggle('active');
   if (globalThis.cachedHistoryTracks) {
       renderHistory(globalThis.cachedHistoryTracks);
   } else {
       loadHistory();
   }
});

async function deleteScrobble(timestamp) {
    // timestamp is in seconds (unix timestamp)
    // We need to convert it to a Date object to get the YYYY-MM-DD
    const dateObj = new Date(timestamp * 1000);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const url = `https://www.last.fm/user/${encodeLastFmParam(username)}/library?from=${dateStr}&to=${dateStr}`;

    globalThis.open(url, '_blank');
}

document.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-scrobble-btn');
    if (deleteBtn) {
        const timestamp = deleteBtn.dataset.timestamp;

        await deleteScrobble(timestamp);
    }
});

// --- Initialization ---

setTimestampToNow(dateInput, timeInput);
setTimestampToNow(albumDateInput, albumTimeInput);

if (trackNowBtn) {
    trackNowBtn.addEventListener('click', () => setTimestampToNow(dateInput, timeInput));
}

if (vaBtn) {
    vaBtn.addEventListener('click', () => {
        if (albumArtistInput) {
            if (albumArtistInput.value === 'Various Artists') {
                albumArtistInput.value = '';
                vaBtn.classList.remove('active');
            } else {
                albumArtistInput.value = 'Various Artists';
                vaBtn.classList.add('active');
            }
        }
    });

    if (albumArtistInput) {
        albumArtistInput.addEventListener('input', () => {
             if (albumArtistInput.value === 'Various Artists') {
                 vaBtn.classList.add('active');
             } else {
                 vaBtn.classList.remove('active');
             }
        });
    }
}

if (albumNowBtn) {
    albumNowBtn.addEventListener('click', () => {
        setTimestampToNow(albumDateInput, albumTimeInput);
        updateTrackTimestamps();
    });
}

const urlParams = new URLSearchParams(globalThis.location.search);
const token = urlParams.get('token');

// --- State Management ---

function updateUrl(params) {
    const url = new URL(globalThis.location);

    Object.keys(params).forEach(key => {
        if (params[key] === null) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, params[key]);
        }
    });

    globalThis.history.pushState({}, '', url);
    renderStateFromUrl();
}

globalThis.addEventListener('popstate', renderStateFromUrl);

function renderStateFromUrl() {
    const params = new URLSearchParams(globalThis.location.search);
    const mode = params.get('mode') || 'track';

    if (mode === 'track') {
        showTrackMode();
    } else if (mode === 'album') {
        handleAlbumModeState(params);
    } else if (mode === 'history') {
        showHistoryMode();
    }
}

function handleAlbumModeState(params) {
    showAlbumMode();
    const q = params.get('q');
    const artist = params.get('artist');
    const album = params.get('album');

    if (artist && album) {
        const currentArtist = selectedAlbumArtist.value;
        const currentAlbum = selectedAlbumName.value;
        const isVerificationView = !albumVerificationView.classList.contains('hidden');

        if (!isVerificationView || currentArtist !== artist || currentAlbum !== album) {
            selectAlbum({ artist: artist, name: album });
        }
    } else if (q) {
        if (albumSearchInput.value !== q || albumResults.dataset.query !== q || albumResults.children.length === 0) {
            albumSearchInput.value = q;
            performAlbumSearch();
        } else {
            albumVerificationView.classList.add('hidden');
            albumSearchView.classList.remove('hidden');
        }
    } else {
        albumVerificationView.classList.add('hidden');
        albumSearchView.classList.remove('hidden');
    }
}

if (token) {
    await handleAuthCallback(token);
} else {
    if (username) {
        showScrobbleUI();
        checkAuthStatus(false);
    } else {
        showAuthUI();
        checkAuthStatus(false);
    }
}

if ('serviceWorker' in navigator) {
    globalThis.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
        });
    });
}
