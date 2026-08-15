/**
 * TOTP Core - RFC 6238 / RFC 4226 implementation
 * Fully compatible with Google Authenticator (SHA-1, 6 digits, 30s period).
 * Uses only Node's built-in crypto so there is no third-party code between
 * your secrets and the codes they produce.
 */

const crypto = require('crypto');

// RFC 4648 base32 alphabet (the encoding Google Authenticator expects)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const DEFAULTS = {
    digits: 6,
    period: 30,
    algorithm: 'sha1',
    secretBytes: 20
};

/**
 * Encodes a buffer to an unpadded RFC 4648 base32 string
 * @param {Buffer} buffer - Bytes to encode
 * @returns {string} Base32 string (A-Z, 2-7)
 */
function encodeBase32(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    // Flush the remaining bits, left-aligned in the final character
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

/**
 * Decodes a base32 string to a buffer
 * Tolerates spaces, hyphens, lowercase and '=' padding so that secrets
 * typed by hand from a printed card still work.
 * @param {string} input - Base32 string
 * @returns {Buffer} Decoded bytes
 * @throws {Error} If the string contains characters outside the base32 alphabet
 */
function decodeBase32(input) {
    if (typeof input !== 'string') {
        throw new Error('Base32 secret must be a string');
    }

    const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');

    if (cleaned.length === 0) {
        throw new Error('Base32 secret is empty');
    }

    let bits = 0;
    let value = 0;
    const bytes = [];

    for (const char of cleaned) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error(`Invalid base32 character in secret: "${char}"`);
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

/**
 * Generates a new random base32 secret
 * @param {number} [bytes=20] - Entropy in bytes (20 = 160 bits, the RFC 4226 recommendation)
 * @returns {string} Base32 encoded secret
 */
function generateSecret(bytes = DEFAULTS.secretBytes) {
    if (bytes < 16) {
        throw new Error('Secret must be at least 16 bytes (128 bits)');
    }
    return encodeBase32(crypto.randomBytes(bytes));
}

/**
 * Splits a secret into 4-character groups for readable manual entry
 * @param {string} secret - Base32 secret
 * @returns {string} Secret grouped as "ABCD EFGH IJKL ..."
 */
function formatSecret(secret) {
    return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Converts a unix timestamp to a TOTP counter (time step)
 * @param {number} timestamp - Unix time in seconds
 * @param {number} [period=30] - Step length in seconds
 * @returns {number} Counter value
 */
function counterFromTime(timestamp, period = DEFAULTS.period) {
    return Math.floor(timestamp / period);
}

/**
 * Computes an HOTP value (RFC 4226) for a given counter
 * @param {Buffer} secretBuffer - Raw secret bytes
 * @param {number} counter - Counter value
 * @param {number} digits - Number of digits to emit
 * @param {string} algorithm - HMAC algorithm ('sha1', 'sha256', 'sha512')
 * @returns {string} Zero-padded one-time code
 */
function hotp(secretBuffer, counter, digits, algorithm) {
    // 8-byte big-endian counter
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));

    const digest = crypto.createHmac(algorithm, secretBuffer).update(counterBuffer).digest();

    // Dynamic truncation (RFC 4226 section 5.3)
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);

    return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Generates the TOTP code for a moment in time
 * @param {Object} options - Generation options
 * @param {string} options.secret - Base32 secret
 * @param {number} [options.timestamp] - Unix time in seconds (defaults to now)
 * @param {number} [options.period=30] - Step length in seconds
 * @param {number} [options.digits=6] - Code length
 * @param {string} [options.algorithm='sha1'] - HMAC algorithm
 * @returns {string} The current one-time code
 */
function generateTotp({ secret, timestamp = nowSeconds(), period = DEFAULTS.period, digits = DEFAULTS.digits, algorithm = DEFAULTS.algorithm } = {}) {
    const secretBuffer = decodeBase32(secret);
    return hotp(secretBuffer, counterFromTime(timestamp, period), digits, algorithm);
}

/**
 * Compares two codes in constant time to avoid leaking information through timing
 * @param {string} a - First code
 * @param {string} b - Second code
 * @returns {boolean} True if the codes match
 */
function safeCompare(a, b) {
    const bufferA = Buffer.from(String(a));
    const bufferB = Buffer.from(String(b));

    if (bufferA.length !== bufferB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies a code against a secret, allowing for clock drift
 * @param {Object} options - Verification options
 * @param {string} options.secret - Base32 secret
 * @param {string} options.token - Code supplied by the other person
 * @param {number} [options.timestamp] - Unix time in seconds (defaults to now)
 * @param {number} [options.window=1] - Steps of drift accepted in each direction
 * @param {number} [options.period=30] - Step length in seconds
 * @param {number} [options.digits=6] - Code length
 * @param {string} [options.algorithm='sha1'] - HMAC algorithm
 * @returns {{valid: boolean, delta: number|null, step: number|null}} Result, where
 *          delta is which time step matched (0 = current, -1 = previous, +1 = next)
 */
function verifyTotp({ secret, token, timestamp = nowSeconds(), window = 1, period = DEFAULTS.period, digits = DEFAULTS.digits, algorithm = DEFAULTS.algorithm } = {}) {
    const normalized = String(token || '').replace(/[\s-]/g, '');

    if (!/^\d+$/.test(normalized) || normalized.length !== digits) {
        return { valid: false, delta: null, step: null };
    }

    const secretBuffer = decodeBase32(secret);
    const currentStep = counterFromTime(timestamp, period);

    for (let delta = -window; delta <= window; delta++) {
        const step = currentStep + delta;
        if (safeCompare(hotp(secretBuffer, step, digits, algorithm), normalized)) {
            return { valid: true, delta, step };
        }
    }

    return { valid: false, delta: null, step: null };
}

/**
 * Seconds left before the current code rolls over
 * @param {number} [timestamp] - Unix time in seconds (defaults to now)
 * @param {number} [period=30] - Step length in seconds
 * @returns {number} Seconds remaining in the current step
 */
function secondsRemaining(timestamp = nowSeconds(), period = DEFAULTS.period) {
    return period - (Math.floor(timestamp) % period);
}

/**
 * Builds the otpauth:// URI that Google Authenticator reads from a QR code
 * @param {Object} options - URI options
 * @param {string} options.secret - Base32 secret
 * @param {string} options.label - Account label shown in the app (e.g. the other person's name)
 * @param {string} [options.issuer='Family Verify'] - Issuer shown in the app
 * @param {number} [options.period=30] - Step length in seconds
 * @param {number} [options.digits=6] - Code length
 * @param {string} [options.algorithm='sha1'] - HMAC algorithm
 * @returns {string} otpauth:// URI
 */
function buildOtpauthUri({ secret, label, issuer = 'Family Verify', period = DEFAULTS.period, digits = DEFAULTS.digits, algorithm = DEFAULTS.algorithm } = {}) {
    if (!secret) {
        throw new Error('Cannot build an otpauth URI without a secret');
    }
    if (!label) {
        throw new Error('Cannot build an otpauth URI without a label');
    }

    const path = encodeURIComponent(issuer) + ':' + encodeURIComponent(label);
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: algorithm.toUpperCase(),
        digits: String(digits),
        period: String(period)
    });

    return `otpauth://totp/${path}?${params.toString()}`;
}

/**
 * Current unix time in seconds
 * @returns {number} Seconds since the epoch
 */
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

module.exports = {
    DEFAULTS,
    encodeBase32,
    decodeBase32,
    generateSecret,
    formatSecret,
    counterFromTime,
    hotp,
    generateTotp,
    verifyTotp,
    secondsRemaining,
    buildOtpauthUri,
    safeCompare,
    nowSeconds
};
