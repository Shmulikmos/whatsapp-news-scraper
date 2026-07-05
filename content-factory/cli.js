#!/usr/bin/env node
// Content Factory CLI — automated faceless channel pipeline.
// Usage:
//   node content-factory/cli.js add "topic or idea"     add a topic to the queue
//   node content-factory/cli.js queue                   show the queue
//   node content-factory/cli.js run [--dry] [--count N] produce & publish next N pending topics
//   node content-factory/cli.js analytics               refresh stats + REPORT.md
//   node content-factory/cli.js advise                  AI growth analysis + auto-queue new topics
//   node content-factory/cli.js auth-youtube            one-time YouTube OAuth setup
//   node content-factory/cli.js status                  config / platform readiness check

const config = require('./config');
const { loadQueue, addTopic, nextPending } = require('./lib/queue');

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    const flags = new Set(rest.filter(a => a.startsWith('--')));
    const positional = rest.filter(a => !a.startsWith('--'));
    const flagValue = name => {
        const i = rest.indexOf(name);
        return i >= 0 ? rest[i + 1] : undefined;
    };

    switch (cmd) {
        case 'add': {
            const topic = positional.join(' ').trim();
            if (!topic) { console.error('Usage: cli.js add "topic or idea"'); process.exit(1); }
            const id = addTopic(topic);
            console.log(`Added to queue: ${id} — "${topic}"`);
            break;
        }

        case 'queue': {
            const q = loadQueue();
            if (q.topics.length === 0) { console.log('Queue is empty. Add topics with: cli.js add "..."'); break; }
            for (const t of q.topics) {
                console.log(`${t.status.padEnd(10)} ${t.id}  [${t.source}]  ${t.topic}${t.error ? `  (error: ${t.error})` : ''}`);
            }
            break;
        }

        case 'run': {
            const { runTopic } = require('./lib/pipeline');
            const count = parseInt(flagValue('--count')) || 1;
            const dryRun = flags.has('--dry');
            let done = 0;
            for (let i = 0; i < count; i++) {
                const next = nextPending();
                if (!next) { console.log(done ? 'Queue drained.' : 'No pending topics in the queue. Add one with: cli.js add "..."'); break; }
                await runTopic(next, { dryRun });
                done++;
            }
            break;
        }

        case 'analytics': {
            const { refreshAnalytics } = require('./lib/analytics');
            await refreshAnalytics();
            break;
        }

        case 'advise': {
            const { runAdvisor } = require('./lib/advisor');
            const n = parseInt(flagValue('--topics')) || 7;
            await runAdvisor({ topicsToAdd: n });
            break;
        }

        case 'auth-youtube': {
            const { authYouTube } = require('./lib/publish/authYoutube');
            await authYouTube();
            break;
        }

        case 'status': {
            const checks = [
                ['Claude (scripts/advisor)', !!config.anthropic.apiKey],
                [`TTS voice (${config.tts.provider})`, !!(config.tts.elevenlabs.apiKey || config.tts.openai.apiKey)],
                ['Pexels stock footage', !!config.pexels.apiKey],
                ['YouTube publishing', config.youtube.enabled && !!config.youtube.refreshToken],
                ['Instagram publishing', config.instagram.enabled && !!config.instagram.userId],
                ['  └ Cloudinary hosting', !!config.instagram.cloudinary.cloudName],
                ['TikTok publishing', config.tiktok.enabled]
            ];
            console.log(`Channel: ${config.channel.name} — ${config.channel.niche} (${config.channel.language})\n`);
            for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
            console.log('\nRequired minimum to produce a video: Claude + one TTS provider.');
            break;
        }

        default:
            console.log('Commands: add | queue | run [--dry] [--count N] | analytics | advise [--topics N] | auth-youtube | status');
            process.exit(cmd ? 1 : 0);
    }
}

main().catch(err => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
});
