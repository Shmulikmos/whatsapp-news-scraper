#!/usr/bin/env node
/**
 * Ask CLI
 * Usage: npm run ask -- "<question>" [--transcripts] [--limit N] [--from-sheet]
 *        npm run ask -- --topics
 */

const { ask, recordsFromSheet } = require('../src/video/qa');
const { topicIndex, loadIndex } = require('../src/video/archive');
const logger = require('../src/logger');

const USAGE = `
Usage: npm run ask -- "<question>" [options]
       npm run ask -- --topics
       npm run ask -- --pending

Options:
  --topics        List the archive's topics and how many sources sit under each
  --pending       List records saved but not yet summarized, with the command
                  to complete each one
  --limit N       How many videos to put in context (default 8, max 50)
  --transcripts   Include transcript text in context - slower and pricier, but
                  answers questions the summaries do not cover
  --from-sheet    Read from Google Sheets instead of the local archive
  --help          Show this message
`;

/**
 * Split argv into a question and options.
 * @param {Array<string>} argv - Raw arguments
 * @returns {{question: string, limit: number, transcripts: boolean, fromSheet: boolean, topics: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const parts = [];
  const parsed = {
    limit: 8, transcripts: false, fromSheet: false, topics: false, pending: false, help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--limit') {
      const value = parseInt(argv[++i], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.limit = Math.min(value, 50);
      }
    } else if (arg === '--transcripts') {
      parsed.transcripts = true;
    } else if (arg === '--from-sheet') {
      parsed.fromSheet = true;
    } else if (arg === '--topics') {
      parsed.topics = true;
    } else if (arg === '--pending') {
      parsed.pending = true;
    } else if (arg === '--help') {
      parsed.help = true;
    } else if (!arg.startsWith('--')) {
      parts.push(arg);
    }
  }

  return { ...parsed, question: parts.join(' ').trim() };
}

/**
 * Print the topic index.
 * @returns {Promise<void>}
 */
async function printTopics() {
  const topics = await topicIndex();
  const index = await loadIndex();

  if (topics.length === 0) {
    console.log('\nThe archive is empty. Digest a video first: npm run digest -- <url>\n');
    return;
  }

  console.log(`\nArchive: ${index.videos.length} videos across ${topics.length} topics\n`);
  for (const { topic, videos } of topics) {
    console.log(`  ${String(videos.length).padStart(3)}  ${topic}`);
    for (const video of videos.slice(0, 3)) {
      console.log(`       - ${video.title}`);
    }
    if (videos.length > 3) {
      console.log(`       ... and ${videos.length - 3} more`);
    }
  }
  console.log('');
}

/**
 * List records that were saved but never summarized.
 * @returns {Promise<void>}
 */
async function printPending() {
  const index = await loadIndex();
  const pending = index.videos.filter((entry) => entry.pending);

  if (pending.length === 0) {
    console.log(`\nNothing pending - all ${index.videos.length} archived sources are summarized.\n`);
    return;
  }

  console.log(`\n${pending.length} of ${index.videos.length} saved sources are not summarized yet:\n`);
  for (const entry of pending) {
    console.log(`  ${entry.title || entry.id}`);
    console.log(`    ${entry.url}`);
    console.log(`    npm run digest -- "${entry.url}" --force\n`);
  }
}

/**
 * Entry point.
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.topics) {
    await printTopics();
    return;
  }

  if (args.pending) {
    await printPending();
    return;
  }

  if (!args.question) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const records = args.fromSheet ? await recordsFromSheet() : undefined;

  const result = await ask(args.question, {
    limit: args.limit,
    includeTranscripts: args.transcripts,
    records
  });

  console.log('\n' + '='.repeat(60));
  console.log(result.answer);

  if (result.sources.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('Sources:');
    for (const source of result.sources) {
      console.log(`  - ${source.title}\n    ${source.url}`);
    }
  }
  console.log('='.repeat(60) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(error.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };
