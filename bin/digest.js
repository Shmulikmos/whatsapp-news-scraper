#!/usr/bin/env node
/**
 * Digest CLI
 * Usage: npm run digest -- <url> [<url> ...] [--force] [--no-asr] [--no-sheet] [--check]
 */

const { digestMany } = require('../src/video/pipeline');
const { checkToolchain } = require('../src/video/extractor');
const { TopicsSheet } = require('../src/video/topicsSheet');
const logger = require('../src/logger');
const config = require('../src/config');

const USAGE = `
Usage: npm run digest -- <url> [<url> ...] [options]

Arguments:
  <url>          A YouTube or Instagram video link

Options:
  --force        Re-process a video that is already archived
  --no-asr       Skip audio transcription; use captions only
  --no-sheet     Archive locally without writing to Google Sheets
  --check        Print environment readiness and exit
  --help         Show this message
`;

/**
 * Split argv into flags and URLs.
 * @param {Array<string>} argv - Raw arguments
 * @returns {{urls: Array<string>, flags: Set<string>}} Parsed arguments
 */
function parseArgs(argv) {
  const flags = new Set();
  const urls = [];

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      flags.add(arg);
    } else if (arg.trim()) {
      urls.push(arg.trim());
    }
  }

  return { urls, flags };
}

/**
 * Report whether the environment is ready to run the pipeline.
 * @returns {Promise<boolean>} True when every requirement is met
 */
async function runCheck() {
  const versions = await checkToolchain();
  const sheet = new TopicsSheet();
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  const checks = [
    ['yt-dlp', versions.ytDlp, versions.ytDlp || 'not found - install: pipx install yt-dlp'],
    ['ffmpeg', versions.ffmpeg, versions.ffmpeg || 'not found - needed only for the ASR fallback'],
    ['Anthropic key', hasKey, hasKey ? 'set' : 'not set - required for summaries and Q&A'],
    ['Google Sheet', sheet.isConfigured(),
      sheet.isConfigured() ? config.video.sheetId : 'not set - archives locally only'],
    ['Archive dir', true, config.video.archiveDir],
    ['Summary model', true, config.video.model]
  ];

  console.log('\nEnvironment check\n' + '='.repeat(60));
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${name.padEnd(16)} ${detail}`);
  }
  console.log('');

  return Boolean(versions.ytDlp) && hasKey;
}

/**
 * Entry point.
 * @returns {Promise<void>}
 */
async function main() {
  const { urls, flags } = parseArgs(process.argv.slice(2));

  if (flags.has('--help')) {
    console.log(USAGE);
    return;
  }

  if (flags.has('--check')) {
    const ready = await runCheck();
    process.exitCode = ready ? 0 : 1;
    return;
  }

  if (urls.length === 0) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const results = await digestMany(urls, {
    force: flags.has('--force'),
    allowAsr: !flags.has('--no-asr'),
    publish: !flags.has('--no-sheet')
  });

  console.log('\n' + '='.repeat(60));
  for (const result of results) {
    if (!result.ok) {
      console.log(`\nFAILED  ${result.url}\n        ${result.error}`);
      continue;
    }

    if (result.skipped) {
      console.log(`\nSKIPPED ${result.record.id} - already archived (use --force)`);
      continue;
    }

    const { record } = result;
    console.log(`\n${record.metadata.title}`);
    console.log(`  ${record.url}`);
    console.log(`  Topics : ${(record.summary.topics || []).map((t) => t.name).join(', ')}`);
    console.log(`  TL;DR  : ${record.summary.tldr}`);
    console.log(`  Links  : ${record.entities.links.length}   GitHub: ${record.github.length}   Transcript: ${record.transcriptSource}`);
    console.log(`  Archive: ${record.archivePath}`);
    if (result.sheet) {
      console.log(`  Sheet  : ${result.sheet.action}`);
    }
  }
  console.log('\n' + '='.repeat(60) + '\n');

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(error.message);
    if (process.env.LOG_LEVEL === 'debug' && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

module.exports = { parseArgs, runCheck };
