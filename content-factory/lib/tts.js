const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log, ensureDir } = require('./util');

async function elevenlabsTTS(text, outFile) {
    const { apiKey, voiceId, modelId } = config.tts.elevenlabs;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

async function openaiTTS(text, outFile) {
    const { apiKey, voice, model } = config.tts.openai;
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' })
    });
    if (!res.ok) throw new Error(`OpenAI TTS failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

// Renders narration to an mp3 voiceover. Returns the file path.
async function synthesize(text, workdir) {
    ensureDir(workdir);
    const outFile = path.join(workdir, 'voiceover.mp3');
    const provider = config.tts.provider;

    log('tts', `Synthesizing voiceover with ${provider}...`);
    if (provider === 'elevenlabs') {
        if (!config.tts.elevenlabs.apiKey) throw new Error('TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set');
        await elevenlabsTTS(text, outFile);
    } else if (provider === 'openai') {
        if (!config.tts.openai.apiKey) throw new Error('No TTS credentials: set ELEVENLABS_API_KEY or OPENAI_API_KEY');
        await openaiTTS(text, outFile);
    } else {
        throw new Error(`Unknown TTS_PROVIDER "${provider}" (use elevenlabs or openai)`);
    }
    log('tts', `Voiceover saved: ${outFile}`);
    return outFile;
}

module.exports = { synthesize };
