require('dotenv').config();

/**
 * Read a positive integer from the environment, falling back to a default.
 * @param {string} name - Environment variable name
 * @param {number} fallback - Value to use when unset or invalid
 * @returns {number} Parsed value
 */
function intFromEnv(name, fallback) {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
    whatsapp: {
        chatName: process.env.CHAT_NAME || 'צ\'אט הכתבים N12',
        chatId: process.env.CHAT_ID || '120363401113878063@g.us',
        headless: process.env.HEADLESS === 'true',
        dataPath: './data/.wwebjs_auth'
    },
    scraping: {
        maxRetries: intFromEnv('MAX_RETRIES', 3),
        retryDelay: intFromEnv('RETRY_DELAY', 30000),
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        dir: './logs'
    },
    paths: {
        state: './data/state.json',
        output: './data/output/news_chat_data.csv'
    },
    googleSheets: {
        enabled: !!process.env.GOOGLE_SHEET_ID,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json'
    },

    /**
     * Video digest pipeline: send a YouTube/Instagram link, get a structured
     * summary archived locally and indexed by topic in Google Sheets.
     */
    video: {
        // External toolchain
        ytDlpPath: process.env.YTDLP_PATH || 'yt-dlp',
        // Optional: some Instagram content requires a logged-in session
        cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || '',
        cookiesFile: process.env.YTDLP_COOKIES_FILE || '',

        // Resource limits - every subprocess and payload is bounded
        toolTimeoutMs: intFromEnv('VIDEO_TOOL_TIMEOUT_MS', 120000),
        audioTimeoutMs: intFromEnv('VIDEO_AUDIO_TIMEOUT_MS', 600000),
        maxToolOutputBytes: intFromEnv('VIDEO_MAX_TOOL_OUTPUT_BYTES', 32 * 1024 * 1024),
        maxSubtitleBytes: intFromEnv('VIDEO_MAX_SUBTITLE_BYTES', 8 * 1024 * 1024),
        maxAudioMegabytes: intFromEnv('VIDEO_MAX_AUDIO_MB', 200),
        maxAsrDurationSec: intFromEnv('MAX_ASR_DURATION_SEC', 5400),
        maxTranscriptChars: intFromEnv('VIDEO_MAX_TRANSCRIPT_CHARS', 400000),

        // Transcription
        subtitleLangs: process.env.VIDEO_SUBTITLE_LANGS || 'he,en,iw,en-US,en-GB',
        asrEnabled: process.env.VIDEO_ASR_ENABLED !== 'false',
        asrCommand: process.env.VIDEO_ASR_COMMAND || 'whisper',
        asrModel: process.env.VIDEO_ASR_MODEL || 'small',
        asrLanguage: process.env.VIDEO_ASR_LANGUAGE || '',

        // Summarization
        model: process.env.VIDEO_SUMMARY_MODEL || 'claude-opus-5',
        maxTokens: intFromEnv('VIDEO_SUMMARY_MAX_TOKENS', 16000),
        effort: process.env.VIDEO_SUMMARY_EFFORT || 'medium',
        summaryLanguage: process.env.VIDEO_SUMMARY_LANGUAGE || 'Hebrew',

        // GitHub enrichment (read-only metadata; token is optional, raises rate limit)
        githubEnabled: process.env.VIDEO_GITHUB_ENRICH !== 'false',
        githubToken: process.env.GITHUB_TOKEN || '',
        githubTimeoutMs: intFromEnv('VIDEO_GITHUB_TIMEOUT_MS', 15000),
        maxReposPerVideo: intFromEnv('VIDEO_MAX_REPOS', 15),

        // Storage
        archiveDir: process.env.VIDEO_ARCHIVE_DIR || './data/archive',
        sheetId: process.env.VIDEO_SHEET_ID || process.env.GOOGLE_SHEET_ID || '',
        videosTab: process.env.VIDEO_SHEET_VIDEOS_TAB || 'Videos',
        topicsTab: process.env.VIDEO_SHEET_TOPICS_TAB || 'Topics',

        // WhatsApp watcher: which chat to listen on for links
        watchChatId: process.env.VIDEO_WATCH_CHAT_ID || '',
        watchReply: process.env.VIDEO_WATCH_REPLY !== 'false'
    }
};

module.exports = config;
