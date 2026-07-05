const config = require('../config');
const { readJson, writeJson } = require('./util');

// queue.json is tracked in git so the queue and history survive across
// scheduled CI runs (the workflow commits updates back).

function loadQueue() {
    return readJson(config.paths.queue, { topics: [] });
}

function saveQueue(q) {
    writeJson(config.paths.queue, q);
}

function addTopic(topic, { source = 'manual' } = {}) {
    const q = loadQueue();
    const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    q.topics.push({ id, topic, status: 'pending', source, addedAt: new Date().toISOString() });
    saveQueue(q);
    return id;
}

function nextPending() {
    return loadQueue().topics.find(t => t.status === 'pending') || null;
}

function updateTopic(id, patch) {
    const q = loadQueue();
    const t = q.topics.find(x => x.id === id);
    if (!t) throw new Error(`Topic ${id} not found in queue`);
    Object.assign(t, patch);
    saveQueue(q);
    return t;
}

function loadPublished() {
    return readJson(config.paths.published, { videos: [] });
}

function recordPublished(entry) {
    const p = loadPublished();
    p.videos.push(entry);
    writeJson(config.paths.published, p);
}

function savePublished(p) {
    writeJson(config.paths.published, p);
}

module.exports = { loadQueue, saveQueue, addTopic, nextPending, updateTopic, loadPublished, recordPublished, savePublished };
