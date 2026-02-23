const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('node:crypto');
const https = require('node:https');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://last-ing.vercel.app';

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
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

const API_KEY = process.env.LASTFM_API_KEY;
const SHARED_SECRET = process.env.LASTFM_SHARED_SECRET;
const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

const agent = new https.Agent({ keepAlive: true });
const apiClient = axios.create({
    httpsAgent: agent,
    timeout: 30000
});

// --- Helper Functions ---

const signParams = (params) => {
    const sortedKeys = Object.keys(params).sort();
    let signatureString = '';

    sortedKeys.forEach(key => {
        if (key !== 'format' && key !== 'callback') {
             signatureString += key + params[key];
        }
    });

    signatureString += SHARED_SECRET;
    return crypto.createHash('md5').update(signatureString).digest('hex');
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
    console.error(`${contextMessage}:`, sanitizeError(error));
    const status = error.response?.status || 500;

    if (status === 400 && error.response?.data) {
         return res.status(400).json(error.response.data);
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

// --- Routes ---

app.get('/api/login-url', (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }
    const authUrl = `https://www.last.fm/api/auth/?api_key=${API_KEY}&cb=${encodeURIComponent(FRONTEND_URL)}`;
    res.json({ url: authUrl });
});

app.post('/api/auth', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }

    try {
        const sessionData = await makeLastFmRequest('auth.getSession', { token }, { signed: true });

        res.cookie('lastfm_session_key', sessionData.session.key, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict'
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
    const sessionKey = req.cookies.lastfm_session_key;

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
            res.clearCookie('lastfm_session_key');
        }
        res.json({ authenticated: false });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('lastfm_session_key');
    res.json({ message: 'Logged out' });
});

app.post('/api/scrobble', async (req, res) => {
    const { artist, track, album, albumArtist, timestamp } = req.body;
    const sessionKey = req.cookies.lastfm_session_key;

    if (!sessionKey) {
        return res.status(401).json({ error: 'Unauthorized: No session key found' });
    }

    if (!artist || !track || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields (artist, track, timestamp)' });
    }

    if (typeof artist !== 'string' || typeof track !== 'string' || (album && typeof album !== 'string') || (albumArtist && typeof albumArtist !== 'string')) {
        return res.status(400).json({ error: 'Invalid data types: artist, track, album, and albumArtist must be strings' });
    }

    if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
        return res.status(400).json({ error: 'Invalid data type: timestamp must be an integer' });
    }

    try {
        const params = {
            artist,
            track,
            timestamp,
            sk: sessionKey
        };

        if (album) params.album = album;
        if (albumArtist) params.albumArtist = albumArtist;

        const data = await makeLastFmRequest('track.scrobble', params, { signed: true, httpMethod: 'POST' });
        return res.json(data);

    } catch (error) {
        handleRouteError(res, error, 'Failed to scrobble track');
    }
});

app.get('/api/lookup-track-albums', async (req, res) => {
    const { artist, track } = req.query;

    if (!artist || !track) {
        return res.status(400).json({ error: 'Missing required parameters: artist and track' });
    }

    try {
        const directLookupPromise = (async () => {
            try {
                const data = await makeLastFmRequest('track.getInfo', { artist, track });
                return getAlbumInfoFromTrack(data.track);
            } catch (e) {
                console.warn('Direct lookup failed:', e.message);
                return null;
            }
        })();

        const searchResponsePromise = makeLastFmRequest('track.search', { track, artist, limit: 5 });

        const [directAlbum, searchData] = await Promise.all([directLookupPromise, searchResponsePromise]);
        const tracks = searchData?.results?.trackmatches?.track || [];

        const matchPromises = tracks.map(async (trackMatch) => {
            try {
                const params = {};
                if (trackMatch.mbid) {
                    params.mbid = trackMatch.mbid;
                } else {
                    params.artist = trackMatch.artist;
                    params.track = trackMatch.name;
                }

                const data = await makeLastFmRequest('track.getInfo', params);
                return getAlbumInfoFromTrack(data.track);
            } catch (e) {
                console.warn('Match lookup failed:', e.message);
                return null;
            }
        });

        const matchAlbums = await Promise.all(matchPromises);
        const allAlbums = [directAlbum, ...matchAlbums].filter(Boolean);

        const uniqueAlbums = [];
        const seen = new Set();

        for (const album of allAlbums) {
            const key = `${album.name.toLowerCase()}:${album.artist.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueAlbums.push(album);
            }
        }

        res.json({ albums: uniqueAlbums });

    } catch (error) {
        handleRouteError(res, error, 'Failed to lookup albums');
    }
});

app.get('/api/search-album', async (req, res) => {
    const { query } = req.query;

    if (!query) {
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

    if ((!artist || !album) && !mbid) {
        return res.status(400).json({ error: 'Missing required parameters: (artist and album) or mbid' });
    }

    try {
        const params = {};
        if (mbid) {
            params.mbid = mbid;
        } else {
            params.artist = artist;
            params.album = album;
        }

        const data = await makeLastFmRequest('album.getInfo', params);
        return res.json(data);
    } catch (error) {
        handleRouteError(res, error, 'Failed to get album info');
    }
});

app.post('/api/scrobble-batch', async (req, res) => {
    const { tracks } = req.body;
    const sessionKey = req.cookies.lastfm_session_key;

    if (!sessionKey) {
        return res.status(401).json({ error: 'Unauthorized: No session key found' });
    }

    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        return res.status(400).json({ error: 'Missing tracks array' });
    }

    if (tracks.length > 50) {
        return res.status(400).json({ error: 'Batch limit exceeded: Max 50 tracks per request' });
    }

    try {
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

        const data = await makeLastFmRequest('track.scrobble', params, { signed: true, httpMethod: 'POST' });
        return res.json(data);

    } catch (error) {
        handleRouteError(res, error, 'Failed to scrobble batch');
    }
});

app.get('/api/get-recent-tracks', async (req, res) => {
    const { user, limit = 50, page = 1 } = req.query;

    if (!user) {
        return res.status(400).json({ error: 'Missing required parameter: user' });
    }

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
