const fs = require('fs');
const os = require('os');
const path = require('path');

const vault = require('../src/authenticator/vault');

describe('Encrypted Vault', () => {
    let workDir;
    let vaultPath;

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-vault-'));
        vaultPath = path.join(workDir, 'nested', 'vault.json');
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    describe('encryptPayload / decryptPayload', () => {
        test('should round-trip a payload', () => {
            const payload = { ownerName: 'Shmulik', contacts: [{ name: 'Keren', secret: 'ABCD' }] };
            const encrypted = vault.encryptPayload(payload, 'correct horse battery');

            expect(vault.decryptPayload(encrypted, 'correct horse battery')).toEqual(payload);
        });

        test('should not leave the secret readable in the encrypted form', () => {
            const encrypted = vault.encryptPayload({ contacts: [{ secret: 'JBSWY3DPEHPK3PXP' }] }, 'pass');

            expect(JSON.stringify(encrypted)).not.toContain('JBSWY3DPEHPK3PXP');
        });

        test('should use a fresh salt and IV for every write', () => {
            const first = vault.encryptPayload({ contacts: [] }, 'pass');
            const second = vault.encryptPayload({ contacts: [] }, 'pass');

            expect(first.salt).not.toBe(second.salt);
            expect(first.iv).not.toBe(second.iv);
            expect(first.ciphertext).not.toBe(second.ciphertext);
        });

        test('should reject a wrong passphrase', () => {
            const encrypted = vault.encryptPayload({ contacts: [] }, 'right');

            expect(() => vault.decryptPayload(encrypted, 'wrong')).toThrow(/wrong passphrase/);
        });

        test('should detect a tampered ciphertext', () => {
            const encrypted = vault.encryptPayload({ contacts: [{ name: 'Keren' }] }, 'pass');
            const bytes = Buffer.from(encrypted.ciphertext, 'base64');
            bytes[0] ^= 0xff;

            expect(() => vault.decryptPayload({ ...encrypted, ciphertext: bytes.toString('base64') }, 'pass'))
                .toThrow(/altered/);
        });

        test('should reject an unknown vault version', () => {
            const encrypted = vault.encryptPayload({ contacts: [] }, 'pass');

            expect(() => vault.decryptPayload({ ...encrypted, version: 99 }, 'pass')).toThrow(/Unsupported vault version/);
        });
    });

    describe('saveVault / loadVault', () => {
        test('should create missing directories and persist the payload', () => {
            const payload = vault.createEmptyPayload('Shmulik');
            payload.contacts.push({ name: 'Keren', secret: 'JBSWY3DPEHPK3PXP' });

            vault.saveVault(vaultPath, payload, 'pass');

            expect(vault.vaultExists(vaultPath)).toBe(true);
            expect(vault.loadVault(vaultPath, 'pass')).toEqual(payload);
        });

        test('should write the vault with owner-only permissions', () => {
            vault.saveVault(vaultPath, vault.createEmptyPayload(), 'pass');

            if (process.platform !== 'win32') {
                expect(fs.statSync(vaultPath).mode & 0o777).toBe(0o600);
            }
        });

        test('should not leave a temporary file behind', () => {
            vault.saveVault(vaultPath, vault.createEmptyPayload(), 'pass');

            expect(fs.existsSync(`${vaultPath}.tmp`)).toBe(false);
        });

        test('should overwrite an existing vault in place', () => {
            const payload = vault.createEmptyPayload('Shmulik');
            vault.saveVault(vaultPath, payload, 'pass');

            payload.contacts.push({ name: 'Keren' });
            vault.saveVault(vaultPath, payload, 'pass');

            expect(vault.loadVault(vaultPath, 'pass').contacts).toHaveLength(1);
        });

        test('should explain what to do when there is no vault yet', () => {
            expect(() => vault.loadVault(vaultPath, 'pass')).toThrow(/auth init/);
        });

        test('should report an unreadable vault file clearly', () => {
            fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
            fs.writeFileSync(vaultPath, 'not json at all');

            expect(() => vault.loadVault(vaultPath, 'pass')).toThrow(/not readable JSON/);
        });
    });

    describe('createEmptyPayload', () => {
        test('should start with no contacts', () => {
            const payload = vault.createEmptyPayload('Shmulik');

            expect(payload.ownerName).toBe('Shmulik');
            expect(payload.contacts).toEqual([]);
            expect(Date.parse(payload.createdAt)).not.toBeNaN();
        });
    });
});
