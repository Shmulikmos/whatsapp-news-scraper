const fs = require('fs');
const config = require('../../config');
const { log, fetchJson, sleep } = require('../util');

const API = 'https://open.tiktokapis.com/v2';

// Publishes via the TikTok Content Posting API (Direct Post).
// Requires an approved TikTok developer app with video.publish scope —
// unaudited apps can only post as SELF_ONLY (private) until approval.
async function publishTikTok({ videoPath, caption }) {
    const { accessToken, privacyLevel } = config.tiktok;
    if (!accessToken) throw new Error('TikTok not configured: set TT_ACCESS_TOKEN');

    const buf = fs.readFileSync(videoPath);
    log('tiktok', `Initializing upload (${(buf.length / 1e6).toFixed(1)} MB)...`);

    const init = await fetchJson(`${API}/post/publish/video/init/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            post_info: {
                title: caption.slice(0, 2200),
                privacy_level: privacyLevel,
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false
            },
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: buf.length,
                chunk_size: buf.length,
                total_chunk_count: 1
            }
        })
    }, 'TikTok init');

    const { publish_id, upload_url } = init.data || {};
    if (!upload_url) throw new Error(`TikTok init returned no upload_url: ${JSON.stringify(init).slice(0, 300)}`);

    log('tiktok', 'Uploading video file...');
    const up = await fetch(upload_url, {
        method: 'PUT',
        headers: {
            'content-type': 'video/mp4',
            'content-length': String(buf.length),
            'content-range': `bytes 0-${buf.length - 1}/${buf.length}`
        },
        body: buf
    });
    if (!up.ok) throw new Error(`TikTok upload failed (HTTP ${up.status}): ${(await up.text()).slice(0, 300)}`);

    // Poll publish status until TikTok finishes processing.
    for (let i = 0; i < 30; i++) {
        await sleep(10000);
        const status = await fetchJson(`${API}/post/publish/status/fetch/`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ publish_id })
        }, 'TikTok status');
        const s = status.data?.status;
        if (s === 'PUBLISH_COMPLETE') {
            log('tiktok', `Published (publish_id ${publish_id})`);
            return { id: publish_id, url: 'https://www.tiktok.com/@me' };
        }
        if (s === 'FAILED') throw new Error(`TikTok publish failed: ${status.data?.fail_reason || 'unknown'}`);
        log('tiktok', `Processing... (${s})`);
    }
    throw new Error('TikTok publish timed out while processing');
}

module.exports = { publishTikTok };
