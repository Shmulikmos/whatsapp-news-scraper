/**
 * End-to-end pipeline test with every I/O boundary mocked:
 * no yt-dlp subprocess, no GitHub network call, no Anthropic request, no Sheets.
 * The archive is written to a real temp directory and read back.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

// Config is read at require time, so the archive must be redirected before any
// module under test is imported - not in beforeAll, which runs too late.
const tempArchive = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
process.env.VIDEO_ARCHIVE_DIR = tempArchive;
process.env.VIDEO_SHEET_ID = '';
process.env.GOOGLE_SHEET_ID = '';

afterAll(async () => {
  await fsp.rm(tempArchive, { recursive: true, force: true });
});

const METADATA = {
  title: 'בניית סוכני AI עם Claude',
  description: 'הקוד: https://github.com/anthropics/claude-code\nמדריך: https://docs.claude.com\n00:00 מבוא\n02:30 דמו',
  channel: 'ערוץ הפיתוח',
  channelUrl: 'https://youtube.com/@dev',
  publishedAt: '2026-08-01',
  durationSec: 900,
  viewCount: 5000,
  likeCount: 300,
  thumbnail: '',
  tags: ['ai'],
  categories: ['Science & Technology'],
  language: 'he',
  chapters: [],
  availableSubtitles: ['he'],
  availableAutoCaptions: []
};

const SUBTITLE_VTT = [
  'WEBVTT',
  '',
  '00:00:01.000 --> 00:00:05.000',
  'ברוכים הבאים, היום נבנה סוכן AI',
  '',
  '00:00:05.000 --> 00:00:10.000',
  'הקוד נמצא ב github.com/anthropics/claude-code'
].join('\n');

const SUMMARY = {
  tldr: 'הסרטון מדגים בניית סוכן AI מבוסס Claude מאפס.',
  keyPoints: ['התקנת ה-SDK', 'הגדרת כלים', 'הרצת לולאת הסוכן'],
  topics: [
    { name: 'AI agents', relevance: 'primary', why: 'הסרטון כולו על בניית סוכן' },
    { name: 'פיתוח', relevance: 'secondary', why: 'מדריך קוד מעשי' }
  ],
  actionItems: ['להתקין את ה-SDK', 'לשכפל את הריפו'],
  toolsMentioned: [{ name: 'Claude', note: 'המודל שמריץ את הסוכן' }],
  people: ['ערוץ הפיתוח'],
  contentType: 'tutorial',
  language: 'Hebrew',
  confidence: 'high',
  injectionAttempt: false
};

jest.mock('../../src/video/extractor', () => {
  const actual = jest.requireActual('../../src/video/extractor');
  return {
    ...actual,
    fetchMetadata: jest.fn(),
    fetchSubtitles: jest.fn(),
    fetchAudio: jest.fn(),
    createWorkDir: jest.fn(async () => '/tmp/fake-workdir'),
    cleanupWorkDir: jest.fn(async () => {})
  };
});

jest.mock('../../src/video/githubEnricher', () => {
  const actual = jest.requireActual('../../src/video/githubEnricher');
  return { ...actual, enrichRepos: jest.fn() };
});

jest.mock('../../src/video/summarizer', () => {
  const actual = jest.requireActual('../../src/video/summarizer');
  return { ...actual, summarizeVideo: jest.fn() };
});

jest.mock('../../src/video/transcriber', () => ({ transcribeAudio: jest.fn() }));

const extractor = require('../../src/video/extractor');
const { enrichRepos } = require('../../src/video/githubEnricher');
const { summarizeVideo } = require('../../src/video/summarizer');
const { transcribeAudio } = require('../../src/video/transcriber');
const { digest, digestMany, classifyUrl } = require('../../src/video/pipeline');
const archive = require('../../src/video/archive');

beforeEach(() => {
  jest.clearAllMocks();

  extractor.fetchMetadata.mockResolvedValue(METADATA);
  extractor.fetchSubtitles.mockResolvedValue({
    content: SUBTITLE_VTT,
    kind: 'captions',
    lang: 'he'
  });
  enrichRepos.mockResolvedValue([{
    owner: 'anthropics',
    repo: 'claude-code',
    fullName: 'anthropics/claude-code',
    url: 'https://github.com/anthropics/claude-code',
    exists: true,
    stars: 1234,
    description: 'Claude Code CLI',
    language: 'TypeScript',
    pushedAt: '2026-08-30T10:00:00Z'
  }]);
  summarizeVideo.mockResolvedValue({
    summary: SUMMARY,
    usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 },
    truncated: false,
    transcriptLength: 120
  });
});

afterEach(async () => {
  const entries = await fsp.readdir(tempArchive).catch(() => []);
  await Promise.all(entries.map((name) => fsp.rm(path.join(tempArchive, name), { force: true })));
});

describe('digest - happy path', () => {
  test('produces a complete archived record', async () => {
    const { record, skipped } = await digest('https://youtu.be/dQw4w9WgXcQ');

    expect(skipped).toBe(false);
    expect(record.id).toBe('youtube:dQw4w9WgXcQ');
    expect(record.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(record.metadata.title).toBe(METADATA.title);
    expect(record.transcriptSource).toBe('captions');
    expect(record.transcript).toContain('ברוכים הבאים');
    expect(record.summary.topics.map((t) => t.name)).toEqual(['AI agents', 'פיתוח']);
  });

  test('extracts links and GitHub repos from description and transcript', async () => {
    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ');

    expect(record.entities.links.map((l) => l.url)).toEqual(
      expect.arrayContaining([
        'https://github.com/anthropics/claude-code',
        'https://docs.claude.com/'
      ])
    );
    expect(record.entities.chapters).toHaveLength(2);
    expect(record.github[0].stars).toBe(1234);
  });

  test('gives the summarizer the extracted entities, not raw guesses', async () => {
    await digest('https://youtu.be/dQw4w9WgXcQ');

    const input = summarizeVideo.mock.calls[0][0];
    expect(input.transcriptSource).toBe('captions');
    expect(input.entities.githubRepos[0].fullName).toBe('anthropics/claude-code');
  });

  test('writes both JSON and Markdown to the archive', async () => {
    await digest('https://youtu.be/dQw4w9WgXcQ');

    const files = await fsp.readdir(tempArchive);
    expect(files).toEqual(expect.arrayContaining([
      'youtube_dQw4w9WgXcQ.json',
      'youtube_dQw4w9WgXcQ.md',
      'index.json'
    ]));

    const markdown = await fsp.readFile(path.join(tempArchive, 'youtube_dQw4w9WgXcQ.md'), 'utf8');
    expect(markdown).toContain('## TL;DR');
    expect(markdown).toContain('AI agents');
    expect(markdown).toContain('anthropics/claude-code');
  });

  test('records the video in the topic index', async () => {
    await digest('https://youtu.be/dQw4w9WgXcQ');

    const topics = await archive.topicIndex();
    expect(topics.map((t) => t.topic)).toEqual(expect.arrayContaining(['AI agents', 'פיתוח']));
  });
});

describe('digest - idempotency', () => {
  test('skips a video that is already archived', async () => {
    await digest('https://youtu.be/dQw4w9WgXcQ');
    const second = await digest('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');

    expect(second.skipped).toBe(true);
    expect(extractor.fetchMetadata).toHaveBeenCalledTimes(1);
  });

  test('--force re-processes and leaves exactly one index entry', async () => {
    await digest('https://youtu.be/dQw4w9WgXcQ');
    const second = await digest('https://youtu.be/dQw4w9WgXcQ', { force: true });

    expect(second.skipped).toBe(false);
    expect(extractor.fetchMetadata).toHaveBeenCalledTimes(2);

    const index = await archive.loadIndex();
    expect(index.videos.filter((v) => v.id === 'youtube:dQw4w9WgXcQ')).toHaveLength(1);
  });
});

describe('digest - degraded paths', () => {
  test('falls back to ASR when there are no captions', async () => {
    extractor.fetchSubtitles.mockResolvedValue(null);
    extractor.fetchAudio.mockResolvedValue('/tmp/fake-workdir/audio.mp3');
    transcribeAudio.mockResolvedValue({ text: 'תמלול מאודיו', source: 'asr', engine: 'whisper' });

    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ');

    expect(record.transcriptSource).toBe('asr');
    expect(record.transcript).toBe('תמלול מאודיו');
    expect(record.transcriptDetail).toContain('whisper');
  });

  test('--no-asr skips the audio path entirely', async () => {
    extractor.fetchSubtitles.mockResolvedValue(null);

    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ', { allowAsr: false });

    expect(record.transcriptSource).toBe('none');
    expect(extractor.fetchAudio).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test('an ASR failure degrades to a metadata-only summary', async () => {
    extractor.fetchSubtitles.mockResolvedValue(null);
    extractor.fetchAudio.mockResolvedValue('/tmp/fake-workdir/audio.mp3');
    transcribeAudio.mockRejectedValue(new Error('whisper is not installed'));

    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ');

    expect(record.transcriptSource).toBe('none');
    expect(record.transcriptDetail).toContain('whisper is not installed');
    expect(record.summary.tldr).toBeDefined();
  });

  test('still archives when no transcript can be obtained at all', async () => {
    extractor.fetchSubtitles.mockResolvedValue(null);
    extractor.fetchAudio.mockRejectedValue(new Error('video too long'));

    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ');

    expect(record.transcriptSource).toBe('none');
    expect(record.transcript).toBe('');
    expect(record.summary.tldr).toBeDefined();
  });

  test('a subtitle failure does not abort the run', async () => {
    extractor.fetchSubtitles.mockRejectedValue(new Error('yt-dlp exploded'));

    const { record } = await digest('https://youtu.be/dQw4w9WgXcQ');
    expect(record.transcriptSource).toBe('none');
    expect(record.transcriptDetail).toContain('yt-dlp exploded');
  });

  test.each([
    ['http://localhost/watch?v=abc', /internal host/],
    ['http://169.254.169.254/latest/meta-data/', /non-public address/],
    ['http://10.0.0.5/admin', /non-public address/],
    ['file:///etc/passwd', /Unsupported protocol/],
    ['https://example.com:2222/x', /ports 80 and 443/]
  ])('rejects %s before any extraction happens', async (url, pattern) => {
    await expect(digest(url)).rejects.toThrow(pattern);
    expect(extractor.fetchMetadata).not.toHaveBeenCalled();
  });

  test('a metadata failure propagates as an error', async () => {
    extractor.fetchMetadata.mockRejectedValue(new Error('video is private'));
    await expect(digest('https://youtu.be/dQw4w9WgXcQ')).rejects.toThrow('video is private');
  });
});

describe('digest - source classification', () => {
  test('a non-video URL is treated as a web page, not rejected', () => {
    expect(classifyUrl('https://vimeo.com/123').sourceType).toBe('web');
    expect(classifyUrl('https://www.vaxapack.com/products/x').sourceType).toBe('web');
  });

  test('a supported video still takes the video path', () => {
    expect(classifyUrl('https://youtu.be/dQw4w9WgXcQ').sourceType).toBe('video');
    expect(classifyUrl('https://www.instagram.com/reel/Cx1y2z3/').sourceType).toBe('video');
  });

  test('the same page with different tracking parameters gets one id', () => {
    const a = classifyUrl('https://shop.com/p?utm_source=ig&id=7');
    const b = classifyUrl('https://shop.com/p?id=7&fbclid=abc');
    expect(a.id).toBe(b.id);
  });
});

describe('digestMany', () => {
  test('keeps going after a failure and reports each outcome', async () => {
    extractor.fetchMetadata
      .mockResolvedValueOnce(METADATA)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(METADATA);

    const results = await digestMany([
      'https://youtu.be/aaaaaaaaaaa',
      'https://youtu.be/bbbbbbbbbbb',
      'https://youtu.be/ccccccccccc'
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toContain('unavailable');
  });

  test('reports an invalid URL as a failure rather than throwing', async () => {
    const results = await digestMany(['http://localhost/x']);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/internal host/);
  });
});
