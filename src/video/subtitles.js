/**
 * Subtitle Parser Module
 * Converts WebVTT / SRT subtitle files into clean, de-duplicated transcript text.
 *
 * YouTube auto-captions are "rolling": each cue repeats the tail of the previous
 * one so the on-screen text scrolls. Naive concatenation triples the token count
 * and produces unreadable text, so overlap removal is the core job here.
 */

/** Cue timing line, e.g. `00:01:02.500 --> 00:01:05.000 align:start`. */
const TIMING_LINE = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

/** Inline caption markup: `<00:00:01.000>`, `<c.colorE5E5E5>`, `</c>`. */
const INLINE_TAGS = /<[^>]*>/g;

/**
 * Convert a VTT/SRT timestamp to seconds.
 * @param {string} stamp - e.g. `00:01:02.500` or `01:02,500`
 * @returns {number} Seconds, or 0 when unparseable
 */
function timestampToSeconds(stamp) {
  const match = String(stamp).trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, '0'));

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/**
 * Format seconds as a `[MM:SS]` / `[HH:MM:SS]` marker.
 * @param {number} seconds - Offset in seconds
 * @returns {string} Formatted marker
 */
function formatOffset(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * Strip caption markup and collapse whitespace.
 * @param {string} line - Raw cue line
 * @returns {string} Cleaned text
 */
function cleanLine(line) {
  return line
    .replace(INLINE_TAGS, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a VTT or SRT document into timed cues.
 * @param {string} content - Full subtitle file content
 * @returns {Array<{start: number, text: string}>} Cues in file order
 */
function parseCues(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    return [];
  }

  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let current = null;

  for (const line of lines) {
    if (TIMING_LINE.test(line.trim())) {
      if (current && current.text) {
        cues.push(current);
      }
      const start = line.trim().split('-->')[0].trim();
      current = { start: timestampToSeconds(start), text: '' };
      continue;
    }

    if (!current) {
      // Header block (`WEBVTT`, `Kind:`, `Language:`) or an SRT sequence number.
      continue;
    }

    const cleaned = cleanLine(line);
    if (cleaned === '') {
      if (current.text) {
        cues.push(current);
        current = null;
      }
      continue;
    }

    current.text = current.text ? `${current.text} ${cleaned}` : cleaned;
  }

  if (current && current.text) {
    cues.push(current);
  }

  return cues;
}

/**
 * Drop the leading part of `text` that the accumulated transcript already ends with.
 * This is what removes the rolling-caption overlap.
 * @param {string} previous - Text already accepted
 * @param {string} text - Incoming cue text
 * @returns {string} The genuinely new suffix of `text` (may be empty)
 */
function newSuffix(previous, text) {
  if (!previous) {
    return text;
  }

  if (previous.endsWith(text)) {
    return '';
  }

  const maxOverlap = Math.min(previous.length, text.length);
  for (let size = maxOverlap; size > 0; size--) {
    if (previous.endsWith(text.slice(0, size))) {
      return text.slice(size).trimStart();
    }
  }

  return text;
}

/**
 * Convert a subtitle document into transcript text.
 * @param {string} content - Full subtitle file content
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.withTimestamps=true] - Prefix segments with `[MM:SS]`
 * @param {number} [options.segmentSeconds=30] - Seconds of speech per timestamped segment
 * @returns {{text: string, cueCount: number, durationSec: number}} Transcript result
 */
function subtitlesToTranscript(content, options = {}) {
  const { withTimestamps = true, segmentSeconds = 30 } = options;
  const cues = parseCues(content);

  if (cues.length === 0) {
    return { text: '', cueCount: 0, durationSec: 0 };
  }

  const segments = [];
  let buffer = '';
  let segmentStart = cues[0].start;

  for (const cue of cues) {
    const addition = newSuffix(buffer, cue.text);
    if (addition === '') {
      continue;
    }

    if (buffer && cue.start - segmentStart >= segmentSeconds) {
      segments.push({ start: segmentStart, text: buffer });
      buffer = '';
      segmentStart = cue.start;
    }

    buffer = buffer ? `${buffer} ${addition}` : addition;
  }

  if (buffer) {
    segments.push({ start: segmentStart, text: buffer });
  }

  const text = segments
    .map((s) => (withTimestamps ? `[${formatOffset(s.start)}] ${s.text}` : s.text))
    .join('\n');

  return {
    text,
    cueCount: cues.length,
    durationSec: cues[cues.length - 1].start
  };
}

module.exports = {
  subtitlesToTranscript,
  parseCues,
  timestampToSeconds,
  formatOffset,
  newSuffix
};
