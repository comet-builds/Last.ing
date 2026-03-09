const DUPLICATE_WINDOW_SECONDS = 300;

function filterHistoryTracks_baseline(tracks, showNoAlbum, showDuplicates) {
    let filteredTracks = tracks.filter(track => track['@attr']?.nowplaying !== 'true');

    if (showNoAlbum) {
        filteredTracks = filteredTracks.filter(track => !track.album?.['#text']);
    }

    if (showDuplicates) {
        const duplicates = new Set();
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

    return filteredTracks;
}

function filterHistoryTracks_optimized(tracks, showNoAlbum, showDuplicates) {
    let filteredTracks = tracks.filter(track => track['@attr']?.nowplaying !== 'true');

    if (showNoAlbum) {
        filteredTracks = filteredTracks.filter(track => !track.album?.['#text']);
    }

    if (showDuplicates) {
        const result = [];
        let inDupSequence = false;

        for (let i = 0; i < filteredTracks.length - 1; i++) {
            const current = filteredTracks[i];
            const next = filteredTracks[i+1];

            if (current.name === next.name && current.artist['#text'] === next.artist['#text']) {
                 const timeDiff = Math.abs(Number.parseInt(current.date.uts) - Number.parseInt(next.date.uts));
                 if (timeDiff < DUPLICATE_WINDOW_SECONDS) {
                     if (!inDupSequence) {
                         result.push(current);
                     }
                     result.push(next);
                     inDupSequence = true;
                     continue;
                 }
            }
            inDupSequence = false;
        }
        filteredTracks = result;
    }

    return filteredTracks;
}

// Generate mock data
const mockTracks = [];
const numTracks = 50000;
let currentTime = 1600000000;

for (let i = 0; i < numTracks; i++) {
    const isDup = Math.random() < 0.2; // 20% chance of being a duplicate of the previous
    const trackName = isDup ? `Track ${i-1}` : `Track ${i}`;
    const artistName = isDup ? `Artist ${i-1}` : `Artist ${i}`;

    // Increment time by a random amount, small if dup to trigger window
    currentTime += isDup ? Math.floor(Math.random() * 200) : Math.floor(Math.random() * 1000 + 400);

    mockTracks.push({
        name: trackName,
        artist: { '#text': artistName },
        album: { '#text': `Album ${i}` },
        date: { uts: currentTime.toString() }
    });
}

// Warmup
for (let i = 0; i < 20; i++) {
    filterHistoryTracks_baseline(mockTracks, false, true);
    filterHistoryTracks_optimized(mockTracks, false, true);
}

// Benchmark
console.log("Benchmarking with", numTracks, "tracks, running 100 iterations...");

const startBaseline = performance.now();
for (let i = 0; i < 100; i++) {
    filterHistoryTracks_baseline(mockTracks, false, true);
}
const endBaseline = performance.now();

const startOptimized = performance.now();
for (let i = 0; i < 100; i++) {
    filterHistoryTracks_optimized(mockTracks, false, true);
}
const endOptimized = performance.now();

const baseLineTime = endBaseline - startBaseline;
const optimizedTime = endOptimized - startOptimized;

console.log("Baseline:", baseLineTime.toFixed(2), "ms");
console.log("Optimized:", optimizedTime.toFixed(2), "ms");
console.log("Improvement:", ((baseLineTime - optimizedTime) / baseLineTime * 100).toFixed(2), "%");
