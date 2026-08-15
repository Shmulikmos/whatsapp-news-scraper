/**
 * Contact Manager - operations on the set of people you can verify
 * Every contact gets their own shared secret, so one leaked secret only
 * affects that one relationship and tells you exactly which one it was.
 */

const crypto = require('crypto');
const totp = require('./totp');

/**
 * Normalizes a name for comparison (case and spacing insensitive)
 * @param {string} name - Contact name
 * @returns {string} Comparable key
 */
function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds a contact by name
 * @param {Object} payload - Vault payload
 * @param {string} name - Contact name
 * @returns {Object|undefined} The contact, if present
 */
function findContact(payload, name) {
    const key = normalizeName(name);
    return payload.contacts.find(contact => normalizeName(contact.name) === key);
}

/**
 * Adds a new contact with a freshly generated shared secret
 * @param {Object} payload - Vault payload (mutated)
 * @param {Object} options - Contact options
 * @param {string} options.name - Contact name, e.g. "Keren"
 * @param {string} [options.note] - Free-text note, e.g. how the secret was delivered
 * @returns {Object} The created contact
 * @throws {Error} If the name is empty or already used
 */
function addContact(payload, { name, note = '' } = {}) {
    const trimmed = String(name || '').trim();

    if (!trimmed) {
        throw new Error('A contact needs a name');
    }
    if (findContact(payload, trimmed)) {
        throw new Error(`"${trimmed}" already exists. Use "show" to see their code, or "remove" first to re-issue.`);
    }

    const contact = {
        id: crypto.randomUUID(),
        name: trimmed,
        note,
        secret: totp.generateSecret(),
        createdAt: new Date().toISOString(),
        lastVerifiedStep: null,
        lastVerifiedAt: null,
        verifiedCount: 0
    };

    payload.contacts.push(contact);
    return contact;
}

/**
 * Removes a contact, revoking that shared secret
 * @param {Object} payload - Vault payload (mutated)
 * @param {string} name - Contact name
 * @returns {Object} The removed contact
 * @throws {Error} If no such contact exists
 */
function removeContact(payload, name) {
    const contact = findContact(payload, name);

    if (!contact) {
        throw new Error(`No contact named "${name}"`);
    }

    payload.contacts = payload.contacts.filter(entry => entry.id !== contact.id);
    return contact;
}

/**
 * Renames a contact, keeping their secret intact
 * @param {Object} payload - Vault payload (mutated)
 * @param {string} oldName - Current name
 * @param {string} newName - New name
 * @returns {Object} The renamed contact
 */
function renameContact(payload, oldName, newName) {
    const contact = findContact(payload, oldName);
    const trimmed = String(newName || '').trim();

    if (!contact) {
        throw new Error(`No contact named "${oldName}"`);
    }
    if (!trimmed) {
        throw new Error('The new name cannot be empty');
    }

    const existing = findContact(payload, trimmed);
    if (existing && existing.id !== contact.id) {
        throw new Error(`"${trimmed}" is already taken`);
    }

    contact.name = trimmed;
    return contact;
}

/**
 * Produces the current code for a contact
 * @param {Object} contact - Contact record
 * @param {number} [timestamp] - Unix time in seconds (defaults to now)
 * @returns {{name: string, code: string, secondsRemaining: number}} Current code and its lifetime
 */
function currentCode(contact, timestamp = totp.nowSeconds()) {
    return {
        name: contact.name,
        code: totp.generateTotp({ secret: contact.secret, timestamp }),
        secondsRemaining: totp.secondsRemaining(timestamp)
    };
}

/**
 * Verifies a code that someone read out to you
 *
 * A matching code is accepted only once. If somebody records a call where a
 * code was spoken, they cannot replay it during the remaining seconds of that
 * time step - the second attempt is rejected as a replay.
 *
 * @param {Object} payload - Vault payload (mutated on success)
 * @param {string} name - Contact name
 * @param {string} token - The code they read out
 * @param {Object} [options] - Verification options
 * @param {number} [options.timestamp] - Unix time in seconds (defaults to now)
 * @param {number} [options.window=1] - Time steps of drift accepted either side
 * @returns {{valid: boolean, reason: string, contact: Object, delta: number|null}} Result
 * @throws {Error} If no such contact exists
 */
function verifyContactCode(payload, name, token, { timestamp = totp.nowSeconds(), window = 1 } = {}) {
    const contact = findContact(payload, name);

    if (!contact) {
        throw new Error(`No contact named "${name}"`);
    }

    const result = totp.verifyTotp({ secret: contact.secret, token, timestamp, window });

    if (!result.valid) {
        return { valid: false, reason: 'no_match', contact, delta: null };
    }

    if (contact.lastVerifiedStep !== null && result.step <= contact.lastVerifiedStep) {
        return { valid: false, reason: 'replay', contact, delta: result.delta };
    }

    contact.lastVerifiedStep = result.step;
    contact.lastVerifiedAt = new Date(timestamp * 1000).toISOString();
    contact.verifiedCount = (contact.verifiedCount || 0) + 1;

    return { valid: true, reason: 'ok', contact, delta: result.delta };
}

/**
 * Builds the enrollment details a contact needs to add the secret to their app
 * @param {Object} contact - Contact record
 * @param {string} [ownerName] - Your own name, used as the label in their app
 * @returns {{uri: string, secret: string, formattedSecret: string, label: string}} Enrollment data
 */
function enrollmentDetails(contact, ownerName = '') {
    const label = ownerName ? `${ownerName} <-> ${contact.name}` : contact.name;

    return {
        label,
        secret: contact.secret,
        formattedSecret: totp.formatSecret(contact.secret),
        uri: totp.buildOtpauthUri({ secret: contact.secret, label })
    };
}

/**
 * Summarizes contacts for listing, without exposing secrets
 * @param {Object} payload - Vault payload
 * @returns {Array<Object>} Contact summaries
 */
function listContacts(payload) {
    return payload.contacts.map(contact => ({
        name: contact.name,
        note: contact.note || '',
        createdAt: contact.createdAt,
        lastVerifiedAt: contact.lastVerifiedAt,
        verifiedCount: contact.verifiedCount || 0
    }));
}

module.exports = {
    normalizeName,
    findContact,
    addContact,
    removeContact,
    renameContact,
    currentCode,
    verifyContactCode,
    enrollmentDetails,
    listContacts
};
