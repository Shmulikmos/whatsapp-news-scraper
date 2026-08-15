const totp = require('../src/authenticator/totp');

// RFC 6238 appendix B uses the ASCII seed "12345678901234567890"
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP Core', () => {
    describe('base32', () => {
        test('should encode the RFC 6238 seed to the expected base32 string', () => {
            expect(totp.encodeBase32(RFC_SEED)).toBe(RFC_SECRET);
        });

        test('should round-trip arbitrary bytes', () => {
            const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
            expect(totp.decodeBase32(totp.encodeBase32(bytes))).toEqual(bytes);
        });

        test('should tolerate spaces, hyphens, lowercase and padding', () => {
            const canonical = totp.decodeBase32(RFC_SECRET);

            expect(totp.decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(canonical);
            expect(totp.decodeBase32('GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ')).toEqual(canonical);
            expect(totp.decodeBase32(`${RFC_SECRET}======`)).toEqual(canonical);
        });

        test('should reject characters outside the base32 alphabet', () => {
            expect(() => totp.decodeBase32('ABC1DEF')).toThrow(/Invalid base32 character/);
        });

        test('should reject an empty secret', () => {
            expect(() => totp.decodeBase32('   ')).toThrow(/empty/);
        });
    });

    describe('generateTotp', () => {
        // Expected values are the RFC 6238 SHA-1 vectors truncated to 6 digits,
        // which is exactly what Google Authenticator displays
        const vectors = [
            { timestamp: 59, expected: '287082' },
            { timestamp: 1111111109, expected: '081804' },
            { timestamp: 1111111111, expected: '050471' },
            { timestamp: 1234567890, expected: '005924' },
            { timestamp: 2000000000, expected: '279037' }
        ];

        vectors.forEach(({ timestamp, expected }) => {
            test(`should match the RFC 6238 vector at T=${timestamp}`, () => {
                expect(totp.generateTotp({ secret: RFC_SECRET, timestamp })).toBe(expected);
            });
        });

        test('should produce 8-digit codes when asked', () => {
            expect(totp.generateTotp({ secret: RFC_SECRET, timestamp: 59, digits: 8 })).toBe('94287082');
        });

        test('should hold the same code for the whole 30 second step', () => {
            const start = totp.generateTotp({ secret: RFC_SECRET, timestamp: 1234567890 });

            expect(totp.generateTotp({ secret: RFC_SECRET, timestamp: 1234567890 + 29 })).toBe(start);
            expect(totp.generateTotp({ secret: RFC_SECRET, timestamp: 1234567890 + 30 })).not.toBe(start);
        });
    });

    describe('generateSecret', () => {
        test('should produce a decodable 160-bit secret by default', () => {
            const secret = totp.generateSecret();

            expect(totp.decodeBase32(secret)).toHaveLength(20);
            expect(secret).toMatch(/^[A-Z2-7]+$/);
        });

        test('should produce a different secret every time', () => {
            const secrets = new Set(Array.from({ length: 20 }, () => totp.generateSecret()));
            expect(secrets.size).toBe(20);
        });

        test('should refuse dangerously short secrets', () => {
            expect(() => totp.generateSecret(8)).toThrow(/at least 16 bytes/);
        });
    });

    describe('verifyTotp', () => {
        const secret = totp.generateSecret();
        const timestamp = 1700000000;

        test('should accept the current code', () => {
            const token = totp.generateTotp({ secret, timestamp });
            expect(totp.verifyTotp({ secret, token, timestamp })).toEqual({
                valid: true,
                delta: 0,
                step: totp.counterFromTime(timestamp)
            });
        });

        test('should accept one step of drift in each direction', () => {
            const previous = totp.generateTotp({ secret, timestamp: timestamp - 30 });
            const next = totp.generateTotp({ secret, timestamp: timestamp + 30 });

            expect(totp.verifyTotp({ secret, token: previous, timestamp }).delta).toBe(-1);
            expect(totp.verifyTotp({ secret, token: next, timestamp }).delta).toBe(1);
        });

        test('should reject drift beyond the window', () => {
            const stale = totp.generateTotp({ secret, timestamp: timestamp - 90 });
            expect(totp.verifyTotp({ secret, token: stale, timestamp }).valid).toBe(false);
        });

        test('should reject a code generated from a different secret', () => {
            const token = totp.generateTotp({ secret: totp.generateSecret(), timestamp });
            expect(totp.verifyTotp({ secret, token, timestamp }).valid).toBe(false);
        });

        test('should reject malformed input without throwing', () => {
            ['', '12345', '1234567', 'abcdef', null, undefined].forEach(token => {
                expect(totp.verifyTotp({ secret, token, timestamp }).valid).toBe(false);
            });
        });

        test('should ignore spaces in a code read out loud', () => {
            const token = totp.generateTotp({ secret, timestamp });
            const spaced = `${token.slice(0, 3)} ${token.slice(3)}`;

            expect(totp.verifyTotp({ secret, token: spaced, timestamp }).valid).toBe(true);
        });
    });

    describe('secondsRemaining', () => {
        test('should count down within the step', () => {
            // 1700000010 sits exactly on a 30-second boundary
            expect(totp.secondsRemaining(1700000010)).toBe(30);
            expect(totp.secondsRemaining(1700000011)).toBe(29);
            expect(totp.secondsRemaining(1700000039)).toBe(1);
            expect(totp.secondsRemaining(1700000040)).toBe(30);
        });
    });

    describe('buildOtpauthUri', () => {
        test('should build a Google Authenticator compatible URI', () => {
            const uri = totp.buildOtpauthUri({ secret: RFC_SECRET, label: 'Shmulik <-> Keren' });
            const parsed = new URL(uri);

            expect(parsed.protocol).toBe('otpauth:');
            expect(parsed.host).toBe('totp');
            expect(decodeURIComponent(parsed.pathname)).toBe('/Family Verify:Shmulik <-> Keren');
            expect(parsed.searchParams.get('secret')).toBe(RFC_SECRET);
            expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
            expect(parsed.searchParams.get('digits')).toBe('6');
            expect(parsed.searchParams.get('period')).toBe('30');
        });

        test('should require a secret and a label', () => {
            expect(() => totp.buildOtpauthUri({ label: 'Keren' })).toThrow(/secret/);
            expect(() => totp.buildOtpauthUri({ secret: RFC_SECRET })).toThrow(/label/);
        });
    });

    describe('formatSecret', () => {
        test('should group the key for manual entry', () => {
            expect(totp.formatSecret(RFC_SECRET)).toBe('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
        });
    });
});
