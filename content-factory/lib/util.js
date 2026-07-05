const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function log(stage, msg) {
    console.log(`[${new Date().toISOString()}] [${stage}] ${msg}`);
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function fetchJson(url, options = {}, label = 'request') {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`${label} failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function downloadFile(url, dest, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buf);
    return dest;
}

function ffmpeg(args, opts = {}) {
    return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 64 * 1024 * 1024,
        ...opts
    });
}

function ffprobeDuration(file) {
    const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file
    ]).toString().trim();
    const dur = parseFloat(out);
    if (!Number.isFinite(dur) || dur <= 0) throw new Error(`ffprobe could not read duration of ${file}`);
    return dur;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'topic';
}

module.exports = { log, ensureDir, readJson, writeJson, fetchJson, downloadFile, ffmpeg, ffprobeDuration, sleep, slugify };
