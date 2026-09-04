const {
  subtitlesToTranscript,
  parseCues,
  timestampToSeconds,
  formatOffset,
  newSuffix
} = require('../../src/video/subtitles');

describe('timestampToSeconds', () => {
  test.each([
    ['00:00:01.500', 1.5],
    ['01:02:03.000', 3723],
    ['02:03,500', 123.5],
    ['00:00:00.000', 0],
    ['garbage', 0]
  ])('parses %s', (stamp, expected) => {
    expect(timestampToSeconds(stamp)).toBeCloseTo(expected, 3);
  });
});

describe('formatOffset', () => {
  test.each([
    [0, '0:00'],
    [61, '1:01'],
    [3661, '1:01:01'],
    [-5, '0:00']
  ])('formats %s', (seconds, expected) => {
    expect(formatOffset(seconds)).toBe(expected);
  });
});

describe('newSuffix', () => {
  test('drops the overlapping prefix of a rolling caption', () => {
    expect(newSuffix('hello world', 'world and more')).toBe('and more');
  });

  test('returns nothing when the cue is fully contained', () => {
    expect(newSuffix('hello world', 'world')).toBe('');
  });

  test('returns the whole cue when there is no overlap', () => {
    expect(newSuffix('hello', 'something else')).toBe('something else');
  });

  test('returns the cue when nothing precedes it', () => {
    expect(newSuffix('', 'first cue')).toBe('first cue');
  });
});

describe('parseCues', () => {
  test('parses a WebVTT document', () => {
    const vtt = [
      'WEBVTT',
      'Kind: captions',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'first line',
      '',
      '00:00:03.000 --> 00:00:05.000',
      'second line'
    ].join('\n');

    expect(parseCues(vtt)).toEqual([
      { start: 1, text: 'first line' },
      { start: 3, text: 'second line' }
    ]);
  });

  test('parses SRT, ignoring sequence numbers', () => {
    const srt = ['1', '00:00:01,000 --> 00:00:02,000', 'hello', '', '2', '00:00:02,000 --> 00:00:03,000', 'world'].join('\n');
    expect(parseCues(srt).map((c) => c.text)).toEqual(['hello', 'world']);
  });

  test('strips inline caption markup and decodes entities', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c.colorE5E5E5>a &amp; b</c>';
    expect(parseCues(vtt)[0].text).toBe('a & b');
  });

  test('handles CRLF line endings', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nhello\r\n';
    expect(parseCues(vtt)[0].text).toBe('hello');
  });

  test('returns nothing for empty or non-string input', () => {
    expect(parseCues('')).toEqual([]);
    expect(parseCues(null)).toEqual([]);
  });
});

describe('subtitlesToTranscript', () => {
  test('collapses rolling auto-captions instead of repeating them', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'the quick brown',
      '',
      '00:00:03.000 --> 00:00:05.000',
      'the quick brown fox jumps',
      '',
      '00:00:05.000 --> 00:00:07.000',
      'fox jumps over the lazy dog'
    ].join('\n');

    const { text } = subtitlesToTranscript(vtt, { withTimestamps: false });
    expect(text).toBe('the quick brown fox jumps over the lazy dog');
  });

  test('keeps Hebrew text intact', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nשלום לכולם, היום נדבר על אבטחת מידע';
    const { text } = subtitlesToTranscript(vtt, { withTimestamps: false });
    expect(text).toBe('שלום לכולם, היום נדבר על אבטחת מידע');
  });

  test('starts a new timestamped segment past the segment window', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'opening remarks',
      '',
      '00:01:00.000 --> 00:01:03.000',
      'much later'
    ].join('\n');

    const { text } = subtitlesToTranscript(vtt, { segmentSeconds: 30 });
    expect(text.split('\n')).toEqual(['[0:01] opening remarks', '[1:00] much later']);
  });

  test('reports cue count and duration', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na\n\n00:00:40.000 --> 00:00:41.000\nb';
    const result = subtitlesToTranscript(vtt);
    expect(result.cueCount).toBe(2);
    expect(result.durationSec).toBe(40);
  });

  test('returns an empty result for an empty file', () => {
    expect(subtitlesToTranscript('')).toEqual({ text: '', cueCount: 0, durationSec: 0 });
  });
});
