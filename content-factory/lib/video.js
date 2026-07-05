const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log, ffmpeg, ffprobeDuration, ensureDir } = require('./util');
const { buildSubtitles } = require('./subtitles');

const V = () => config.video;

// Normalizes one stock clip into a vertical segment of exactly segDur seconds
// (looping it if the source is shorter).
function makeSegment(clip, segDur, index, workdir) {
    const out = path.join(workdir, `seg-${index}.mp4`);
    const { width, height, fps } = V();
    ffmpeg([
        '-stream_loop', '-1', '-i', clip,
        '-t', segDur.toFixed(3),
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1`,
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        out
    ]);
    return out;
}

// Fallback when no stock footage is available: animated dark gradient background.
function makeBackground(duration, workdir) {
    const out = path.join(workdir, 'seg-bg.mp4');
    const { width, height, fps } = V();
    ffmpeg([
        '-f', 'lavfi',
        '-i', `gradients=size=${width}x${height}:speed=0.02:duration=${duration.toFixed(3)}:rate=${fps},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        out
    ]);
    return out;
}

// Assembles the final vertical video: footage + burned captions + voiceover (+ optional music).
function assembleVideo({ clips, voiceover, narration, workdir, outName }) {
    ensureDir(workdir);
    const audioDur = ffprobeDuration(voiceover);
    const finalDur = audioDur + 0.6; // small tail so the video doesn't cut hard

    // 1. Build the visual track
    let segments;
    if (clips.length > 0) {
        const segDur = finalDur / clips.length;
        segments = clips.map((c, i) => makeSegment(c, segDur, i, workdir));
    } else {
        segments = [makeBackground(finalDur, workdir)];
    }

    const concatList = path.join(workdir, 'concat.txt');
    fs.writeFileSync(concatList, segments.map(s => `file '${path.basename(s)}'`).join('\n') + '\n');
    const base = path.join(workdir, 'base.mp4');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'base.mp4'], { cwd: workdir });

    // 2. Captions
    buildSubtitles(narration, audioDur, workdir);

    // 3. Final mux: burn captions, add voiceover (+ music bed if configured)
    const out = path.join(workdir, outName);
    const music = V().musicPath && fs.existsSync(V().musicPath) ? V().musicPath : null;
    log('video', `Rendering final video (${finalDur.toFixed(1)}s, music: ${music ? 'yes' : 'no'})...`);

    const args = ['-i', 'base.mp4', '-i', voiceover];
    if (music) args.push('-stream_loop', '-1', '-i', music);
    args.push(
        '-filter_complex',
        music
            ? `[0:v]ass=captions.ass[v];[2:a]volume=${V().musicVolume}[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`
            : `[0:v]ass=captions.ass[v];[1:a]anull[a]`,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', finalDur.toFixed(3),
        '-movflags', '+faststart',
        outName
    );
    ffmpeg(args, { cwd: workdir });

    log('video', `Video ready: ${out}`);
    return out;
}

module.exports = { assembleVideo };
