/**
 * AI Connection Test - Verifies connectivity to Grok (xAI) and Perplexity
 * Run with: npm run test:ai
 */

const { testConnections } = require('./src/aiClients');

async function main() {
    console.log('\n========================================');
    console.log('  AI Provider Connection Test');
    console.log('========================================\n');

    const results = await testConnections();

    console.log('');
    const connected = results.filter(r => r.connected).length;
    console.log(`${connected}/${results.length} providers connected\n`);

    // Exit non-zero only if a configured provider failed to connect
    const configuredFailure = results.some(
        r => !r.connected && r.error !== 'API key not configured'
    );
    process.exit(configuredFailure ? 1 : 0);
}

main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
