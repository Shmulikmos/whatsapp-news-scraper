describe('aiClients', () => {
  let askGrok;
  let askPerplexity;
  let testConnections;

  const mockSuccessResponse = (content) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      model: 'test-model',
      usage: { total_tokens: 5 }
    })
  });

  beforeEach(() => {
    jest.resetModules();
    process.env.GROK_API_KEY = 'test-grok-key';
    process.env.PERPLEXITY_API_KEY = 'test-pplx-key';
    global.fetch = jest.fn();

    ({ askGrok, askPerplexity, testConnections } = require('../src/aiClients'));
  });

  afterEach(() => {
    delete process.env.GROK_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete global.fetch;
  });

  describe('askGrok', () => {
    test('should send request to xAI endpoint with API key', async () => {
      global.fetch.mockResolvedValue(mockSuccessResponse('hello'));

      const result = await askGrok([{ role: 'user', content: 'hi' }]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.x.ai/v1/chat/completions');
      expect(options.headers['Authorization']).toBe('Bearer test-grok-key');
      expect(JSON.parse(options.body).model).toBe('grok-4-fast');
      expect(result.content).toBe('hello');
      expect(result.model).toBe('test-model');
    });

    test('should throw when API key is missing', async () => {
      delete process.env.GROK_API_KEY;
      jest.resetModules();
      ({ askGrok } = require('../src/aiClients'));

      await expect(askGrok([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Grok API key is not configured');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should throw descriptive error on HTTP failure', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid key'
      });

      await expect(askGrok([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Grok API error (HTTP 401): invalid key');
    });

    test('should throw on unexpected response format', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] })
      });

      await expect(askGrok([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Grok returned an unexpected response format');
    });

    test('should wrap network errors', async () => {
      global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(askGrok([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Grok connection failed: ECONNREFUSED');
    });
  });

  describe('askPerplexity', () => {
    test('should send request to Perplexity endpoint with API key', async () => {
      global.fetch.mockResolvedValue(mockSuccessResponse('world'));

      const result = await askPerplexity([{ role: 'user', content: 'hi' }]);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.perplexity.ai/chat/completions');
      expect(options.headers['Authorization']).toBe('Bearer test-pplx-key');
      expect(JSON.parse(options.body).model).toBe('sonar');
      expect(result.content).toBe('world');
    });

    test('should pass model and maxTokens overrides', async () => {
      global.fetch.mockResolvedValue(mockSuccessResponse('ok'));

      await askPerplexity(
        [{ role: 'user', content: 'hi' }],
        { model: 'sonar-pro', maxTokens: 100, temperature: 0.2 }
      );

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.model).toBe('sonar-pro');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.2);
    });
  });

  describe('testConnections', () => {
    test('should report both providers connected on success', async () => {
      global.fetch.mockResolvedValue(mockSuccessResponse('ok'));

      const results = await testConnections();

      expect(results).toHaveLength(2);
      expect(results.map(r => r.provider)).toEqual(['Grok', 'Perplexity']);
      expect(results.every(r => r.connected)).toBe(true);
    });

    test('should report unconfigured providers without calling the API', async () => {
      delete process.env.GROK_API_KEY;
      delete process.env.PERPLEXITY_API_KEY;
      jest.resetModules();
      ({ testConnections } = require('../src/aiClients'));

      const results = await testConnections();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(results.every(r => !r.connected)).toBe(true);
      expect(results.every(r => r.error === 'API key not configured')).toBe(true);
    });

    test('should report failure when a provider errors', async () => {
      global.fetch
        .mockResolvedValueOnce(mockSuccessResponse('ok'))
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'server error'
        });

      const results = await testConnections();

      const grok = results.find(r => r.provider === 'Grok');
      const perplexity = results.find(r => r.provider === 'Perplexity');
      expect(grok.connected).toBe(true);
      expect(perplexity.connected).toBe(false);
      expect(perplexity.error).toContain('HTTP 500');
    });
  });
});
