/**
 * Extractor tests.
 * `runTool` is exercised against real executables (a recorded shim, /bin/sh,
 * a missing binary), which is what proves the subprocess boundary holds -
 * a mocked child_process would prove nothing about argument handling.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
const SHIM = path.join(shimDir, 'fake-tool');
const ARGV_LOG = path.join(shimDir, 'argv.json');

// A stand-in for yt-dlp that records exactly the argv it received.
const SHIM_SOURCE = `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(ARGV_LOG)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.SHIM_DUMP_ENV ? JSON.stringify(process.env) : (process.env.SHIM_STDOUT || '{}'));
process.exit(Number(process.env.SHIM_EXIT || 0));
`;

fs.writeFileSync(SHIM, SHIM_SOURCE);
fs.chmodSync(SHIM, 0o755);

process.env.YTDLP_PATH = SHIM;

const {
  runTool,
  fetchMetadata,
  normalizeMetadata,
  createWorkDir,
  cleanupWorkDir,
  ExtractionError
} = require('../../src/video/extractor');
const { parseVideoUrl } = require('../../src/video/urlParser');

afterAll(() => {
  fs.rmSync(shimDir, { recursive: true, force: true });
});

/**
 * Read the argv the shim last recorded.
 * @returns {Array<string>} Recorded arguments
 */
function lastArgv() {
  return JSON.parse(fs.readFileSync(ARGV_LOG, 'utf8'));
}

describe('runTool - subprocess boundary', () => {
  test('passes arguments as a vector, not a command line', async () => {
    await runTool(SHIM, ['--flag', 'value with spaces', 'a;b|c&d']);

    expect(lastArgv()).toEqual(['--flag', 'value with spaces', 'a;b|c&d']);
  });

  test('T1 - shell metacharacters in an argument are inert', async () => {
    const marker = path.join(shimDir, 'pwned.txt');
    await runTool(SHIM, [`; touch ${marker}`, '$(touch /tmp/nope)', '`id`']);

    // The argument arrived verbatim and no shell ever interpreted it.
    expect(lastArgv()[0]).toBe(`; touch ${marker}`);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('reports a missing executable with an actionable message', async () => {
    await expect(runTool('definitely-not-a-real-binary-xyz', ['--version']))
      .rejects.toThrow(/not installed or not on PATH/);
  });

  test('surfaces a non-zero exit as an error', async () => {
    await expect(runTool(SHIM, ['x'], { env: { SHIM_EXIT: '3' } }))
      .rejects.toThrow(ExtractionError);
  });

  test('withholds credentials from the child environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-SHOULDNOTLEAKAAAAAAA';
    process.env.GITHUB_TOKEN = 'ghp_SHOULDNOTLEAKAAAAAAAAAAAAAAAA';

    const { stdout } = await runTool(SHIM, ['x'], { env: { SHIM_DUMP_ENV: '1' } });
    const childEnv = JSON.parse(stdout);

    expect(childEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(childEnv.GITHUB_TOKEN).toBeUndefined();
    // PATH still has to be there, or nothing would be runnable.
    expect(childEnv.PATH).toBeDefined();

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  test('kills a process that exceeds its timeout', async () => {
    await expect(runTool('/bin/sh', ['-c', 'sleep 10'], { timeoutMs: 300 }))
      .rejects.toThrow(/timed out/);
  });

  test('rejects when output exceeds the buffer cap', async () => {
    await expect(runTool('/bin/sh', ['-c', 'yes abcdefgh | head -c 200000'], { maxBuffer: 1024 }))
      .rejects.toThrow(ExtractionError);
  });

  test('redacts a secret that a tool echoes on stderr', async () => {
    fs.writeFileSync(SHIM, `#!/usr/bin/env node
process.stderr.write('failed using key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA');
process.exit(1);
`);
    fs.chmodSync(SHIM, 0o755);

    await expect(runTool(SHIM, ['x'])).rejects.toThrow(/\[REDACTED\]/);

    fs.writeFileSync(SHIM, SHIM_SOURCE);
    fs.chmodSync(SHIM, 0o755);
  });
});

describe('fetchMetadata', () => {
  beforeEach(() => {
    fs.writeFileSync(SHIM, SHIM_SOURCE);
    fs.chmodSync(SHIM, 0o755);
  });

  test('T1 - the URL is placed after `--`, so it can never be read as a flag', async () => {
    await fetchMetadata(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'));

    const argv = lastArgv();
    const separator = argv.indexOf('--');
    expect(separator).toBeGreaterThan(-1);
    expect(argv[separator + 1]).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(argv[separator + 1]).toBe(argv[argv.length - 1]);
  });

  test('refuses to inherit a stray yt-dlp config or run --exec', async () => {
    await fetchMetadata(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'));

    expect(lastArgv()).toEqual(expect.arrayContaining(['--ignore-config', '--no-exec']));
  });

  test('rejects output that is not JSON', async () => {
    fs.writeFileSync(SHIM, '#!/usr/bin/env node\nprocess.stdout.write("not json");\n');
    fs.chmodSync(SHIM, 0o755);

    await expect(fetchMetadata(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')))
      .rejects.toThrow(/not valid JSON/);
  });
});

describe('normalizeMetadata', () => {
  test('reformats yt-dlp upload_date as an ISO date', () => {
    expect(normalizeMetadata({ upload_date: '20260815' }).publishedAt).toBe('2026-08-15');
  });

  test('leaves a malformed upload_date as null', () => {
    expect(normalizeMetadata({ upload_date: 'soon' }).publishedAt).toBeNull();
    expect(normalizeMetadata({}).publishedAt).toBeNull();
  });

  test('rounds duration and preserves Hebrew text', () => {
    const result = normalizeMetadata({ duration: 125.7, title: 'מדריך לפיתוח' });
    expect(result.durationSec).toBe(126);
    expect(result.title).toBe('מדריך לפיתוח');
  });

  test('defaults every field when yt-dlp returns almost nothing', () => {
    const result = normalizeMetadata({});
    expect(result).toMatchObject({
      title: '', description: '', channel: '', durationSec: null,
      tags: [], chapters: [], availableSubtitles: []
    });
  });

  test('drops chapters that carry no title', () => {
    const result = normalizeMetadata({
      chapters: [{ title: 'Intro', start_time: 0 }, { start_time: 10 }, null]
    });
    expect(result.chapters).toEqual([{ title: 'Intro', startSec: 0 }]);
  });

  test('ignores non-string entries in tags', () => {
    expect(normalizeMetadata({ tags: ['ok', 42, null] }).tags).toEqual(['ok']);
  });
});

describe('work directories', () => {
  test('creates a directory named from a safe slug, then removes it', async () => {
    const dir = await createWorkDir('youtube:dQw4w9WgXcQ');

    expect(path.basename(dir)).toBe('youtube_dQw4w9WgXcQ');
    await expect(fsp.access(dir)).resolves.toBeUndefined();

    await cleanupWorkDir(dir);
    await expect(fsp.access(dir)).rejects.toThrow();
  });

  test('T3 - refuses to build a work directory from a traversing id', async () => {
    await expect(createWorkDir('youtube:../../etc')).rejects.toThrow(/Unsafe id/);
  });

  test('cleanup on a null path is a no-op', async () => {
    await expect(cleanupWorkDir(null)).resolves.toBeUndefined();
  });
});
