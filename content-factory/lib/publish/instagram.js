const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { log, fetchJson, sleep } = require('../util');

const GRAPH = 'https://graph.facebook.com/v21.0';

// The Reels publishing API only accepts a public video URL, so we first host
// the file on Cloudinary (free tier, unsigned upload preset).
async function hostVideo(videoPath) {
    const { cloudName, uploadPreset } = config.instagram.cloudinary;
    if (!cloudName || !uploadPreset) {
        throw new Error('Instagram needs public video hosting: set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET (unsigned preset)');
    }
    log('instagram', 'Uploading video to Cloudinary for public hosting...');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), path.basename(videoPath));
    form.append('upload_preset', uploadPreset);
    const data = await fetchJson(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: form
    }, 'Cloudinary upload');
    return data.secure_url;
}

// Publishes a Reel via the Instagram Graph API (requires a Business/Creator
// account linked to a Facebook Page). Returns { id, url }.
async function publishInstagram({ videoPath, caption }) {
    const { accessToken, userId } = config.instagram;
    if (!accessToken || !userId) {
        throw new Error('Instagram not configured: set IG_ACCESS_TOKEN and IG_USER_ID');
    }

    const videoUrl = await hostVideo(videoPath);

    log('instagram', 'Creating Reel container...');
    const container = await fetchJson(`${GRAPH}/${userId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            media_type: 'REELS',
            video_url: videoUrl,
            caption,
            share_to_feed: true,
            access_token: accessToken
        })
    }, 'IG create container');

    // Wait for Instagram to fetch and process the video.
    for (let i = 0; i < 30; i++) {
        await sleep(10000);
        const status = await fetchJson(
            `${GRAPH}/${container.id}?fields=status_code&access_token=${accessToken}`,
            {}, 'IG container status'
        );
        if (status.status_code === 'FINISHED') break;
        if (status.status_code === 'ERROR') throw new Error('Instagram failed to process the video');
        log('instagram', `Processing... (${status.status_code})`);
    }

    const published = await fetchJson(`${GRAPH}/${userId}/media_publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: accessToken })
    }, 'IG publish');

    const url = `https://www.instagram.com/reel/${published.id}`;
    log('instagram', `Published Reel: ${published.id}`);
    return { id: published.id, url };
}

module.exports = { publishInstagram };
