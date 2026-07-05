const config = require('../config');
const { claude } = require('./llm');
const { log } = require('./util');

// Turns a raw topic into a complete content package:
// narration script, per-platform titles/captions, hashtags, and visual search keywords.
async function generateScript(topic) {
    const c = config.channel;
    const wordsTarget = Math.round(c.targetDurationSec * 2.4); // ~2.4 spoken words/sec

    const system = `You are a viral short-form video scriptwriter for a faceless channel.
Channel: "${c.name}" — niche: ${c.niche}. Language: ${c.language}. Tone: ${c.tone}.
Rules:
- The first sentence MUST be a scroll-stopping hook (question, bold claim, or curiosity gap).
- Short punchy sentences. No emojis inside narration. No scene directions — narration text only.
- End with a light engagement prompt (follow / comment) in one short sentence.
- Target length: about ${wordsTarget} words (${c.targetDurationSec} seconds spoken).
Respond with ONLY valid JSON, no markdown fences, matching exactly this shape:
{
  "narration": "full narration text",
  "title": "YouTube title, <=90 chars, clickable but not clickbait-spam",
  "description": "YouTube description, 2-4 sentences + call to action",
  "hashtags": ["shorts", "..."],            // 8-12, no # prefix
  "igCaption": "Instagram caption with hook + hashtags inline",
  "ttCaption": "TikTok caption, short, with hashtags inline",
  "visualKeywords": ["...", "..."]          // 5 ENGLISH stock-footage search phrases matching the story beats, generic enough for stock sites
}`;

    log('script', `Generating script for topic: ${topic}`);
    const pkg = await claude(system, `Topic/idea for the next video:\n${topic}`);

    for (const field of ['narration', 'title', 'description', 'hashtags', 'igCaption', 'ttCaption', 'visualKeywords']) {
        if (!pkg[field]) throw new Error(`Script generation missing field "${field}"`);
    }
    pkg.hashtags = pkg.hashtags.map(h => String(h).replace(/^#/, ''));
    log('script', `Script ready: "${pkg.title}" (${pkg.narration.split(/\s+/).length} words)`);
    return pkg;
}

module.exports = { generateScript };
