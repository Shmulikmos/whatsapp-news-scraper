const config = require('../config');
const { fetchJson } = require('./util');

// Minimal Claude API client (Messages API, no SDK dependency).
async function claude(system, userPrompt, { json = true } = {}) {
    if (!config.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set — required for script generation and the growth advisor.');
    }
    const body = {
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system,
        messages: [{ role: 'user', content: userPrompt }]
    };
    const data = await fetchJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': config.anthropic.apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
    }, 'Claude API');

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!json) return text;

    // Models occasionally wrap JSON in a code fence — strip it before parsing.
    const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try {
        return JSON.parse(cleaned);
    } catch (err) {
        throw new Error(`Claude returned non-JSON output: ${text.slice(0, 300)}`);
    }
}

module.exports = { claude };
