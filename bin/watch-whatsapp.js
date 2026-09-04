#!/usr/bin/env node
/**
 * WhatsApp Watcher
 * Listens on one chat and digests any YouTube/Instagram link posted there,
 * replying with the TL;DR. This is the "just send it a link" channel; it is a
 * thin adapter over the same pipeline the CLI uses.
 *
 * Scope is deliberately narrow: it acts only on a single configured chat, only
 * on supported video links, and only ever replies - it never forwards, never
 * messages anyone else, and never acts on message text as an instruction.
 */

const { createClient, connectWithRetry } = require('../src/client');
const { findVideoUrls } = require('../src/video/urlParser');
const { digest } = require('../src/video/pipeline');
const { redact } = require('../src/video/redact');
const logger = require('../src/logger');
const config = require('../src/config');

/** Videos currently being processed, so a repeated link is not run twice. */
const inFlight = new Set();

/**
 * Render a WhatsApp reply for a completed digest.
 * @param {Object} record - Digest record
 * @returns {string} Reply text
 */
function formatReply(record) {
  const { summary, metadata, entities, github } = record;
  const lines = [];

  lines.push(`*${metadata.title}*`);
  lines.push('');
  lines.push(summary.tldr);
  lines.push('');

  if ((summary.keyPoints || []).length) {
    lines.push('*עיקרי הדברים:*');
    summary.keyPoints.slice(0, 5).forEach((point, i) => lines.push(`${i + 1}. ${point}`));
    lines.push('');
  }

  if ((summary.topics || []).length) {
    lines.push(`*נושאים:* ${summary.topics.map((t) => t.name).join(' | ')}`);
  }

  if ((github || []).length) {
    lines.push('');
    lines.push('*GitHub:*');
    for (const repo of github.slice(0, 5)) {
      lines.push(`• ${repo.url}${repo.stars !== null && repo.stars !== undefined ? ` (★${repo.stars})` : ''}`);
    }
  }

  const otherLinks = (entities.links || []).filter((l) => l.domain !== 'github.com').slice(0, 5);
  if (otherLinks.length) {
    lines.push('');
    lines.push('*לינקים:*');
    for (const link of otherLinks) {
      lines.push(`• ${link.url}`);
    }
  }

  if ((summary.actionItems || []).length) {
    lines.push('');
    lines.push('*לפעולה:*');
    for (const item of summary.actionItems.slice(0, 5)) {
      lines.push(`• ${item}`);
    }
  }

  lines.push('');
  lines.push(`_תמלול: ${record.transcriptSource} · נשמר בארכיון_`);

  return lines.join('\n');
}

/**
 * Handle one incoming message.
 * @param {Object} message - whatsapp-web.js message
 * @param {string} watchChatId - Chat id we are listening on
 * @returns {Promise<void>}
 */
async function handleMessage(message, watchChatId) {
  // Scan the body first: it is free, and most messages carry no video link,
  // so this avoids a getChat() round-trip on every message in the chat.
  const videos = findVideoUrls(message.body);
  if (videos.length === 0) {
    return;
  }

  const chat = await message.getChat();
  if (chat.id._serialized !== watchChatId) {
    return;
  }

  for (const video of videos) {
    if (inFlight.has(video.id)) {
      logger.info(`${video.id} is already being processed - skipping`);
      continue;
    }

    inFlight.add(video.id);

    try {
      logger.info(`Link received: ${video.canonicalUrl}`);

      if (config.video.watchReply) {
        await message.reply('מעבד את הסרטון... 🎬');
      }

      const { record, skipped } = await digest(video.canonicalUrl);

      if (config.video.watchReply) {
        const prefix = skipped ? '_כבר בארכיון:_\n\n' : '';
        await message.reply(prefix + formatReply(record));
      }

      logger.success(`Done: ${record.id}`);
    } catch (error) {
      const reason = redact(error.message);
      logger.error(`Failed on ${video.canonicalUrl}: ${reason}`);

      if (config.video.watchReply) {
        await message.reply(`לא הצלחתי לעבד את הסרטון:\n${reason}`).catch(() => {});
      }
    } finally {
      inFlight.delete(video.id);
    }
  }
}

/**
 * Entry point.
 * @returns {Promise<void>}
 */
async function main() {
  const watchChatId = config.video.watchChatId || config.whatsapp.chatId;

  if (!watchChatId) {
    throw new Error('Set VIDEO_WATCH_CHAT_ID in .env to the chat you want to listen on');
  }

  console.log('\n========================================');
  console.log('  Video Digest - WhatsApp Watcher');
  console.log('========================================\n');
  logger.info(`Listening on chat: ${watchChatId}`);
  logger.info(`Replies: ${config.video.watchReply ? 'on' : 'off'}`);

  const client = createClient();

  // Own messages ("message to yourself") arrive on message_create, not message.
  client.on('message', (message) => {
    handleMessage(message, watchChatId).catch((error) => {
      logger.error(`Handler error: ${redact(error.message)}`);
    });
  });

  client.on('message_create', (message) => {
    if (!message.fromMe) {
      return;
    }
    handleMessage(message, watchChatId).catch((error) => {
      logger.error(`Handler error: ${redact(error.message)}`);
    });
  });

  await connectWithRetry(client);
  logger.success('Watching. Send a YouTube or Instagram link to that chat.');

  const shutdown = async (signal) => {
    logger.info(`${signal} received - shutting down`);
    try {
      await client.destroy();
    } catch (error) {
      logger.warn(`Cleanup warning: ${redact(error.message)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(`Watcher failed: ${redact(error.message)}`);
    process.exit(1);
  });
}

module.exports = { formatReply, handleMessage };
