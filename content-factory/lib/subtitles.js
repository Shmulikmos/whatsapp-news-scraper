const fs = require('fs');
const path = require('path');

// Splits narration into short caption chunks and distributes them across the
// audio duration proportionally to character count. Word-perfect sync would
// need forced alignment; proportional timing is close enough for burned captions.
function chunkNarration(narration) {
    const sentences = narration.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
    const chunks = [];
    for (const sentence of sentences) {
        const words = sentence.split(' ');
        for (let i = 0; i < words.length; i += 5) {
            const chunk = words.slice(i, i + 5).join(' ').trim();
            if (chunk) chunks.push(chunk);
        }
    }
    return chunks;
}

function toAssTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

function escapeAss(text) {
    return text.replace(/\\/g, '\\\\').replace(/{/g, '(').replace(/}/g, ')');
}

// Writes an ASS subtitle file styled for vertical short-form video.
function buildSubtitles(narration, audioDuration, workdir) {
    const chunks = chunkNarration(narration);
    const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,560,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    let t = 0;
    const events = chunks.map(chunk => {
        const dur = (chunk.length / totalChars) * audioDuration;
        const line = `Dialogue: 0,${toAssTime(t)},${toAssTime(Math.min(t + dur, audioDuration))},Cap,,0,0,0,,${escapeAss(chunk)}`;
        t += dur;
        return line;
    });

    const file = path.join(workdir, 'captions.ass');
    fs.writeFileSync(file, header + events.join('\n') + '\n');
    return file;
}

module.exports = { buildSubtitles };
