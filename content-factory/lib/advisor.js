const config = require('../config');
const { claude } = require('./llm');
const { log } = require('./util');
const { loadPublished, savePublished, addTopic, loadQueue } = require('./queue');
const { writeReport } = require('./analytics');

// The scaling loop: Claude reviews what performed, explains why, and queues
// the next batch of topics — so the channel keeps producing without input.
async function runAdvisor({ topicsToAdd = 7 } = {}) {
    const p = loadPublished();
    const q = loadQueue();
    const c = config.channel;

    const performance = p.videos.map(v => ({
        topic: v.topic,
        title: v.title,
        publishedAt: v.publishedAt,
        views: v.stats?.views ?? null,
        likes: v.stats?.likes ?? null,
        comments: v.stats?.comments ?? null
    }));
    const pendingTopics = q.topics.filter(t => t.status === 'pending').map(t => t.topic);

    const system = `You are a growth strategist for a faceless short-form video channel.
Channel: "${c.name}" — niche: ${c.niche}. Language of content: ${c.language}.
You will receive performance data. Analyze what works (hooks, subjects, formats), what doesn't, and propose the next topics.
Topics must fit the niche, avoid duplicating pending/published topics, and favor patterns that got the most views.
Respond with ONLY valid JSON, no markdown fences:
{
  "summary": "3-6 sentence analysis of performance and the strategy for next videos (markdown allowed)",
  "topics": ["topic idea 1", "..."]   // exactly ${topicsToAdd} new video topic ideas
}`;

    log('advisor', 'Asking Claude to analyze performance and plan next topics...');
    const advice = await claude(system, JSON.stringify({
        publishedVideos: performance,
        pendingQueueTopics: pendingTopics
    }));

    for (const t of advice.topics || []) addTopic(t, { source: 'advisor' });
    p.advice = { summary: advice.summary, at: new Date().toISOString() };
    savePublished(p);
    writeReport(p);

    log('advisor', `Added ${(advice.topics || []).length} new topics to the queue.`);
    console.log('\n--- Growth advice ---\n' + advice.summary + '\n');
    return advice;
}

module.exports = { runAdvisor };
