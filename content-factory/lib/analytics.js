const fs = require('fs');
const config = require('../config');
const { log } = require('./util');
const { loadPublished, savePublished } = require('./queue');
const { fetchStats } = require('./publish/youtube');

// Refreshes YouTube stats for every published video and appends a snapshot to
// each entry's history (Instagram/TikTok stats need extra API permissions, so
// YouTube is the primary growth signal for now).
async function refreshAnalytics() {
    const p = loadPublished();
    const ytVideos = p.videos.filter(v => v.platforms?.youtube?.id);
    if (ytVideos.length === 0) {
        log('analytics', 'No published YouTube videos yet.');
        return p;
    }

    log('analytics', `Fetching stats for ${ytVideos.length} YouTube videos...`);
    const stats = await fetchStats(ytVideos.map(v => v.platforms.youtube.id));
    const now = new Date().toISOString();
    for (const v of ytVideos) {
        const s = stats[v.platforms.youtube.id];
        if (!s) continue;
        v.stats = { ...s, updatedAt: now };
        v.statsHistory = [...(v.statsHistory || []), { ...s, at: now }].slice(-60);
    }
    savePublished(p);
    writeReport(p);
    return p;
}

// Writes REPORT.md — the at-a-glance channel dashboard, committed to the repo.
function writeReport(p) {
    const rows = [...p.videos]
        .sort((a, b) => (b.stats?.views || 0) - (a.stats?.views || 0))
        .map(v => {
            const yt = v.platforms?.youtube;
            const s = v.stats || {};
            return `| ${v.title || v.topic} | ${v.publishedAt.slice(0, 10)} | ${s.views ?? '-'} | ${s.likes ?? '-'} | ${s.comments ?? '-'} | ${yt ? `[link](${yt.url})` : '-'} |`;
        });

    const totals = p.videos.reduce((acc, v) => {
        acc.views += v.stats?.views || 0;
        acc.likes += v.stats?.likes || 0;
        return acc;
    }, { views: 0, likes: 0 });

    const md = `# Channel Report

_Updated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC_

**Videos published:** ${p.videos.length} · **Total YouTube views:** ${totals.views} · **Total likes:** ${totals.likes}

| Title | Published | Views | Likes | Comments | YouTube |
|---|---|---|---|---|---|
${rows.join('\n') || '| _nothing published yet_ | | | | | |'}

${p.advice ? `## Latest growth advice (AI)\n\n_${p.advice.at?.slice(0, 10)}_\n\n${p.advice.summary}\n` : ''}`;

    fs.writeFileSync(config.paths.report, md);
    log('analytics', `Report written to ${config.paths.report}`);
}

module.exports = { refreshAnalytics, writeReport };
