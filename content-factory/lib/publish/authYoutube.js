const http = require('http');
const { google } = require('googleapis');
const config = require('../../config');

// One-time interactive flow to obtain a YouTube refresh token.
// Prints an auth URL, catches the redirect on localhost, prints the token.
async function authYouTube() {
    const { clientId, clientSecret } = config.youtube;
    if (!clientId || !clientSecret) {
        console.error('Set YT_CLIENT_ID and YT_CLIENT_SECRET first (Google Cloud Console → OAuth client, type "Web application", redirect URI http://127.0.0.1:8089/oauth2callback).');
        process.exit(1);
    }
    const redirect = 'http://127.0.0.1:8089/oauth2callback';
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
    const url = oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']
    });

    console.log('\n1. Open this URL in your browser and approve access:\n');
    console.log(url);
    console.log('\n2. Waiting for the redirect on http://127.0.0.1:8089 ...\n');

    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const u = new URL(req.url, redirect);
            if (u.pathname !== '/oauth2callback') { res.end(); return; }
            res.end('Authorized! You can close this tab and return to the terminal.');
            server.close();
            u.searchParams.get('code') ? resolve(u.searchParams.get('code')) : reject(new Error('No code in redirect'));
        });
        server.listen(8089, '127.0.0.1');
    });

    const { tokens } = await oauth2.getToken(code);
    console.log('\nAdd this to your .env / GitHub secrets:\n');
    console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

module.exports = { authYouTube };
