require('dotenv').config();

const path = require('path');

const ROOT = __dirname;

const config = {
    // Content generation
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 4096
    },

    // Channel identity — used in every prompt so content stays on-brand
    channel: {
        name: process.env.CHANNEL_NAME || 'My Channel',
        niche: process.env.CHANNEL_NICHE || 'interesting facts and stories',
        language: process.env.CHANNEL_LANGUAGE || 'English',
        tone: process.env.CHANNEL_TONE || 'energetic, curious, hook-driven',
        targetDurationSec: parseInt(process.env.TARGET_DURATION_SEC) || 45
    },

    // Text-to-speech: 'elevenlabs' or 'openai'
    tts: {
        provider: process.env.TTS_PROVIDER || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai'),
        elevenlabs: {
            apiKey: process.env.ELEVENLABS_API_KEY,
            voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
            modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'
        },
        openai: {
            apiKey: process.env.OPENAI_API_KEY,
            voice: process.env.OPENAI_TTS_VOICE || 'onyx',
            model: process.env.OPENAI_TTS_MODEL || 'tts-1-hd'
        }
    },

    // Stock footage
    pexels: {
        apiKey: process.env.PEXELS_API_KEY,
        clipsPerVideo: parseInt(process.env.CLIPS_PER_VIDEO) || 5
    },

    // Video rendering
    video: {
        width: 1080,
        height: 1920,
        fps: 30,
        musicPath: process.env.BG_MUSIC_PATH || '', // optional local mp3, mixed at low volume
        musicVolume: parseFloat(process.env.BG_MUSIC_VOLUME) || 0.08
    },

    // Publishing targets — each activates when its credentials are present
    youtube: {
        enabled: process.env.YT_ENABLED !== 'false' && !!process.env.YT_CLIENT_ID,
        clientId: process.env.YT_CLIENT_ID,
        clientSecret: process.env.YT_CLIENT_SECRET,
        refreshToken: process.env.YT_REFRESH_TOKEN,
        privacyStatus: process.env.YT_PRIVACY || 'public',
        categoryId: process.env.YT_CATEGORY_ID || '24' // Entertainment
    },
    instagram: {
        enabled: process.env.IG_ENABLED !== 'false' && !!process.env.IG_ACCESS_TOKEN,
        accessToken: process.env.IG_ACCESS_TOKEN,
        userId: process.env.IG_USER_ID, // Instagram Business account ID
        // Reels API requires the video at a public URL; we host via Cloudinary
        cloudinary: {
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET // unsigned preset
        }
    },
    tiktok: {
        enabled: process.env.TT_ENABLED !== 'false' && !!process.env.TT_ACCESS_TOKEN,
        accessToken: process.env.TT_ACCESS_TOKEN,
        privacyLevel: process.env.TT_PRIVACY_LEVEL || 'PUBLIC_TO_EVERYONE'
    },

    paths: {
        root: ROOT,
        queue: path.join(ROOT, 'queue.json'),          // tracked in git — persists across CI runs
        published: path.join(ROOT, 'published.json'),  // tracked in git — the channel's history
        report: path.join(ROOT, 'REPORT.md'),          // human-readable analytics report
        workdir: path.join(ROOT, 'data')               // gitignored — temp audio/clips/renders
    }
};

module.exports = config;
