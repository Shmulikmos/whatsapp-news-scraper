# Video Digest & Knowledge Archive — Design

**Date**: 2026-09-04
**Branch**: `claude/video-summary-archive-tool-35kx0o`
**Purpose**: Send a YouTube / Instagram video link, get back a structured summary, extracted links & GitHub repos, a topic-indexed table in Google Sheets, and the ability to ask questions over everything accumulated.

---

## 1. Requirements

### Functional
- **FR1** Accept a YouTube or Instagram video URL through a stable, repeatable channel.
- **FR2** Extract video content: metadata (title, channel, date, duration), description, and a transcript.
- **FR3** Transcript strategy: existing captions first (fast, free); fall back to ASR on the audio track only when captions are missing.
- **FR4** Produce a structured summary: TL;DR, key points, topics, action items, tools/products mentioned.
- **FR5** Extract every link and detail: URLs from description + transcript, @handles, hashtags, timestamps.
- **FR6** Detect GitHub repositories mentioned in the video and enrich them with live repo metadata (description, stars, language, license, last push).
- **FR7** Store everything in Google Sheets — a topic-indexed table — as the primary, always-accessible store.
- **FR8** Keep a full local archive (Markdown + JSON) for the long content that does not belong in a spreadsheet cell.
- **FR9** Answer free-text questions over the accumulated archive, with citations back to the source videos.

### Non-functional
- **NFR1** Idempotent: re-sending the same link must not create a duplicate row.
- **NFR2** Resumable: each pipeline stage caches its output, so a failure re-runs only what is missing.
- **NFR3** Cost-aware: captions before ASR; prompt caching on the stable system prompt; transcript truncation is explicit and recorded, never silent.
- **NFR4** Hebrew/RTL safe throughout (UTF-8, no locale-dependent parsing).
- **NFR5** Every external process/network call is bounded (timeout + output cap).

---

## 2. Architecture

```
  link in                pipeline stages                        stores
  ───────                ───────────────                        ──────
  CLI  ─┐
        ├──▶ urlParser ──▶ extractor ──▶ transcript ──┐
  WA   ─┘   (allowlist)    (yt-dlp)     (subs → ASR)  │
                                                      ▼
                                    entities ──▶ githubEnricher
                                                      │
                                                      ▼
                                                 summarizer  ──▶ archive/  (md + json, full text)
                                                 (Claude)     └─▶ Sheets   (Videos + Topics tabs)
                                                                     │
                                                    ask ◀────────────┘
```

| Module | File | Responsibility |
|---|---|---|
| URL parser | `src/video/urlParser.js` | Host allowlist, canonical URL, stable `videoId`, platform detection |
| Extractor | `src/video/extractor.js` | `yt-dlp` wrapper — metadata JSON, subtitle files, audio fallback |
| Link URL | `src/video/linkUrl.js` | SSRF-aware validation for arbitrary web links, tracking-param stripping, stable content id |
| Web page | `src/video/webPage.js` | Page fetch with per-hop re-validation; title/meta/OG/JSON-LD/text extraction |
| Subtitles | `src/video/subtitles.js` | VTT / SRT / json3 → de-duplicated plain text with timestamps |
| Transcriber | `src/video/transcriber.js` | ASR fallback over the audio track (pluggable CLI) |
| Entities | `src/video/entities.js` | URLs, GitHub repos, @handles, #hashtags, chapter timestamps |
| GitHub enricher | `src/video/githubEnricher.js` | Read-only GitHub REST metadata for detected repos |
| Summarizer | `src/video/summarizer.js` | Claude structured-output summary over untrusted content |
| Archive | `src/video/archive.js` | Local `data/archive/<id>.json` + `.md`, plus `index.json` |
| Topics sheet | `src/video/topicsSheet.js` | Google Sheets read/write — `Videos` and `Topics` tabs |
| Q&A | `src/video/qa.js` | Retrieve from archive/sheet → answer with citations |
| Pipeline | `src/video/pipeline.js` | Orchestration, caching, idempotency |

### Entry points
- `npm run digest -- <url>` — one link, end to end.
- `npm run ask -- "<question>"` — question over the archive.
- `npm run watch:whatsapp` — listens on a WhatsApp chat, digests any link posted there, replies with the TL;DR. Reuses the existing `src/client.js`.

Both channels call the same `pipeline.digest()`; the CLI is the contract and the WhatsApp watcher is a thin adapter over it.

---

## 3. Data model

`Videos` tab — one row per video (the "everything at a glance" table):

| Column | Source |
|---|---|
| `id` | `youtube:dQw4w9WgXcQ` / `instagram:Cx1y2z3` — dedupe key |
| `added_at`, `platform`, `url` | pipeline |
| `title`, `channel`, `published_at`, `duration_sec` | yt-dlp metadata |
| `topics` | summarizer (`; ` joined) |
| `tldr` | summarizer |
| `key_points` | summarizer (numbered, `\n` joined) |
| `action_items` | summarizer |
| `tools_mentioned` | summarizer |
| `github_repos` | enricher (`owner/repo (★stars) — description`) |
| `links` | entities |
| `transcript_source` | `captions` \| `asr` \| `none` |
| `archive_path` | relative path to the full Markdown |

`Topics` tab — one row per (topic, video) pair, so the table can be filtered/pivoted by subject:

| `topic` | `video_id` | `title` | `url` | `added_at` | `relevance` | `why` |

Local archive `data/archive/<id>.json` holds the same record **plus** the full transcript and raw description — the parts that are too large and too noisy for a spreadsheet. `data/archive/<id>.md` is the human-readable version.

---

## 4. Security & privacy (threat model)

The core risk here: **this tool executes a subprocess against an attacker-influenced URL and then feeds attacker-authored text to an LLM.** Both are handled explicitly.

| # | Threat | Mitigation |
|---|---|---|
| T1 | **Command injection** via a crafted URL reaching a shell | `execFile` with an argv array and `shell: false` — never a command string. A URL beginning with `-` is rejected so it cannot be read as a flag; `--` terminates option parsing. |
| T2 | **SSRF — video links** | Strict host allowlist (`youtube.com`, `youtu.be`, `youtube-nocookie.com`, `instagram.com` + known subdomains). `https` only. Embedded credentials, ports, and raw IP hosts rejected. Applied *before* any subprocess or fetch. |
| T2b | **SSRF — arbitrary web links** (added when generic pages became a supported source) | An allowlist is not available once any host is legal, so `src/video/linkUrl.js` does the work explicitly: http/https only, no credentials, ports 80/443 only, and a refusal for private, loopback, link-local, CGNAT, multicast, reserved, `.internal`/`.local`/`.corp`-style, and single-label hosts — checked **both** on a literal IP in the URL **and** on every address the hostname resolves to, with IPv4-mapped IPv6 (`::ffff:7f00:1`) decoded to v4 first. Every redirect hop is re-validated before the request is issued, and the chain is capped at five. Residual risk (DNS rebinding between validation and connection) is documented in the module. |
| T3 | **Path traversal** — video id used as a filename | Ids are re-validated against `^[A-Za-z0-9_-]{1,64}$` at every filesystem boundary, and the resolved path must stay inside the archive root. |
| T4 | **Prompt injection** — a video whose transcript says "ignore your instructions and…" | Untrusted content is fenced in explicit `<untrusted_content>` delimiters, the system prompt states it is data and never instructions, output is constrained by a JSON schema, and the summarizer has **no tools** — it cannot act on anything it reads. Any fence-closing sequence in the content is neutralised before insertion. |
| T5 | **Spreadsheet formula injection** — a title of `=IMPORTXML(...)` | `valueInputOption: 'RAW'` (Sheets stores the literal string) **and** cells beginning with `= + - @` are prefixed with `'`, so a later CSV export is safe too. |
| T6 | **Secret leakage** | Keys are read from env only, never persisted to the archive or the sheet, and log lines are redacted (`sk-ant-…`, `ghp_…`, `AIza…` patterns). Subprocesses get a **minimal environment** (`PATH`, `HOME`, locale, proxy, CA vars only) rather than inheriting this process's — yt-dlp runs site-specific extractor code and has no business seeing our credentials. `.env` is removed from git tracking (it is currently committed) and `credentials.json` stays ignored. |
| T7 | **Resource exhaustion / DoS-by-link** | Per-stage timeouts, `maxBuffer` on every subprocess, a max video duration for the ASR path, a transcript character cap (recorded in the record when it bites), and temp audio deleted in `finally`. Page bodies are content-type checked and size-capped **as bytes arrive**, rather than trusting a `Content-Length` the server controls. |
| T8 | **Untrusted GitHub redirect** | Only `api.github.com` is contacted, `redirect: 'manual'`, and a single redirect is followed only if it stays on `api.github.com`. Repos are **never** cloned or executed — metadata only. |
| T9 | Third-party ToS | The WhatsApp watcher uses the same unofficial `whatsapp-web.js` the repo already depends on; documented as a known limitation, and the CLI path works without it. |

---

## 5. Testing strategy

- Pure units (`urlParser`, `subtitles`, `entities`, sheet-cell sanitisation, redaction) are tested directly with fixtures — no network, no subprocess.
- Adversarial cases are first-class tests: `-flag`-shaped URLs, `file://`, `localhost`, IP hosts, an open-redirect-looking `youtube.com.evil.com`, `../../` in ids, `=cmd()` cell values, and a fence-escape attempt in a transcript.
- I/O modules (`extractor`, `githubEnricher`, `summarizer`, `topicsSheet`) are structured so the transport is injectable, and are covered by mocked tests rather than live calls.
