#!/usr/bin/env node
/**
 * Family & Friends Authenticator - entry point
 *
 * A shared TOTP secret per contact, held in your Google Authenticator and in
 * theirs. When someone calls claiming to be you, they can ask for the code -
 * and you can ask them for theirs.
 *
 * Usage: npm run auth -- <command>
 */

const { run } = require('./src/authenticator/cli');

/**
 * Runs the CLI and reports failures without a stack trace
 * @returns {Promise<void>}
 */
async function main() {
    try {
        await run(process.argv.slice(2));
    } catch (error) {
        console.error(`\n\x1b[31m${error.message}\x1b[0m\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
