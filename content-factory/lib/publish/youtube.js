const fs = require('fs');
const { google } = require('googleapis');
const config = require('../../config');
const { log } = require('../util');

function getClient() {
    const { clientId, clientSecret, refreshToken } = config.youtube;
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('YouTube not configured: set YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (run: node content-factory/cli.js auth-youtube)');
    }
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'http://127.0.0.1:8089/oauth2callback');
    oauth2.setCredentials({ refresh_token: refreshToken });
    return google.youtube({ version: 'v3', auth: oauth2 });
}

// Uploads a video as a YouTube Short. Returns { id, url }.
async function publishYouTube({ videoPath, title, description, hashtags }) {
    const yt = getClient();
    log('youtube', `Uploading "${title}"...`);

    const res = await yt.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
            snippet: {
                title: title.slice(0, 100),
                description: `${description}\n\n${hashtags.slice(0, 15).map(h => '#' + h).join(' ')}`,
                categoryId: config.youtube.categoryId,
                tags: hashtags.slice(0, 30)
            },
            status: {
                privacyStatus: config.youtube.privacyStatus,
                selfDeclaredMadeForKids: false
            }
        },
        media: { body: fs.createReadStream(videoPath) }
    });

    const id = res.data.id;
    const url = `https://www.youtube.com/shorts/${id}`;
    log('youtube', `Published: ${url}`);
    return { id, url };
}

// Fetches view/like/comment counts for a batch of video IDs.
async function fetchStats(videoIds) {
    if (videoIds.length === 0) return {};
    const yt = getClient();
    const stats = {};
    for (let i = 0; i < videoIds.length; i += 50) {
        const res = await yt.videos.list({ part: ['statistics'], id: videoIds.slice(i, i + 50) });
        for (const item of res.data.items || []) {
            const s = item.statistics || {};
            stats[item.id] = {
                views: parseInt(s.viewCount) || 0,
                likes: parseInt(s.likeCount) || 0,
                comments: parseInt(s.commentCount) || 0
            };
        }
    }
    return stats;
}

module.exports = { publishYouTube, fetchStats };
