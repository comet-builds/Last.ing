const test = require('node:test');
const assert = require('node:assert/strict');

test('fetchAlbumsForTracks async worker pattern handles empty list', async () => {
    const uniqueTracks = [];
    const matchAlbums = new Array(uniqueTracks.length);
    const concurrency = 2;
    let index = 0;

    const worker = async () => {
        if (index >= uniqueTracks.length) {
            return;
        }
        return worker();
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, uniqueTracks.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    assert.deepEqual(matchAlbums.filter(album => album !== undefined), []);
});

test('fetchAlbumsForTracks async worker pattern processes tracks sequentially per worker concurrently', async () => {
    const uniqueTracks = [
        { name: 'Track 1', artist: 'Artist 1' },
        { name: 'Track 2', artist: 'Artist 2' },
        { name: 'Track 3', artist: 'Artist 3' },
        { name: 'Track 4', artist: 'Artist 4' },
    ];
    const matchAlbums = new Array(uniqueTracks.length);
    const concurrency = 2;
    let index = 0;
    const processedOrder = [];

    const worker = async () => {
        if (index >= uniqueTracks.length) {
            return;
        }

        const currentIndex = index++;
        const trackMatch = uniqueTracks[currentIndex];

        await new Promise(resolve => setTimeout(resolve, 10));
        processedOrder.push(trackMatch.name);
        matchAlbums[currentIndex] = { album: `Album for ${trackMatch.name}` };

        return worker();
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, uniqueTracks.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    assert.equal(matchAlbums.length, 4);
    assert.equal(matchAlbums[0].album, 'Album for Track 1');
    assert.equal(matchAlbums[1].album, 'Album for Track 2');
    assert.equal(matchAlbums[2].album, 'Album for Track 3');
    assert.equal(matchAlbums[3].album, 'Album for Track 4');
    assert.equal(processedOrder.length, 4);
});
