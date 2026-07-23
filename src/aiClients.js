/**
 * AI Clients - Connections to Grok (xAI) and Perplexity
 * Both providers expose OpenAI-compatible chat completion APIs,
 * so a single request helper serves both. Uses Node 18+ built-in fetch.
 */

const config = require('./config');
const logger = require('./logger');

/**
 * Sends a chat completion request to an OpenAI-compatible endpoint
 * @param {Object} provider - Provider config ({ apiKey, baseUrl, model })
 * @param {string} providerName - Human-readable provider name for errors
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} [options] - Optional overrides (model, temperature, maxTokens)
 * @returns {Promise<{content: string, model: string, usage: Object}>}
 */
async function chatCompletion(provider, providerName, messages, options = {}) {
    if (!provider.apiKey) {
        throw new Error(
            `${providerName} API key is not configured. Set it in your .env file.`
        );
    }

    const body = {
        model: options.model || provider.model,
        messages: messages
    };

    if (options.temperature !== undefined) {
        body.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
        body.max_tokens = options.maxTokens;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.timeout || config.ai.requestTimeout
    );

    let response;
    try {
        response = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`${providerName} request timed out`);
        }
        throw new Error(`${providerName} connection failed: ${error.message}`);
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
            `${providerName} API error (HTTP ${response.status}): ${errorText.slice(0, 500)}`
        );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (content === undefined) {
        throw new Error(`${providerName} returned an unexpected response format`);
    }

    return {
        content: content,
        model: data.model,
        usage: data.usage || {}
    };
}

/**
 * Sends a chat completion request to Grok (xAI)
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} [options] - Optional overrides
 * @returns {Promise<{content: string, model: string, usage: Object}>}
 */
async function askGrok(messages, options = {}) {
    return chatCompletion(config.ai.grok, 'Grok', messages, options);
}

/**
 * Sends a chat completion request to Perplexity
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} [options] - Optional overrides
 * @returns {Promise<{content: string, model: string, usage: Object}>}
 */
async function askPerplexity(messages, options = {}) {
    return chatCompletion(config.ai.perplexity, 'Perplexity', messages, options);
}

/**
 * Tests connectivity to a single provider with a minimal request
 * @param {string} name - Provider display name
 * @param {Function} ask - Provider ask function
 * @param {boolean} enabled - Whether the provider has an API key configured
 * @returns {Promise<{provider: string, connected: boolean, model: string|null, error: string|null}>}
 */
async function testProvider(name, ask, enabled) {
    if (!enabled) {
        return {
            provider: name,
            connected: false,
            model: null,
            error: 'API key not configured'
        };
    }

    try {
        const result = await ask(
            [{ role: 'user', content: 'Reply with the single word: ok' }],
            { maxTokens: 16, timeout: 30000 }
        );
        return {
            provider: name,
            connected: true,
            model: result.model,
            error: null
        };
    } catch (error) {
        return {
            provider: name,
            connected: false,
            model: null,
            error: error.message
        };
    }
}

/**
 * Tests connections to both Grok and Perplexity
 * @returns {Promise<Array>} Connection status for each provider
 */
async function testConnections() {
    logger.info('Testing AI provider connections');

    const results = await Promise.all([
        testProvider('Grok', askGrok, config.ai.grok.enabled),
        testProvider('Perplexity', askPerplexity, config.ai.perplexity.enabled)
    ]);

    results.forEach(result => {
        if (result.connected) {
            logger.success(`${result.provider}: connected (model: ${result.model})`);
        } else {
            logger.warn(`${result.provider}: not connected - ${result.error}`);
        }
    });

    return results;
}

module.exports = { askGrok, askPerplexity, testConnections };
