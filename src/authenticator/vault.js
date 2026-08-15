/**
 * Encrypted Vault - stores the shared secrets for each contact
 * The file on disk is AES-256-GCM encrypted with a key derived from your
 * master passphrase (scrypt). Without the passphrase the file is useless,
 * so a stolen laptop or a synced backup does not hand over your secrets.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_VERSION = 1;

const KDF = {
    algorithm: 'scrypt',
    N: 32768,
    r: 8,
    p: 1,
    keylen: 32,
    // 128 * N * r bytes are needed by scrypt; the Node default of 32MB is too low for N=32768
    maxmem: 128 * 32768 * 8 * 2
};

const CIPHER = 'aes-256-gcm';
const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * Derives the encryption key from a passphrase
 * @param {string} passphrase - Master passphrase
 * @param {Buffer} salt - Per-vault random salt
 * @returns {Buffer} 32-byte key
 */
function deriveKey(passphrase, salt) {
    return crypto.scryptSync(passphrase, salt, KDF.keylen, {
        N: KDF.N,
        r: KDF.r,
        p: KDF.p,
        maxmem: KDF.maxmem
    });
}

/**
 * Builds an empty vault payload
 * @param {string} [ownerName] - Name used when labelling enrollment QR codes
 * @returns {Object} Fresh payload
 */
function createEmptyPayload(ownerName = '') {
    return {
        ownerName,
        createdAt: new Date().toISOString(),
        contacts: []
    };
}

/**
 * Encrypts a payload into the on-disk vault structure
 * @param {Object} payload - Plaintext payload
 * @param {string} passphrase - Master passphrase
 * @returns {Object} Encrypted vault object, safe to write to disk
 */
function encryptPayload(payload, passphrase) {
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const key = deriveKey(passphrase, salt);

    const cipher = crypto.createCipheriv(CIPHER, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final()
    ]);

    return {
        version: VAULT_VERSION,
        cipher: CIPHER,
        kdf: { algorithm: KDF.algorithm, N: KDF.N, r: KDF.r, p: KDF.p, keylen: KDF.keylen },
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Decrypts an on-disk vault structure
 * @param {Object} vault - Encrypted vault object
 * @param {string} passphrase - Master passphrase
 * @returns {Object} Plaintext payload
 * @throws {Error} If the passphrase is wrong or the file was tampered with
 */
function decryptPayload(vault, passphrase) {
    if (!vault || vault.version !== VAULT_VERSION) {
        throw new Error(`Unsupported vault version: ${vault && vault.version}`);
    }

    const salt = Buffer.from(vault.salt, 'base64');
    const iv = Buffer.from(vault.iv, 'base64');
    const authTag = Buffer.from(vault.authTag, 'base64');
    const key = deriveKey(passphrase, salt);

    try {
        const decipher = crypto.createDecipheriv(vault.cipher || CIPHER, key, iv);
        decipher.setAuthTag(authTag);

        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(vault.ciphertext, 'base64')),
            decipher.final()
        ]);

        return JSON.parse(plaintext.toString('utf8'));
    } catch (error) {
        // GCM authentication failure means wrong passphrase or a modified file.
        // Both are reported the same way so nothing leaks about which it was.
        throw new Error('Could not open the vault - wrong passphrase, or the file has been altered');
    }
}

/**
 * Checks whether a vault file exists
 * @param {string} vaultPath - Path to the vault file
 * @returns {boolean} True if the file exists
 */
function vaultExists(vaultPath) {
    return fs.existsSync(vaultPath);
}

/**
 * Loads and decrypts a vault from disk
 * @param {string} vaultPath - Path to the vault file
 * @param {string} passphrase - Master passphrase
 * @returns {Object} Plaintext payload
 */
function loadVault(vaultPath, passphrase) {
    if (!vaultExists(vaultPath)) {
        throw new Error(`No vault at ${vaultPath}. Run "npm run auth init" first.`);
    }

    let vault;
    try {
        vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    } catch (error) {
        throw new Error(`Vault file at ${vaultPath} is not readable JSON: ${error.message}`);
    }

    return decryptPayload(vault, passphrase);
}

/**
 * Encrypts and writes a payload to disk
 * Writes to a temporary file first so an interrupted save cannot leave a
 * half-written vault behind. The file is created with owner-only permissions.
 * @param {string} vaultPath - Path to the vault file
 * @param {Object} payload - Plaintext payload
 * @param {string} passphrase - Master passphrase
 * @returns {void}
 */
function saveVault(vaultPath, payload, passphrase) {
    const directory = path.dirname(vaultPath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }

    const encrypted = encryptPayload(payload, passphrase);
    const tempPath = `${vaultPath}.tmp`;

    fs.writeFileSync(tempPath, JSON.stringify(encrypted, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, vaultPath);

    try {
        fs.chmodSync(vaultPath, 0o600);
    } catch (error) {
        // Permission bits are not enforceable on every filesystem (e.g. Windows)
    }
}

module.exports = {
    VAULT_VERSION,
    createEmptyPayload,
    encryptPayload,
    decryptPayload,
    vaultExists,
    loadVault,
    saveVault,
    deriveKey
};
