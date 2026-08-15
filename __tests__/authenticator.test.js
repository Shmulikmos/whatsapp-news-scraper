const manager = require('../src/authenticator/manager');
const vault = require('../src/authenticator/vault');
const totp = require('../src/authenticator/totp');

describe('Contact Manager', () => {
    let payload;

    beforeEach(() => {
        payload = vault.createEmptyPayload('Shmulik');
    });

    describe('addContact', () => {
        test('should give each contact their own secret', () => {
            const keren = manager.addContact(payload, { name: 'Keren' });
            const dad = manager.addContact(payload, { name: 'אבא' });

            expect(keren.secret).not.toBe(dad.secret);
            expect(totp.decodeBase32(keren.secret)).toHaveLength(20);
            expect(payload.contacts).toHaveLength(2);
        });

        test('should store the note and start with no verification history', () => {
            const contact = manager.addContact(payload, { name: 'Keren', note: 'handed over in person' });

            expect(contact.note).toBe('handed over in person');
            expect(contact.lastVerifiedStep).toBeNull();
            expect(contact.verifiedCount).toBe(0);
        });

        test('should require a name', () => {
            expect(() => manager.addContact(payload, { name: '   ' })).toThrow(/needs a name/);
        });

        test('should refuse a duplicate name regardless of case or spacing', () => {
            manager.addContact(payload, { name: 'Keren' });

            expect(() => manager.addContact(payload, { name: '  keren ' })).toThrow(/already exists/);
        });
    });

    describe('findContact', () => {
        test('should match case-insensitively and ignore surrounding spaces', () => {
            manager.addContact(payload, { name: 'Keren' });

            expect(manager.findContact(payload, ' KEREN ').name).toBe('Keren');
            expect(manager.findContact(payload, 'nobody')).toBeUndefined();
        });

        test('should match Hebrew names', () => {
            manager.addContact(payload, { name: 'אבא' });

            expect(manager.findContact(payload, 'אבא')).toBeDefined();
        });
    });

    describe('currentCode', () => {
        test('should produce the code the other phone shows at the same moment', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const timestamp = 1700000010; // exactly on a 30-second boundary

            const mine = manager.currentCode(contact, timestamp);
            const theirs = totp.generateTotp({ secret: contact.secret, timestamp });

            expect(mine.code).toBe(theirs);
            expect(mine.code).toMatch(/^\d{6}$/);
            expect(mine.secondsRemaining).toBe(30);
        });
    });

    describe('verifyContactCode', () => {
        const timestamp = 1700000000;

        test('should accept a code from the right person', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const token = totp.generateTotp({ secret: contact.secret, timestamp });

            const result = manager.verifyContactCode(payload, 'Keren', token, { timestamp });

            expect(result.valid).toBe(true);
            expect(result.delta).toBe(0);
            expect(contact.verifiedCount).toBe(1);
            expect(contact.lastVerifiedAt).toBe(new Date(timestamp * 1000).toISOString());
        });

        test('should reject a code from a different contact', () => {
            manager.addContact(payload, { name: 'Keren' });
            const impostor = manager.addContact(payload, { name: 'Dan' });
            const token = totp.generateTotp({ secret: impostor.secret, timestamp });

            const result = manager.verifyContactCode(payload, 'Keren', token, { timestamp });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('no_match');
        });

        test('should reject a replay of a code that already passed', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const token = totp.generateTotp({ secret: contact.secret, timestamp });

            expect(manager.verifyContactCode(payload, 'Keren', token, { timestamp }).valid).toBe(true);

            // Same code, a few seconds later in the same 30-second window
            const replay = manager.verifyContactCode(payload, 'Keren', token, { timestamp: timestamp + 10 });

            expect(replay.valid).toBe(false);
            expect(replay.reason).toBe('replay');
            expect(contact.verifiedCount).toBe(1);
        });

        test('should reject an older code once a newer one has been accepted', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const older = totp.generateTotp({ secret: contact.secret, timestamp });
            const newer = totp.generateTotp({ secret: contact.secret, timestamp: timestamp + 30 });

            expect(manager.verifyContactCode(payload, 'Keren', newer, { timestamp: timestamp + 30 }).valid).toBe(true);
            expect(manager.verifyContactCode(payload, 'Keren', older, { timestamp: timestamp + 30 }).reason).toBe('replay');
        });

        test('should accept the next fresh code after a successful check', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const first = totp.generateTotp({ secret: contact.secret, timestamp });
            const second = totp.generateTotp({ secret: contact.secret, timestamp: timestamp + 30 });

            manager.verifyContactCode(payload, 'Keren', first, { timestamp });
            const result = manager.verifyContactCode(payload, 'Keren', second, { timestamp: timestamp + 30 });

            expect(result.valid).toBe(true);
            expect(contact.verifiedCount).toBe(2);
        });

        test('should tolerate a slightly slow or fast phone', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const theirSlowCode = totp.generateTotp({ secret: contact.secret, timestamp: timestamp - 25 });

            expect(manager.verifyContactCode(payload, 'Keren', theirSlowCode, { timestamp }).valid).toBe(true);
        });

        test('should not record a verification when the code fails', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });

            manager.verifyContactCode(payload, 'Keren', '000000', { timestamp });

            expect(contact.lastVerifiedStep).toBeNull();
            expect(contact.verifiedCount).toBe(0);
        });

        test('should throw for an unknown contact', () => {
            expect(() => manager.verifyContactCode(payload, 'Nobody', '123456')).toThrow(/No contact named/);
        });
    });

    describe('removeContact', () => {
        test('should revoke only that contact', () => {
            manager.addContact(payload, { name: 'Keren' });
            manager.addContact(payload, { name: 'Dan' });

            manager.removeContact(payload, 'Keren');

            expect(payload.contacts.map(contact => contact.name)).toEqual(['Dan']);
        });

        test('should throw for an unknown contact', () => {
            expect(() => manager.removeContact(payload, 'Nobody')).toThrow(/No contact named/);
        });
    });

    describe('renameContact', () => {
        test('should keep the secret so nobody has to re-enroll', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const secret = contact.secret;

            manager.renameContact(payload, 'Keren', 'Keren M.');

            expect(manager.findContact(payload, 'Keren M.').secret).toBe(secret);
            expect(manager.findContact(payload, 'Keren')).toBeUndefined();
        });

        test('should refuse a name already in use', () => {
            manager.addContact(payload, { name: 'Keren' });
            manager.addContact(payload, { name: 'Dan' });

            expect(() => manager.renameContact(payload, 'Dan', 'Keren')).toThrow(/already taken/);
        });

        test('should allow a pure case change of the same contact', () => {
            manager.addContact(payload, { name: 'keren' });

            expect(manager.renameContact(payload, 'keren', 'Keren').name).toBe('Keren');
        });

        test('should refuse an empty new name', () => {
            manager.addContact(payload, { name: 'Keren' });

            expect(() => manager.renameContact(payload, 'Keren', '  ')).toThrow(/cannot be empty/);
        });
    });

    describe('enrollmentDetails', () => {
        test('should label the entry with both names', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });
            const details = manager.enrollmentDetails(contact, payload.ownerName);

            expect(details.label).toBe('Shmulik <-> Keren');
            expect(details.uri).toContain(`secret=${contact.secret}`);
            expect(details.formattedSecret).toContain(' ');
            expect(details.formattedSecret.replace(/ /g, '')).toBe(contact.secret);
        });

        test('should fall back to the contact name when no owner name is set', () => {
            const contact = manager.addContact(payload, { name: 'Keren' });

            expect(manager.enrollmentDetails(contact, '').label).toBe('Keren');
        });
    });

    describe('listContacts', () => {
        test('should summarize contacts without exposing secrets', () => {
            manager.addContact(payload, { name: 'Keren', note: 'in person' });

            const [summary] = manager.listContacts(payload);

            expect(summary).toEqual({
                name: 'Keren',
                note: 'in person',
                createdAt: expect.any(String),
                lastVerifiedAt: null,
                verifiedCount: 0
            });
            expect(JSON.stringify(summary)).not.toContain(payload.contacts[0].secret);
        });
    });
});

describe('End to end', () => {
    test('two phones with the same enrolled secret agree on the code', () => {
        const payload = vault.createEmptyPayload('Shmulik');
        const contact = manager.addContact(payload, { name: 'Keren' });

        // Keren scans the QR code; her app now derives codes from the same secret
        const uri = new URL(manager.enrollmentDetails(contact, payload.ownerName).uri);
        const kerensSecret = uri.searchParams.get('secret');

        const timestamp = 1700000123;
        const kerensCode = totp.generateTotp({ secret: kerensSecret, timestamp });

        // Keren reads her code out; Shmulik checks it
        const result = manager.verifyContactCode(payload, 'Keren', kerensCode, { timestamp });

        expect(result.valid).toBe(true);
    });
});
