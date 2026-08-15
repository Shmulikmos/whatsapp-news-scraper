/**
 * Authenticator CLI - command handling and terminal output
 *
 * Nothing here is written to the log files: codes and secrets stay on screen
 * and in the encrypted vault only.
 */

const path = require('path');

const totp = require('./totp');
const vault = require('./vault');
const manager = require('./manager');
const { ask, readPassphrase } = require('./prompt');

const DEFAULT_VAULT_PATH = process.env.AUTH_VAULT_PATH || './data/authenticator/vault.json';

const colors = {
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    reset: '\x1b[0m'
};

/**
 * Renders a QR code to the terminal
 *
 * The QR library is loaded lazily and its absence is not fatal: the manual
 * setup key below it is enough to enroll a phone. That keeps "code" and
 * "verify" - the commands you need in the moment - working on a machine
 * where dependencies were never installed.
 *
 * @param {string} uri - otpauth:// URI to encode
 * @returns {boolean} True if a QR code was drawn
 */
function printQrCode(uri) {
    let qrcode;

    try {
        qrcode = require('qrcode-terminal');
    } catch (error) {
        console.log(`${colors.dim}(QR rendering needs "npm install" - use the manual key below instead)${colors.reset}`);
        return false;
    }

    qrcode.generate(uri, { small: true });
    return true;
}

/**
 * Prints a heading block
 * @param {string} title - Heading text
 * @returns {void}
 */
function heading(title) {
    console.log(`\n${colors.bold}${title}${colors.reset}`);
    console.log('='.repeat(title.length));
}

/**
 * Opens the vault, asking for the passphrase
 * @param {string} vaultPath - Path to the vault file
 * @returns {Promise<{payload: Object, passphrase: string}>} Decrypted payload and the passphrase to save with
 */
async function openVault(vaultPath) {
    const passphrase = await readPassphrase();
    return { payload: vault.loadVault(vaultPath, passphrase), passphrase };
}

/**
 * Creates a new vault
 * @param {string} vaultPath - Path to the vault file
 * @returns {Promise<void>}
 */
async function commandInit(vaultPath) {
    if (vault.vaultExists(vaultPath)) {
        throw new Error(`A vault already exists at ${vaultPath}. Delete it only if you are ready to re-enroll everyone.`);
    }

    heading('Set up your verification vault');
    console.log('Your contacts and their shared secrets live in one encrypted file.');
    console.log(`It will be written to ${colors.cyan}${path.resolve(vaultPath)}${colors.reset}\n`);

    const ownerName = await ask('Your name (as your family will see it in their app): ');
    console.log('\nChoose a master passphrase. It is the only way to open the vault -');
    console.log('there is no recovery if you forget it.\n');

    const passphrase = await readPassphrase({ confirm: true, question: 'Master passphrase: ' });
    const payload = vault.createEmptyPayload(ownerName);

    vault.saveVault(vaultPath, payload, passphrase);

    console.log(`\n${colors.green}Vault created.${colors.reset}`);
    console.log(`Next: ${colors.cyan}npm run auth -- add "Keren"${colors.reset} to enroll your first contact.\n`);
}

/**
 * Prints the enrollment instructions for a contact
 * @param {Object} contact - Contact record
 * @param {string} ownerName - Your own name
 * @returns {void}
 */
function printEnrollment(contact, ownerName) {
    const details = manager.enrollmentDetails(contact, ownerName);

    heading(`Enrollment for ${contact.name}`);
    console.log('\nScan this QR code with Google Authenticator:\n');

    printQrCode(details.uri);

    console.log(`\n${colors.bold}Or type the key in by hand${colors.reset} (Google Authenticator -> + -> "Enter a setup key"):\n`);
    console.log(`  Account name : ${colors.cyan}${details.label}${colors.reset}`);
    console.log(`  Key          : ${colors.cyan}${details.formattedSecret}${colors.reset}`);
    console.log(`  Type of key  : Time based\n`);

    console.log(`${colors.yellow}This same code must be added on BOTH phones - yours and ${contact.name}'s.${colors.reset}`);
    console.log(`${colors.yellow}Hand it over in person if you can. If you cannot, use a call you already${colors.reset}`);
    console.log(`${colors.yellow}trust - never send it over the channel you are trying to protect.${colors.reset}\n`);
    console.log(`${colors.dim}When you are done, clear this screen: type "clear" and press Enter.${colors.reset}\n`);
}

/**
 * Adds a contact and shows their enrollment details
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: contact name
 * @returns {Promise<void>}
 */
async function commandAdd(vaultPath, args) {
    const name = args[0];

    if (!name) {
        throw new Error('Usage: npm run auth -- add "Keren"');
    }

    const { payload, passphrase } = await openVault(vaultPath);
    const note = await ask('Note (how you delivered the key, optional): ');
    const contact = manager.addContact(payload, { name, note });

    vault.saveVault(vaultPath, payload, passphrase);
    printEnrollment(contact, payload.ownerName);
}

/**
 * Re-shows enrollment details for an existing contact
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: contact name
 * @returns {Promise<void>}
 */
async function commandShow(vaultPath, args) {
    const name = args[0];

    if (!name) {
        throw new Error('Usage: npm run auth -- show "Keren"');
    }

    const { payload } = await openVault(vaultPath);
    const contact = manager.findContact(payload, name);

    if (!contact) {
        throw new Error(`No contact named "${name}". Run "list" to see who is enrolled.`);
    }

    printEnrollment(contact, payload.ownerName);
}

/**
 * Lists enrolled contacts
 * @param {string} vaultPath - Path to the vault file
 * @returns {Promise<void>}
 */
async function commandList(vaultPath) {
    const { payload } = await openVault(vaultPath);
    const contacts = manager.listContacts(payload);

    heading('Enrolled contacts');

    if (contacts.length === 0) {
        console.log('\nNobody yet. Add someone with: npm run auth -- add "Keren"\n');
        return;
    }

    console.log('');
    contacts.forEach(contact => {
        const lastVerified = contact.lastVerifiedAt
            ? new Date(contact.lastVerifiedAt).toLocaleString()
            : 'never';

        console.log(`  ${colors.bold}${contact.name}${colors.reset}`);
        console.log(`    ${colors.dim}enrolled ${new Date(contact.createdAt).toLocaleDateString()} | last verified: ${lastVerified} | times verified: ${contact.verifiedCount}${colors.reset}`);
        if (contact.note) {
            console.log(`    ${colors.dim}note: ${contact.note}${colors.reset}`);
        }
    });
    console.log('');
}

/**
 * Renders a table of current codes
 * @param {Array<Object>} contacts - Contacts to show
 * @returns {Array<string>} Rendered lines
 */
function renderCodes(contacts) {
    const timestamp = totp.nowSeconds();
    const remaining = totp.secondsRemaining(timestamp);
    const width = Math.max(...contacts.map(contact => contact.name.length), 4);
    const urgency = remaining <= 5 ? colors.red : colors.green;

    const lines = contacts.map(contact => {
        const { code } = manager.currentCode(contact, timestamp);
        return `  ${contact.name.padEnd(width)}  ${colors.bold}${code.slice(0, 3)} ${code.slice(3)}${colors.reset}`;
    });

    lines.push('');
    lines.push(`  ${urgency}valid for ${String(remaining).padStart(2)}s${colors.reset}`);

    return lines;
}

/**
 * Shows the current code for one or all contacts
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: optional contact name
 * @param {Object} flags - Parsed flags
 * @returns {Promise<void>}
 */
async function commandCode(vaultPath, args, flags) {
    const { payload } = await openVault(vaultPath);
    const name = args[0];

    let contacts = payload.contacts;
    if (name) {
        const contact = manager.findContact(payload, name);
        if (!contact) {
            throw new Error(`No contact named "${name}"`);
        }
        contacts = [contact];
    }

    if (contacts.length === 0) {
        throw new Error('No contacts enrolled yet. Add someone with: npm run auth -- add "Keren"');
    }

    heading('Your codes');
    console.log(`${colors.dim}Read these out to prove it is you.${colors.reset}`);

    if (!flags.watch) {
        console.log('');
        renderCodes(contacts).forEach(line => console.log(line));
        console.log('');
        return;
    }

    console.log(`${colors.dim}Refreshing - press Ctrl+C to stop.${colors.reset}\n`);
    const blockHeight = contacts.length + 2;

    /**
     * Redraws the code block in place
     * @returns {void}
     */
    const draw = () => {
        const lines = renderCodes(contacts);
        process.stdout.write(`\x1b[${blockHeight}A\r`);
        lines.forEach(line => process.stdout.write(`\x1b[2K${line}\n`));
    };

    // Reserve the lines the redraw will overwrite
    console.log('\n'.repeat(blockHeight - 1));
    draw();

    const timer = setInterval(draw, 1000);
    process.on('SIGINT', () => {
        clearInterval(timer);
        console.log('\n');
        process.exit(0);
    });
}

/**
 * Verifies a code someone read out to you
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: contact name, optional code
 * @returns {Promise<void>}
 */
async function commandVerify(vaultPath, args) {
    const name = args[0];

    if (!name) {
        throw new Error('Usage: npm run auth -- verify "Keren" 123456');
    }

    const { payload, passphrase } = await openVault(vaultPath);
    const token = args[1] || await ask(`Code from ${name}: `);
    const result = manager.verifyContactCode(payload, name, token);

    heading('Verification');

    if (result.valid) {
        vault.saveVault(vaultPath, payload, passphrase);
        console.log(`\n${colors.green}MATCH - this is really ${result.contact.name}.${colors.reset}`);
        if (result.delta !== 0) {
            console.log(`${colors.dim}(matched the ${result.delta < 0 ? 'previous' : 'next'} 30-second window - one of the two clocks is slightly off)${colors.reset}`);
        }
        console.log('');
        return;
    }

    if (result.reason === 'replay') {
        console.log(`\n${colors.red}REJECTED - that code was already used.${colors.reset}`);
        console.log('A valid code is accepted once only. Ask for the next one, and treat a');
        console.log('repeated old code as a warning sign that someone recorded an earlier call.\n');
    } else {
        console.log(`\n${colors.red}NO MATCH - do not trust this person yet.${colors.reset}`);
        console.log('Codes change every 30 seconds, so try once more with a fresh one before');
        console.log('concluding anything. If it fails again, verify some other way.\n');
    }

    process.exitCode = 1;
}

/**
 * Removes a contact after confirmation
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: contact name
 * @returns {Promise<void>}
 */
async function commandRemove(vaultPath, args) {
    const name = args[0];

    if (!name) {
        throw new Error('Usage: npm run auth -- remove "Keren"');
    }

    const { payload, passphrase } = await openVault(vaultPath);
    const contact = manager.findContact(payload, name);

    if (!contact) {
        throw new Error(`No contact named "${name}"`);
    }

    const answer = await ask(`Remove "${contact.name}" and revoke their shared key? [y/N] `);

    if (answer.toLowerCase() !== 'y') {
        console.log('\nNothing changed.\n');
        return;
    }

    manager.removeContact(payload, contact.name);
    vault.saveVault(vaultPath, payload, passphrase);

    console.log(`\n${colors.green}Removed "${contact.name}".${colors.reset}`);
    console.log(`${colors.dim}Delete the matching entry from Google Authenticator on both phones too.${colors.reset}\n`);
}

/**
 * Renames a contact
 * @param {string} vaultPath - Path to the vault file
 * @param {Array<string>} args - Command arguments: old name, new name
 * @returns {Promise<void>}
 */
async function commandRename(vaultPath, args) {
    const [oldName, newName] = args;

    if (!oldName || !newName) {
        throw new Error('Usage: npm run auth -- rename "Keren" "Keren M."');
    }

    const { payload, passphrase } = await openVault(vaultPath);
    manager.renameContact(payload, oldName, newName);
    vault.saveVault(vaultPath, payload, passphrase);

    console.log(`\n${colors.green}Renamed "${oldName}" to "${newName}".${colors.reset}`);
    console.log(`${colors.dim}This only changes the label here - nobody needs to re-enroll.${colors.reset}\n`);
}

/**
 * Prints usage help
 * @returns {void}
 */
function commandHelp() {
    console.log(`
${colors.bold}Family & Friends Authenticator${colors.reset}
Prove it is really you, without trusting the phone line.

${colors.bold}Commands${colors.reset}
  init                        Create the encrypted vault
  add "<name>"                Enroll someone and show their QR code
  show "<name>"               Show that QR code again (new phone, lost entry)
  list                        Who is enrolled
  code ["<name>"]  [--watch]  Your current code, to read out to them
  verify "<name>" [code]      Check a code they read out to you
  rename "<old>" "<new>"      Rename a contact
  remove "<name>"             Revoke a shared key

${colors.bold}Examples${colors.reset}
  npm run auth -- init
  npm run auth -- add "Keren"
  npm run auth -- code --watch
  npm run auth -- verify "Keren" 123456

${colors.bold}Environment${colors.reset}
  AUTH_VAULT_PATH   Where the vault lives (default ./data/authenticator/vault.json)
  AUTH_PASSPHRASE   Skips the passphrase prompt - for scripts only
`);
}

/**
 * Splits argv into flags and positional arguments
 * @param {Array<string>} argv - Raw arguments
 * @returns {{command: string, args: Array<string>, flags: Object}} Parsed input
 */
function parseArgs(argv) {
    const flags = {};
    const positional = [];

    argv.forEach(argument => {
        if (argument.startsWith('--')) {
            flags[argument.slice(2)] = true;
        } else {
            positional.push(argument);
        }
    });

    return { command: positional[0] || 'help', args: positional.slice(1), flags };
}

/**
 * Runs the CLI
 * @param {Array<string>} argv - Arguments after the script name
 * @returns {Promise<void>}
 */
async function run(argv) {
    const { command, args, flags } = parseArgs(argv);
    const vaultPath = DEFAULT_VAULT_PATH;

    switch (command) {
        case 'init':
            return commandInit(vaultPath);
        case 'add':
            return commandAdd(vaultPath, args);
        case 'show':
            return commandShow(vaultPath, args);
        case 'list':
            return commandList(vaultPath);
        case 'code':
        case 'codes':
            return commandCode(vaultPath, args, flags);
        case 'verify':
            return commandVerify(vaultPath, args);
        case 'rename':
            return commandRename(vaultPath, args);
        case 'remove':
        case 'delete':
            return commandRemove(vaultPath, args);
        case 'help':
        case '--help':
        case '-h':
            return commandHelp();
        default:
            throw new Error(`Unknown command "${command}". Run "npm run auth -- help".`);
    }
}

module.exports = { run, parseArgs, renderCodes, DEFAULT_VAULT_PATH };
