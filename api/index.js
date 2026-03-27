const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('node:crypto');
const https = require('node:https');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();

const API_KEY = process.env.LASTFM_API_KEY;
const SHARED_SECRET = process.env.LASTFM_SHARED_SECRET;
const MUSICBRAINZ_API_ROOT = 'https://musicbrainz.org/ws/2/';
const MUSICBRAINZ_USER_AGENT = 'Last.ing/1.0 ( https://github.com/comet-builds/Last.ing )';
const CACHE_SIZE_LIMIT = 500;
const MAX_STRING_LENGTH = 500;
const COOKIE_SECRET = process.env.COOKIE_SECRET || process.env.LASTFM_SHARED_SECRET;
const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

const signParams = (params) => {
    const signatureString = Object.keys(params)
        .sort((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        })
        .reduce((acc, key) => {
            if (key !== 'format' && key !== 'callback') {
                return acc + key + params[key];
            }
            return acc;
        }, '');

    return crypto.createHash('md5').update(signatureString + SHARED_SECRET).digest('hex');
};

const injectApiKey = (queryParams, bodyParams, isPost, hasBody) => {
    if (queryParams.has('api_key')) queryParams.set('api_key', API_KEY);
    if (bodyParams.has('api_key')) bodyParams.set('api_key', API_KEY);

    if (!queryParams.has('api_key') && !bodyParams.has('api_key')) {
        if (isPost && hasBody) bodyParams.set('api_key', API_KEY);
        else queryParams.set('api_key', API_KEY);
    }
};

const recalculateSignature = (queryParams, bodyParams, hasBody) => {
    const hadSig = queryParams.has('api_sig') || bodyParams.has('api_sig');

    if (hadSig) {
        queryParams.delete('api_sig');
        bodyParams.delete('api_sig');

        const allParams = {};
        for (const [key, value] of queryParams.entries()) allParams[key] = value;
        for (const [key, value] of bodyParams.entries()) allParams[key] = value;

        const newSig = signParams(allParams);

        if (hasBody) bodyParams.set('api_sig', newSig);
        else queryParams.set('api_sig', newSig);
    }
};


// Vercel routes traffic through its edge network, adding exactly one trusted proxy
// By trusting the first proxy, we correctly identify the user IP and prevent spoofing.
app.set('trust proxy', 1);

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use(limiter);

app.use(helmet());
app.use(compression());


app.use('/api/2.0/', (req, res) => {
    const targetUrl = new URL(API_ROOT);
    const isPost = req.method === 'POST';

    const processRequest = (bodyBuffer) => {
        const options = {
            method: req.method,
            headers: { ...req.headers }
        };
        delete options.headers.host;

        const rawQueryString = req.originalUrl.split('?')[1] || '';
        const queryParams = new URLSearchParams(rawQueryString);
        let bodyParams = new URLSearchParams();
        let hasBody = false;

        if (isPost && bodyBuffer && bodyBuffer.length > 0) {
            bodyParams = new URLSearchParams(bodyBuffer.toString('utf8'));
            hasBody = true;
        }

        injectApiKey(queryParams, bodyParams, isPost, hasBody);
        recalculateSignature(queryParams, bodyParams, hasBody);

        for (const [key, value] of queryParams.entries()) {
            targetUrl.searchParams.append(key, value);
        }

        let finalBody = bodyBuffer;
        if (hasBody) {
            finalBody = Buffer.from(bodyParams.toString(), 'utf8');
            options.headers['content-length'] = finalBody.length.toString();
        }

        const proxyReq = https.request(targetUrl, options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('error', (err) => {
            console.error('Reverse Proxy Error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Proxy Request Failed', details: err.message });
            }
        });

        if (finalBody) proxyReq.write(finalBody);
        proxyReq.end();
    };

    if (isPost) {
        const contentLength = req.headers['content-length'];
        const hasBodyContent = contentLength && contentLength !== '0';
        const isChunked = req.headers['transfer-encoding'] === 'chunked';

        if (hasBodyContent || isChunked) {
            const contentType = req.headers['content-type'] || '';
            if (!contentType.includes('application/x-www-form-urlencoded')) {
                return res.status(415).json({ error: 'Unsupported Media Type' });
            }
        }

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => processRequest(Buffer.concat(chunks)));
        req.on('error', () => res.status(500).end());
    } else {
        processRequest(null);
    }
});

app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});


const agent = new https.Agent({ keepAlive: true });
const apiClient = axios.create({
    httpsAgent: agent,
    timeout: 30000
});

// Simple LRU Cache for Album Info
class SimpleLRUCache {
    constructor(limit = CACHE_SIZE_LIMIT) {
        this.limit = limit;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        // Refresh key
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.limit) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
    }
}

const albumCache = new SimpleLRUCache(CACHE_SIZE_LIMIT);
const mbMbidCache = new SimpleLRUCache(CACHE_SIZE_LIMIT);
const mbTracklistCache = new SimpleLRUCache(CACHE_SIZE_LIMIT);

// --- Helper Functions ---

const ensureString = (val, maxLength = MAX_STRING_LENGTH) => {
    if (typeof val !== 'string') return false;
    if (val.length > maxLength) return false;
    return true;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidUUID = (val) => {
    return typeof val === 'string' && UUID_REGEX.test(val);
};

const escapeLucene = (str) => {
    return str.replaceAll(/([+\-!(){}[\]^"~*?:/\\&|])/g, String.raw`\$1`);
};

const searchMusicBrainzRelease = async (artist, album) => {
    const cacheKey = JSON.stringify([artist, album]);
    const cachedData = mbMbidCache.get(cacheKey);

    if (cachedData !== undefined) {
        return cachedData;
    }

    const escapedAlbum = escapeLucene(album);
    const escapedArtist = escapeLucene(artist);

    const query = `release:${escapedAlbum} AND artist:${escapedArtist}`;
    const searchUrl = `${MUSICBRAINZ_API_ROOT}release/`;

    const searchResponse = await apiClient.get(searchUrl, {
        params: {
            query: query,
            fmt: 'json'
        },
        headers: {
            'User-Agent': MUSICBRAINZ_USER_AGENT
        }
    });

    const releases = searchResponse.data.releases;
    if (releases && releases.length > 0) {
        // Use the first result
        const mbid = releases[0].id;
        mbMbidCache.set(cacheKey, mbid);
        return mbid;
    }

    // Cache negative result
    mbMbidCache.set(cacheKey, null);
    return null;
};

const getReleaseTracks = async (mbid, defaultArtist) => {
    const cacheKey = mbid;
    const cachedData = mbTracklistCache.get(cacheKey);

    if (cachedData !== undefined) {
        return cachedData;
    }

    const lookupUrl = `${MUSICBRAINZ_API_ROOT}release/${encodeURIComponent(mbid)}`;

    const lookupResponse = await apiClient.get(lookupUrl, {
        params: {
            inc: 'recordings+artist-credits',
            fmt: 'json'
        },
        headers: {
            'User-Agent': MUSICBRAINZ_USER_AGENT
        }
    });

    const media = lookupResponse.data.media;
    if (!media || media.length === 0) {
        // Cache negative result
        mbTracklistCache.set(cacheKey, []);
        return [];
    }

    const tracks = [];
    let rank = 1;

    media.forEach(medium => {
        if (medium.tracks) {
            medium.tracks.forEach(track => {
                tracks.push({
                    name: track.title,
                    duration: Math.round(track.length / 1000), // Convert ms to seconds
                    artist: {
                        name: track['artist-credit']?.[0]?.artist?.name || defaultArtist
                    },
                    rank: rank++
                });
            });
        }
    });

    mbTracklistCache.set(cacheKey, tracks);
    return tracks;
};

const getMusicBrainzTracklist = async (artist, album, mbid) => {
    try {
        let releaseMbid = mbid;

        if (releaseMbid && !isValidUUID(releaseMbid)) {
            console.warn('Invalid MBID format provided');
            releaseMbid = null;
        }

        // If no MBID, search for the release
        if (!releaseMbid) {
            releaseMbid = await searchMusicBrainzRelease(artist, album);
        }

        if (!releaseMbid) {
            return [];
        }

        return await getReleaseTracks(releaseMbid, artist);

    } catch (error) {
        console.warn('MusicBrainz Lookup Failed:', error.message);
        return [];
    }
};


const sanitizeError = (error) => {
    let responseData;
    if (error.response?.data && typeof error.response.data === 'object') {
        responseData = { error: error.response.data.error, message: error.response.data.message };
    } else if (typeof error.response?.data === 'string') {
        responseData = error.response.data;
    }

    return {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData
    };
};

const handleRouteError = (res, error, contextMessage) => {
    const sanitizedError = sanitizeError(error);
    console.error(`${contextMessage}:`, sanitizedError);
    const status = error.response?.status || 500;

    if (status === 400 && sanitizedError.responseData) {
         return res.status(400).json(sanitizedError.responseData);
    }

    res.status(status).json({ error: contextMessage });
};

const makeLastFmRequest = async (method, params = {}, { signed = false, httpMethod = 'GET' } = {}) => {
    if (!API_KEY) {
        throw new Error('Server misconfiguration: Missing API Key');
    }

    const requestParams = {
        method,
        api_key: API_KEY,
        ...params
    };

    if (signed) {
        if (!SHARED_SECRET) {
            throw new Error('Server misconfiguration: Missing API Secret');
        }
        const apiSig = signParams(requestParams);
        requestParams.api_sig = apiSig;
    }

    requestParams.format = 'json';

    let response;

    if (httpMethod === 'POST') {
        const postData = new URLSearchParams();
        Object.keys(requestParams).forEach(key => postData.append(key, requestParams[key]));
        response = await apiClient.post(API_ROOT, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
    } else {
        response = await apiClient.get(API_ROOT, { params: requestParams });
    }

    if (response.data.error) {
            const error = new Error(response.data.message);
            error.response = { data: response.data, status: 400 };
            throw error;
    }

    return response.data;
};

const validateAlbumInfoParams = (artist, album, mbid) => {
    if (mbid !== undefined && mbid !== '') {
        return isValidUUID(mbid)
            ? { error: null }
            : { error: 'Invalid mbid format: must be a valid UUID string' };
    }

    if (artist !== undefined || album !== undefined) {
        if (!ensureString(artist) || !ensureString(album)) {
            return { error: `Invalid parameters: artist and album must be strings under ${MAX_STRING_LENGTH} characters` };
        }
        return { error: null };
    }

    return { error: 'Missing required parameters: (artist and album) or mbid' };
};

const hasAlbumTracks = (album) => {
    const tracks = album?.tracks?.track;
    return Array.isArray(tracks) ? tracks.length > 0 : !!tracks;
};

const updateAlbumTracks = (album, mbTracks) => {
    if (mbTracks.length > 0) {
        if (!album.tracks) {
            album.tracks = {};
        }
        album.tracks.track = mbTracks;
    }
};

const enrichAlbumWithMusicBrainzFallback = async (data, artist, album, mbid) => {
    if (hasAlbumTracks(data.album)) {
        return;
    }

    const mbTracks = await getMusicBrainzTracklist(
        data.album?.artist || artist,
        data.album?.name || album,
        data.album?.mbid || mbid
    );

    updateAlbumTracks(data.album, mbTracks);
};

const getAlbumInfoFromTrack = (trackInfo) => {
    if (trackInfo?.album) {
        return {
            name: trackInfo.album.title,
            artist: trackInfo.album.artist || trackInfo.artist.name,
            image: trackInfo.album.image,
            mbid: trackInfo.album.mbid,
            url: trackInfo.album.url
        };
    }
    return null;
};

const validateScrobbleTrack = (trackData) => {
    if (!trackData || typeof trackData !== 'object') {
        return { isValid: false, error: 'Invalid track data' };
    }

    const { artist, track, timestamp, album, albumArtist } = trackData;

    if (!artist || !track || !timestamp) {
        return { isValid: false, error: 'Missing required fields (artist, track, timestamp)' };
    }

    if (!ensureString(artist) || !ensureString(track) || (album && !ensureString(album)) || (albumArtist && !ensureString(albumArtist))) {
        return { isValid: false, error: `Invalid data types: artist, track, album, and albumArtist must be strings under ${MAX_STRING_LENGTH} characters` };
    }

    if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
        return { isValid: false, error: 'Invalid data type: timestamp must be an integer' };
    }

    return { isValid: true };
};

const validateTrackData = (trackData, index) => {
    if (!trackData || typeof trackData !== 'object') {
        return { isValid: false, error: `Invalid track data at index ${index}` };
    }

    const { artist, track, timestamp, album, albumArtist } = trackData;

    if (!artist || !track || !timestamp) {
        return { isValid: false, error: `Missing required fields at index ${index} (artist, track, timestamp)` };
    }

    if (!ensureString(artist) || !ensureString(track) || (album && !ensureString(album)) || (albumArtist && !ensureString(albumArtist))) {
        return { isValid: false, error: `Invalid data types at index ${index}: artist, track, album, and albumArtist must be strings under ${MAX_STRING_LENGTH} characters` };
    }

    if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
        return { isValid: false, error: `Invalid data type at index ${index}: timestamp must be an integer` };
    }

    return { isValid: true };
};

const validateBatchScrobbleTracks = (tracks) => {
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        return { isValid: false, error: 'Missing tracks array' };
    }

    if (tracks.length > 50) {
        return { isValid: false, error: 'Batch limit exceeded: Max 50 tracks per request' };
    }

    for (let i = 0; i < tracks.length; i++) {
        const validation = validateTrackData(tracks[i], i);
        if (!validation.isValid) {
            return validation;
        }
    }

    return { isValid: true };
};

const formatScrobbleParams = (trackData, sessionKey) => {
    const params = {
        artist: trackData.artist,
        track: trackData.track,
        timestamp: trackData.timestamp,
        sk: sessionKey
    };

    if (trackData.album) params.album = trackData.album;
    if (trackData.albumArtist) params.albumArtist = trackData.albumArtist;

    return params;
};

const formatBatchScrobbleParams = (tracks, sessionKey) => {
    const params = { sk: sessionKey };

    tracks.forEach((trackData, index) => {
        params[`artist[${index}]`] = trackData.artist;
        params[`track[${index}]`] = trackData.track;
        params[`timestamp[${index}]`] = trackData.timestamp;

        if (trackData.album) {
            params[`album[${index}]`] = trackData.album;
        }
        if (trackData.albumArtist) {
            params[`albumArtist[${index}]`] = trackData.albumArtist;
        }
    });

    return params;
};


const getDirectTrackAlbum = async (artist, track) => {
    const cacheKey = JSON.stringify(['track', artist, track]);
    const cachedData = albumCache.get(cacheKey);
    if (cachedData !== undefined) {
        return cachedData;
    }
    try {
        const data = await makeLastFmRequest('track.getInfo', { artist, track });
        const albumInfo = getAlbumInfoFromTrack(data.track);
        albumCache.set(cacheKey, albumInfo);
        return albumInfo;
    } catch (e) {
        console.warn('Direct lookup failed:', e.message);
        albumCache.set(cacheKey, null);
        return null;
    }
};

const getSearchTrackAlbums = async (artist, track) => {
    const searchData = await makeLastFmRequest('track.search', { track, artist, limit: 5 });
    const tracks = searchData?.results?.trackmatches?.track || [];

    const originalArtistLower = artist.toLowerCase();
    const originalTrackLower = track.toLowerCase();

    const uniqueTracks = [];
    const seenTracks = new Set();

    for (const t of tracks) {
        const tArtistLower = t.artist.toLowerCase();
        const tNameLower = t.name.toLowerCase();

        if (tArtistLower === originalArtistLower && tNameLower === originalTrackLower) {
            continue;
        }

        const mbid = t.mbid || '';
        const uniqueKey = mbid ? `mbid:${mbid}` : `name:${tArtistLower}|${tNameLower}`;

        if (!seenTracks.has(uniqueKey)) {
            seenTracks.add(uniqueKey);
            uniqueTracks.push(t);
        }
    }

    const matchAlbums = [];
    const chunkSize = 2; // Concurrency limit to avoid Last.fm rate limits (5 req/sec)

    for (let i = 0; i < uniqueTracks.length; i += chunkSize) {
        const chunk = uniqueTracks.slice(i, i + chunkSize);
        const chunkPromises = chunk.map(async (trackMatch) => {
            const cacheKey = trackMatch.mbid ? `track-mbid:${trackMatch.mbid}` : JSON.stringify(['track', trackMatch.artist, trackMatch.name]);
            const cachedData = albumCache.get(cacheKey);
            if (cachedData !== undefined) {
                return cachedData;
            }
            try {
                const params = {};
                if (trackMatch.mbid) {
                    params.mbid = trackMatch.mbid;
                } else {
                    params.artist = trackMatch.artist;
                    params.track = trackMatch.name;
                }

                const data = await makeLastFmRequest('track.getInfo', params);
                const albumInfo = getAlbumInfoFromTrack(data.track);
                albumCache.set(cacheKey, albumInfo);
                return albumInfo;
            } catch (e) {
                console.warn('Match lookup failed:', e.message);
                albumCache.set(cacheKey, null);
                return null;
            }
        });

        const chunkResults = await Promise.all(chunkPromises);
        matchAlbums.push(...chunkResults);
    }

    return matchAlbums;
};

const deduplicateAlbums = (albums) => {
    const uniqueAlbums = [];
    const seen = new Map();

    const nameCache = new Map();
    const artistCache = new Map();

    for (const album of albums) {
        let nameLower = nameCache.get(album.name);
        if (nameLower === undefined) {
            nameLower = album.name.toLowerCase();
            nameCache.set(album.name, nameLower);
        }

        let artistSet = seen.get(nameLower);
        if (!artistSet) {
            artistSet = new Set();
            seen.set(nameLower, artistSet);
        }

        let artistLower = artistCache.get(album.artist);
        if (artistLower === undefined) {
            artistLower = album.artist.toLowerCase();
            artistCache.set(album.artist, artistLower);
        }

        if (!artistSet.has(artistLower)) {
            artistSet.add(artistLower);
            uniqueAlbums.push(album);
        }
    }

    return uniqueAlbums;
};

const lookupTrackAlbums = async (artist, track) => {
    const directLookupPromise = getDirectTrackAlbum(artist, track);
    const searchAlbumsPromise = getSearchTrackAlbums(artist, track);

    const [directAlbum, searchAlbums] = await Promise.all([directLookupPromise, searchAlbumsPromise]);

    const allAlbums = [directAlbum, ...searchAlbums].filter(Boolean);

    return deduplicateAlbums(allAlbums);
};

// --- Routes ---

app.get('/api/login-url', (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${frontendUrl.replace(/\/$/, '')}/#`;
    const authUrl = `https://www.last.fm/api/auth/?api_key=${API_KEY}&cb=${encodeURIComponent(callbackUrl)}`;
    res.json({ url: authUrl });
});

app.post('/api/auth', async (req, res) => {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Token is required and must be a string' });
    }

    try {
        const sessionData = await makeLastFmRequest('auth.getSession', { token }, { signed: true });

        res.cookie('lastfm_session_key', sessionData.session.key, {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
            signed: true,
			maxAge: 90 * 24 * 60 * 60 * 1000
        });

        const safeSession = { ...sessionData.session };
        delete safeSession.key;

        try {
            const userData = await makeLastFmRequest('user.getInfo', { user: safeSession.name });
            if (userData.user?.image) {
                safeSession.image = userData.user.image;
            }
        } catch (imgError) {
            console.warn('Failed to fetch user image:', imgError.message);
        }

        res.json({ session: safeSession });
    } catch (error) {
        handleRouteError(res, error, 'Failed to authenticate with Last.fm');
    }
});

app.get('/api/check-auth', async (req, res) => {
    const sessionKey = req.signedCookies.lastfm_session_key;

    if (!sessionKey) {
        return res.json({ authenticated: false });
    }

    try {
        const data = await makeLastFmRequest('user.getInfo', { sk: sessionKey }, { signed: true });
        const user = data.user;

        res.json({
            authenticated: true,
            user: {
                name: user.name,
                image: user.image
            }
        });

    } catch (error) {
        const errData = sanitizeError(error);
        if (errData.responseData && (errData.responseData.error === 4 || errData.responseData.error === 9 || errData.responseData.error === 14)) {
            res.clearCookie('lastfm_session_key', { httpOnly: true, secure: true, sameSite: 'Strict', signed: true });
        }
        res.json({ authenticated: false });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('lastfm_session_key', { httpOnly: true, secure: true, sameSite: 'Strict', signed: true });
    res.json({ message: 'Logged out' });
});

app.post('/api/scrobble', async (req, res) => {
    const sessionKey = req.signedCookies.lastfm_session_key;

    if (!sessionKey) {
        return res.status(401).json({ error: 'Unauthorized: No session key found' });
    }

    const validationResult = validateScrobbleTrack(req.body);
    if (!validationResult.isValid) {
        return res.status(400).json({ error: validationResult.error });
    }

    try {
        const params = formatScrobbleParams(req.body, sessionKey);
        const data = await makeLastFmRequest('track.scrobble', params, { signed: true, httpMethod: 'POST' });
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to scrobble track');
    }
});

app.get('/api/lookup-track-albums', async (req, res) => {
    const { artist, track } = req.query;

    if (!ensureString(artist) || !ensureString(track)) {
        return res.status(400).json({ error: `Invalid parameters: artist and track must be strings under ${MAX_STRING_LENGTH} characters` });
    }

    if (artist === undefined || track === undefined || artist === '' || track === '') {
        return res.status(400).json({ error: 'Missing required parameters: artist and track' });
    }


    try {
        const uniqueAlbums = await lookupTrackAlbums(artist, track);
        res.json({ albums: uniqueAlbums });
    } catch (error) {
        handleRouteError(res, error, 'Failed to lookup albums');
    }
});

app.get('/api/search-album', async (req, res) => {
    const { query } = req.query;

    if (!ensureString(query)) {
        return res.status(400).json({ error: `Invalid query parameter: must be a string under ${MAX_STRING_LENGTH} characters` });
    }

    if (query === undefined || query === '') {
        return res.status(400).json({ error: 'Missing query parameter' });
    }

    try {
        const data = await makeLastFmRequest('album.search', { album: query });
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to search for albums');
    }
});

app.get('/api/get-album-info', async (req, res) => {
    const { artist, album, mbid } = req.query;

    const validation = validateAlbumInfoParams(artist, album, mbid);
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const cacheKey = mbid ? `mbid:${mbid}` : JSON.stringify(['album', artist, album]);
        const cachedData = albumCache.get(cacheKey);

        if (cachedData) {
            return res.json(cachedData);
        }

        const params = {};
        if (mbid) {
            params.mbid = mbid;
        } else {
            params.artist = artist;
            params.album = album;
        }

        const data = await makeLastFmRequest('album.getInfo', params);

        await enrichAlbumWithMusicBrainzFallback(data, artist, album, mbid);

        albumCache.set(cacheKey, data);
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to get album info');
    }
});

app.post('/api/scrobble-batch', async (req, res) => {
    const { tracks } = req.body;
    const sessionKey = req.signedCookies.lastfm_session_key;

    if (!sessionKey) {
        return res.status(401).json({ error: 'Unauthorized: No session key found' });
    }

    const validationResult = validateBatchScrobbleTracks(tracks);
    if (!validationResult.isValid) {
        return res.status(400).json({ error: validationResult.error });
    }

    try {
        const params = formatBatchScrobbleParams(tracks, sessionKey);
        const data = await makeLastFmRequest('track.scrobble', params, { signed: true, httpMethod: 'POST' });
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to scrobble batch');
    }
});

app.get('/api/get-recent-tracks', async (req, res) => {
    let { user, limit = 50, page = 1 } = req.query;

    if (!ensureString(user)) {
        return res.status(400).json({ error: `Invalid parameter: user must be a string under ${MAX_STRING_LENGTH} characters` });
    }

    if (user === undefined || user === '') {
        return res.status(400).json({ error: 'Missing required parameter: user' });
    }

    limit = Number.parseInt(limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    page = Number.parseInt(page, 10);
    if (Number.isNaN(page) || page < 1) page = 1;

    try {
        const data = await makeLastFmRequest('user.getRecentTracks', { user, limit, page });
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to get recent tracks');
    }
});


app.get('/api/health', (req, res) => {
    res.send('Last.ing Backend is running.');
});

module.exports = app;
