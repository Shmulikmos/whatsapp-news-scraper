const path = require('path');
const config = require('../config');
const { log, fetchJson, downloadFile, ensureDir } = require('./util');

// Fetches portrait stock clips from Pexels for each visual keyword.
// Returns a list of local file paths; empty list means "render on a plain background".
async function gatherClips(visualKeywords, workdir) {
    const apiKey = config.pexels.apiKey;
    if (!apiKey) {
        log('visuals', 'PEXELS_API_KEY not set — will render on a generated background instead of stock footage.');
        return [];
    }

    const clipsDir = ensureDir(path.join(workdir, 'clips'));
    const wanted = config.pexels.clipsPerVideo;
    const clips = [];
    const usedIds = new Set();

    for (const keyword of visualKeywords) {
        if (clips.length >= wanted) break;
        try {
            const data = await fetchJson(
                `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&size=medium&per_page=5`,
                { headers: { Authorization: apiKey } },
                `Pexels search "${keyword}"`
            );
            const video = (data.videos || []).find(v => !usedIds.has(v.id));
            if (!video) continue;
            usedIds.add(video.id);

            // Prefer a portrait HD file that isn't gigantic.
            const files = (video.video_files || [])
                .filter(f => f.height >= f.width && f.height >= 1000)
                .sort((a, b) => a.height - b.height);
            const file = files[0] || (video.video_files || [])[0];
            if (!file) continue;

            const dest = path.join(clipsDir, `clip-${clips.length}.mp4`);
            log('visuals', `Downloading clip for "${keyword}" (pexels #${video.id})...`);
            await downloadFile(file.link, dest);
            clips.push(dest);
        } catch (err) {
            log('visuals', `Skipping keyword "${keyword}": ${err.message}`);
        }
    }

    log('visuals', `Collected ${clips.length} stock clips.`);
    return clips;
}

module.exports = { gatherClips };
