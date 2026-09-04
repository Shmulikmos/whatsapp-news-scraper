/**
 * Transcriber Module
 * ASR fallback for videos that ship no captions.
 *
 * The ASR engine is a pluggable CLI (default: OpenAI Whisper's reference
 * `whisper` command, which is also what faster-whisper's CLI mimics). It runs
 * locally on the already-downloaded audio file - no audio ever leaves the
 * machine - and is invoked through the same argv-array path as yt-dlp.
 */

const fsp = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { runTool, ExtractionError } = require('./extractor');
const { subtitlesToTranscript } = require('./subtitles');

/**
 * Transcribe an audio file to text using the configured ASR CLI.
 * The engine is asked for VTT output so the result carries timestamps and flows
 * through exactly the same subtitle parser as downloaded captions.
 * @param {string} audioPath - Path to a local audio file
 * @param {string} workDir - Directory the engine may write into
 * @returns {Promise<{text: string, source: string, engine: string}>} Transcript
 * @throws {ExtractionError} When ASR is disabled or produced no output
 */
async function transcribeAudio(audioPath, workDir) {
  if (!config.video.asrEnabled) {
    throw new ExtractionError('ASR fallback is disabled (VIDEO_ASR_ENABLED=false)');
  }

  const engine = config.video.asrCommand;
  logger.info(`Transcribing audio with "${engine}" (this can take a while)`);

  const args = [
    audioPath,
    '--model', config.video.asrModel,
    '--output_format', 'vtt',
    '--output_dir', workDir,
    '--verbose', 'False'
  ];

  if (config.video.asrLanguage) {
    args.push('--language', config.video.asrLanguage);
  }

  await runTool(engine, args, { timeoutMs: config.video.audioTimeoutMs });

  const entries = await fsp.readdir(workDir);
  const base = path.basename(audioPath).replace(/\.[^.]+$/, '');
  const vttFile = entries.find((name) => name === `${base}.vtt`) ||
    entries.find((name) => /\.vtt$/i.test(name) && name.startsWith(base));

  if (!vttFile) {
    throw new ExtractionError(`"${engine}" produced no .vtt output in ${workDir}`);
  }

  const content = await fsp.readFile(path.join(workDir, vttFile), 'utf8');
  const { text } = subtitlesToTranscript(content);

  if (!text.trim()) {
    throw new ExtractionError(`"${engine}" produced an empty transcript`);
  }

  logger.success(`Transcribed ${text.length} characters via ASR`);
  return { text, source: 'asr', engine };
}

module.exports = { transcribeAudio };
