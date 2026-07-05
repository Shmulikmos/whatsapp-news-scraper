# Content Factory — Automated Faceless Channel

A hands-off pipeline that turns a **topic** into a published short-form video:

```
topic → AI script (Claude) → voiceover (TTS) → stock footage (Pexels)
      → rendered vertical video with captions (ffmpeg)
      → published to YouTube Shorts / Instagram Reels / TikTok
      → analytics tracked → AI advisor queues the next topics
```

You add topics (or let the AI advisor generate them), and GitHub Actions produces and publishes a video **every day** and reviews performance **every week**.

## Quick start

```bash
npm install
node content-factory/cli.js status          # see what's configured
node content-factory/cli.js add "5 psychological tricks stores use on you"
node content-factory/cli.js run --dry       # render a video locally without publishing
node content-factory/cli.js run             # produce + publish next topic
node content-factory/cli.js analytics       # refresh stats → REPORT.md
node content-factory/cli.js advise          # AI performance review + auto-queue new topics
```

Local runs need **ffmpeg** installed (`sudo apt install ffmpeg` / `brew install ffmpeg`). The GitHub Actions runs install it automatically.

## One-time setup (honest list)

The pipeline is fully automatic **after** these one-time steps. No way around them — every platform requires its own credentials.

### Required (to produce videos at all)
| What | Where | Env var |
|---|---|---|
| Claude API key (scripts + advisor) | [console.anthropic.com](https://console.anthropic.com) | `ANTHROPIC_API_KEY` |
| TTS voice — ElevenLabs (best) or OpenAI | [elevenlabs.io](https://elevenlabs.io) / [platform.openai.com](https://platform.openai.com) | `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` |

### Strongly recommended
| What | Where | Env var |
|---|---|---|
| Pexels key (free stock footage; without it videos render on a plain animated background) | [pexels.com/api](https://www.pexels.com/api/) | `PEXELS_API_KEY` |

### Per platform
**YouTube** (easiest, start here)
1. Create the channel on YouTube.
2. Google Cloud Console → new project → enable **YouTube Data API v3** → OAuth client (type *Web application*, redirect URI `http://127.0.0.1:8089/oauth2callback`).
3. Set `YT_CLIENT_ID` + `YT_CLIENT_SECRET`, run `node content-factory/cli.js auth-youtube`, follow the URL, copy the printed `YT_REFRESH_TOKEN`.

**Instagram Reels**
1. Instagram **Business/Creator** account linked to a Facebook Page.
2. Meta developer app → Instagram Graph API → long-lived access token with `instagram_content_publish` → `IG_ACCESS_TOKEN`, `IG_USER_ID`.
3. The Reels API only accepts a public video URL, so create a free [Cloudinary](https://cloudinary.com) account + an **unsigned upload preset** → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`.

**TikTok**
1. [developers.tiktok.com](https://developers.tiktok.com) → app with **Content Posting API**, `video.publish` scope → `TT_ACCESS_TOKEN`.
2. ⚠️ Until TikTok audits/approves your app, posts are forced private (`SELF_ONLY`). Set `TT_PRIVACY_LEVEL=SELF_ONLY` before approval, `PUBLIC_TO_EVERYONE` after. Approval takes a few days — apply early.

### Channel identity
Set these so every script stays on-brand (env vars locally, repository **Variables** in GitHub):

```
CHANNEL_NAME="Mind Unlocked"
CHANNEL_NICHE="psychology facts and human behavior"
CHANNEL_LANGUAGE="English"        # or "Hebrew" etc.
CHANNEL_TONE="energetic, curious, hook-driven"
TARGET_DURATION_SEC=45
```

## Turning on full automation

1. Merge this branch to `main` (scheduled workflows only run from the default branch).
2. GitHub repo → **Settings → Secrets and variables → Actions**: add every key above as a **Secret**, and the `CHANNEL_*` values as **Variables**.
3. Done. From then on:
   - **Daily 14:00 UTC** — `content-daily.yml` takes the next queued topic, produces the video, publishes everywhere configured, and commits the updated queue/history/report back to the repo.
   - **Weekly Monday** — `content-weekly.yml` pulls YouTube stats, updates `REPORT.md`, and the AI advisor analyzes what performed and **adds the next 7 topics to the queue automatically** — the self-scaling loop.
   - Any time — run the daily workflow manually from the Actions tab, optionally typing a topic and a count.

Seed the queue with ~7-10 topics before the first run so the daily job always has material.

## Monitoring

- `content-factory/REPORT.md` — always-current dashboard: every video, views/likes/comments, plus the advisor's latest strategy notes. Committed to the repo so you can read it from your phone.
- `content-factory/queue.json` / `published.json` — full machine-readable state and history.
- Rendered videos are attached to each workflow run as an artifact for 7 days (useful for dry runs and audits).

## Money & platform reality (read once)

- **Monetization thresholds are set by the platforms, not the code**: YouTube Partner Program needs 1K subs + 10M Shorts views in 90 days (or 4K watch hours); TikTok Creator Rewards needs 10K followers + 100K views/30 days; Instagram bonuses are invite-based. The realistic path: publish daily, let the advisor iterate on what works, expect months not days.
- **AI-disclosure rules**: YouTube and TikTok require flagging realistic synthetic content. Voiceover-over-stock-footage content like this is generally fine, but review each platform's current policy.
- **Don't spam**: 1-3 quality posts/day is the sane ceiling. Platforms down-rank mass-produced low-effort content ("inauthentic behavior"), and API quotas (YouTube: ~6 uploads/day on default quota) enforce this anyway.
- Keep API keys in GitHub Secrets, never commit them.

## Architecture

```
content-factory/
├── cli.js                 # all commands
├── config.js              # env-driven config
├── queue.json             # topic queue (tracked in git — CI state)
├── published.json         # publish history + stats (tracked in git)
├── REPORT.md              # human dashboard (generated)
├── data/                  # temp renders (gitignored)
└── lib/
    ├── pipeline.js        # orchestrates one topic end-to-end
    ├── script.js          # Claude → narration/titles/captions/keywords
    ├── tts.js             # ElevenLabs / OpenAI voiceover
    ├── visuals.js         # Pexels portrait stock clips
    ├── subtitles.js       # styled ASS captions
    ├── video.js           # ffmpeg 1080x1920 assembly
    ├── analytics.js       # YouTube stats → REPORT.md
    ├── advisor.js         # AI growth loop → new queue topics
    └── publish/           # youtube.js, instagram.js, tiktok.js, authYoutube.js
```
