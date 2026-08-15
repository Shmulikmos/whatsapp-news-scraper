/**
 * Terminal Prompts - passphrase and free-text input
 * Passphrase input is hidden so it does not end up on screen or in a
 * screen-shared window.
 */

const readline = require('readline');

/**
 * Asks a question and returns the typed answer
 * @param {string} question - Prompt text
 * @returns {Promise<string>} The answer, trimmed
 */
function ask(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Asks for a secret value without echoing it to the terminal
 * Falls back to the AUTH_PASSPHRASE environment variable when stdin is not a
 * TTY, so the tool can still run from a script or a cron job.
 * @param {string} question - Prompt text
 * @returns {Promise<string>} The typed value
 */
function askHidden(question) {
    if (!process.stdin.isTTY) {
        if (process.env.AUTH_PASSPHRASE) {
            return Promise.resolve(process.env.AUTH_PASSPHRASE);
        }
        return Promise.reject(new Error('No terminal available for a hidden prompt. Set AUTH_PASSPHRASE instead.'));
    }

    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        let muted = false;

        // Suppress echo of everything typed after the prompt itself
        rl._writeToOutput = chunk => {
            if (!muted) {
                process.stdout.write(chunk);
            }
        };

        rl.question(question, answer => {
            muted = false;
            process.stdout.write('\n');
            rl.close();
            resolve(answer);
        });

        muted = true;
    });
}

/**
 * Reads the master passphrase, preferring AUTH_PASSPHRASE when it is set
 * @param {Object} [options] - Prompt options
 * @param {boolean} [options.confirm=false] - Ask twice and require a match
 * @param {string} [options.question] - Prompt text
 * @returns {Promise<string>} The passphrase
 * @throws {Error} If confirmation does not match or the passphrase is too short
 */
async function readPassphrase({ confirm = false, question = 'Master passphrase: ' } = {}) {
    if (process.env.AUTH_PASSPHRASE) {
        return process.env.AUTH_PASSPHRASE;
    }

    const passphrase = await askHidden(question);

    if (!passphrase) {
        throw new Error('Passphrase cannot be empty');
    }

    if (confirm) {
        if (passphrase.length < 8) {
            throw new Error('Choose a passphrase of at least 8 characters');
        }

        const again = await askHidden('Repeat passphrase: ');
        if (again !== passphrase) {
            throw new Error('The two passphrases do not match');
        }
    }

    return passphrase;
}

module.exports = { ask, askHidden, readPassphrase };
