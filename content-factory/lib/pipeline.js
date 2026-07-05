const path = require('path');
const config = require('../config');
const { log, ensureDir, slugify, writeJson } = require('./util');
const { generateScript } = require('./script');
const { synthesize } = require('./tts');
const { gatherClips } = require('./visuals');
const { assembleVideo } = require('./video');
const { publishYouTube } = require('./publish/youtube');
const { publishInstagram } = require('./publish/instagram');
const { publishTikTok } = require('./publish/tiktok');
const { updateTopic, recordPublished } = require('./queue');

// Runs one topic end-to-end: script → voiceover → footage → render → publish.
// dryRun stops after rendering (no uploads) so you can review output first.
async function runTopic(topicEntry, { dryRun = false } = {}) {
    const workdir = ensureDir(path.join(config.paths.workdir, `${topicEntry.id}-${slugify(topicEntry.topic)}`));
    log('pipeline', `=== Processing "${topicEntry.topic}" (${topicEntry.id}) ===`);
    updateTopic(topicEntry.id, { status: 'processing', startedAt: new Date().toISOString() });

    try {
        // 1. Content package
        const pkg = await generateScript(topicEntry.topic);
        writeJson(path.join(workdir, 'package.json'), pkg);

        // 2. Voiceover
        const voiceover = await synthesize(pkg.narration, workdir);

        // 3. Stock footage (optional — falls back to generated background)
        const clips = await gatherClips(pkg.visualKeywords, workdir);

        // 4. Render
        const videoPath = assembleVideo({
            clips,
            voiceover,
            narration: pkg.narration,
            workdir,
            outName: 'final.mp4'
        });

        if (dryRun) {
            updateTopic(topicEntry.id, { status: 'rendered', videoPath });
            log('pipeline', `Dry run complete — video at ${videoPath} (not published).`);
            return { videoPath, pkg, results: {} };
        }

        // 5. Publish to every enabled platform; one platform failing doesn't block the others.
        const results = {};
        const errors = [];
        const targets = [
            ['youtube', config.youtube.enabled, () => publishYouTube({
                videoPath, title: pkg.title, description: pkg.description, hashtags: pkg.hashtags
            })],
            ['instagram', config.instagram.enabled, () => publishInstagram({ videoPath, caption: pkg.igCaption })],
            ['tiktok', config.tiktok.enabled, () => publishTikTok({ videoPath, caption: pkg.ttCaption })]
        ];

        for (const [name, enabled, fn] of targets) {
            if (!enabled) {
                log('pipeline', `${name}: skipped (not configured)`);
                continue;
            }
            try {
                results[name] = await fn();
            } catch (err) {
                errors.push(`${name}: ${err.message}`);
                log('pipeline', `${name} FAILED: ${err.message}`);
            }
        }

        const publishedAnywhere = Object.keys(results).length > 0;
        recordPublished({
            topicId: topicEntry.id,
            topic: topicEntry.topic,
            title: pkg.title,
            publishedAt: new Date().toISOString(),
            platforms: results,
            errors
        });
        updateTopic(topicEntry.id, {
            status: publishedAnywhere ? 'published' : 'failed',
            finishedAt: new Date().toISOString(),
            error: errors.join(' | ') || undefined
        });

        log('pipeline', `=== Done: ${Object.keys(results).join(', ') || 'nothing published'} ===`);
        return { videoPath, pkg, results, errors };
    } catch (err) {
        updateTopic(topicEntry.id, { status: 'failed', error: err.message, finishedAt: new Date().toISOString() });
        throw err;
    }
}

module.exports = { runTopic };
