# WhatsApp News Chat Scraper

A Node.js automation tool for extracting messages from WhatsApp group chats and exporting them to CSV format. Designed for news teams to track and analyze reporter messages efficiently.

## Features

- [x] **Automated WhatsApp Integration** - Connects to WhatsApp Web using `whatsapp-web.js`
- [x] **QR Code Authentication** - First-run QR code authentication with persistent session management
- [x] **Headless Mode Support** - Run with or without browser UI after initial authentication
- [x] **Intelligent Message Parsing** - Extracts reporter names, content, timestamps, and links
- [x] **CSV Export** - Structured data export with proper UTF-8 encoding for Hebrew text
- [x] **Incremental Updates** - Only exports new messages on subsequent runs
- [x] **State Persistence** - Tracks last processed message to avoid duplicates
- [x] **Media Detection** - Identifies messages with images, videos, and documents
- [x] **Retry Logic** - Automatic retry with exponential backoff for connection issues
- [x] **Comprehensive Logging** - Detailed logs with timestamps and log levels
- [x] **Error Handling** - Graceful error recovery and detailed error reporting
- [x] **Automated Scheduling** - Built-in macOS launchd integration for periodic scraping (every 10 minutes)
- [x] **Video Digest & Knowledge Archive** - Send a YouTube/Instagram link and get a structured summary, extracted links and GitHub repos, a topic-indexed Google Sheet, and Q&A across everything archived ([jump to section](#video-digest--knowledge-archive))

## Requirements

- **Node.js** 18.0.0 or higher
- **npm** (comes with Node.js)
- **WhatsApp Account** - Active WhatsApp account with access to the target chat
- **Operating System** - macOS, Linux, or Windows
- **Storage** - Minimum 500MB free disk space for dependencies and session data

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/username/news-chat-scraper.git
   cd news-chat-scraper
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file with your settings:**
   ```bash
   nano .env  # or use your preferred text editor
   ```

## Configuration

The `.env` file contains all configuration options:

```env
# WhatsApp Configuration
CHAT_NAME="צ'אט הכתבים N12"    # Name of the WhatsApp chat to scrape
HEADLESS=false                   # false = show browser, true = hidden

# Scraping Configuration
MAX_RETRIES=3                    # Number of connection retry attempts
RETRY_DELAY=30000                # Delay between retries (milliseconds)

# Logging Configuration
LOG_LEVEL="info"                 # Logging level: debug, info, warn, error
```

### Configuration Options Explained

| Variable | Description | Default | Options |
|----------|-------------|---------|---------|
| `CHAT_NAME` | Exact name of WhatsApp chat | Required | Any string |
| `HEADLESS` | Hide browser window | `false` | `true`, `false` |
| `MAX_RETRIES` | Connection retry attempts | `3` | Any integer |
| `RETRY_DELAY` | Milliseconds between retries | `30000` | Any integer |
| `LOG_LEVEL` | Logging verbosity | `info` | `debug`, `info`, `warn`, `error` |

## Usage

### First Run (QR Authentication)

On the first run, the scraper needs to authenticate with WhatsApp:

1. **Set headless mode to false:**
   ```env
   HEADLESS=false
   ```

2. **Start the scraper:**
   ```bash
   npm start
   ```

3. **Scan QR code:**
   - A browser window will open automatically
   - A QR code will also display in the terminal
   - Open WhatsApp on your phone
   - Go to Settings > Linked Devices > Link a Device
   - Scan the QR code from the browser or terminal

4. **Wait for connection:**
   ```
   ========================================
     WhatsApp News Chat Scraper
   ========================================

   [INFO] Starting scraper application
   [INFO] Target chat: "צ'אט הכתבים N12"
   [INFO] Headless mode: false
   [INFO] QR code displayed in terminal
   [INFO] Client is ready!
   [INFO] Finding chat: צ'אט הכתבים N12
   [INFO] Chat found successfully
   [INFO] Starting message scraping workflow
   ```

5. **Session saved:**
   - After successful authentication, the session is saved in `.wwebjs_auth/`
   - Subsequent runs will use this session automatically

### Subsequent Runs (Headless)

After the initial authentication, you can run in headless mode:

1. **Enable headless mode (optional):**
   ```env
   HEADLESS=true
   ```

2. **Run the scraper:**
   ```bash
   npm start
   ```

3. **Expected output:**
   ```
   ========================================
     WhatsApp News Chat Scraper
   ========================================

   [INFO] Starting scraper application
   [INFO] Target chat: "צ'אט הכתבים N12"
   [INFO] Headless mode: true
   [INFO] Client is ready!
   [SUCCESS] Scraping completed successfully
   [INFO] Messages processed: 15
   [INFO] First run: No
   [INFO] Output file: /path/to/data/output/messages_2026-02-10.csv

   ========================================
     Scraping Results
   ========================================
   ```

### Manual Session Reset

If you need to re-authenticate (e.g., session expired, switching accounts):

1. **Delete session directory:**
   ```bash
   rm -rf .wwebjs_auth/
   ```

2. **Run first-time setup again:**
   ```bash
   HEADLESS=false npm start
   ```

3. **Scan QR code** as described in the First Run section

## Automated Scheduling

The scraper can run automatically at regular intervals using macOS launchd.

### Setup Scheduler (macOS)

A launchd configuration is included for running the scraper every 10 minutes:

```bash
# Start the scheduler (runs every 10 minutes)
./scheduler.sh start

# Check scheduler status
./scheduler.sh status

# View scheduler logs
./scheduler.sh logs

# Stop the scheduler
./scheduler.sh stop

# Restart the scheduler
./scheduler.sh restart

# Run manually (bypass scheduler)
./scheduler.sh run-now
```

### Scheduler Details

- **Frequency:** Every 10 minutes (600 seconds)
- **Active Hours:** 6:00 AM - 9:00 PM (pauses overnight)
- **Location:** `~/Library/LaunchAgents/com.newsscraper.whatsapp.plist`
- **Logs:**
  - Standard output: `logs/launchd-stdout.log`
  - Standard error: `logs/launchd-stderr.log`
- **Mode:** Runs in headless mode automatically
- **Auto-start:** Starts automatically when you log in

### Customizing Active Hours

To change when the scraper runs, edit `run-with-schedule.sh`:

```bash
# Edit the active hours
nano run-with-schedule.sh

# Change these values (24-hour format):
ACTIVE_START_HOUR=6   # Start at 6:00 AM
ACTIVE_END_HOUR=21    # End at 9:00 PM

# Restart scheduler to apply changes
./scheduler.sh restart
```

**Example configurations:**
- Business hours only: `ACTIVE_START_HOUR=9` and `ACTIVE_END_HOUR=18` (9 AM - 6 PM)
- All day: `ACTIVE_START_HOUR=0` and `ACTIVE_END_HOUR=24` (24/7)
- Morning only: `ACTIVE_START_HOUR=6` and `ACTIVE_END_HOUR=12` (6 AM - 12 PM)

### Verify Scheduler is Running

```bash
# Check if scheduler is loaded
launchctl list | grep newsscraper

# View recent output
tail -f logs/launchd-stdout.log
```

### Troubleshooting Scheduler

If the scheduler isn't working:

1. **Check node path in plist:**
   ```bash
   which node  # Should match path in plist file
   ```

2. **View error logs:**
   ```bash
   ./scheduler.sh logs
   ```

3. **Manually test:**
   ```bash
   ./scheduler.sh run-now
   ```

4. **Restart scheduler:**
   ```bash
   ./scheduler.sh restart
   ```

## Output Format

Messages are exported to CSV files in the `data/output/` directory with the following structure:

### CSV Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `reporter` | String | Name of message sender | `רועי שרון` |
| `content` | String | Message text content | `עדכון חשוב מהשטח` |
| `date` | String | Message date (DD/MM/YYYY) | `10/02/2026` |
| `time` | String | Message time (HH:MM) | `14:35` |
| `links` | String | Semicolon-separated URLs | `https://example.com;https://news.com` |
| `hasMedia` | Boolean | Media attachment indicator | `true` or `false` |

### Output File Naming

Files are named with the pattern: `messages_YYYY-MM-DD.csv`

Example: `messages_2026-02-10.csv`

### CSV Example

```csv
reporter,content,date,time,links,hasMedia
"רועי שרון","עדכון חשוב מהשטח","10/02/2026","14:35","https://news.com",false
"שרה כהן","תמונות מהמקום","10/02/2026","14:36","",true
"דוד לוי","ראו קישור: https://example.com","10/02/2026","14:37","https://example.com",false
```

## Project Structure

```
news-chat-scraper/
├── index.js                    # Main entry point
├── package.json                # Project metadata and dependencies
├── .env                        # Environment configuration (not in git)
├── .env.example                # Example environment configuration
├── .gitignore                  # Git ignore patterns
├── jest.config.js              # Jest testing configuration
├── run-exporter-tests.js       # Manual exporter tests
├── README.md                   # This file
│
├── src/                        # Source code modules
│   ├── client.js               # WhatsApp client creation and connection
│   ├── scraper.js              # Message scraping orchestration
│   ├── parser.js               # Message parsing logic
│   ├── exporter.js             # CSV export functionality
│   ├── stateManager.js         # State persistence (last message tracking)
│   ├── logger.js               # Logging utility
│   └── config.js               # Configuration loader
│
├── __tests__/                  # Test suite
│   ├── setup.test.js           # Test environment setup
│   ├── parser.test.js          # Parser unit tests
│   ├── exporter.test.js        # Exporter unit tests
│   └── stateManager.test.js    # State manager unit tests
│
├── data/                       # Data directory
│   ├── output/                 # CSV export files
│   ├── test-output/            # Test output files
│   └── state.json              # Last processed message state
│
├── logs/                       # Log files
│   └── scraper_YYYY-MM-DD.log  # Daily log files
│
├── docs/                       # Documentation
│   ├── EXPORTER_TESTS.md       # Exporter testing guide
│   └── plans/                  # Development planning docs
│
└── .wwebjs_auth/               # WhatsApp session data (auto-generated)
    └── session/                # Session storage (not in git)
```

## How It Works

The scraper follows a 7-step workflow:

### 1. Initialization
- Loads configuration from `.env` file
- Creates necessary directories (`data/`, `logs/`)
- Initializes logger with timestamp and log level

### 2. Client Creation
- Creates WhatsApp Web client instance
- Configures authentication strategy (session or QR code)
- Sets up event handlers for QR code and ready state

### 3. Authentication
- **First Run:** Displays QR code and waits for user to scan
- **Subsequent Runs:** Loads existing session from `.wwebjs_auth/`
- Implements retry logic with exponential backoff

### 4. Chat Discovery
- Searches all available chats for matching `CHAT_NAME`
- Performs case-insensitive, whitespace-normalized matching
- Throws error if chat not found

### 5. Message Retrieval
- Fetches all messages from the target chat
- Loads state to determine last processed message
- Filters new messages based on timestamp

### 6. Message Processing
- Parses each message to extract:
  - Reporter name (from first line)
  - Content text
  - Timestamps (converted to DD/MM/YYYY and HH:MM)
  - URLs (extracted from message body)
  - Media indicators (images, videos, documents)

### 7. Export and State Update
- Exports parsed messages to CSV with UTF-8 encoding
- Appends to existing file if it exists (incremental updates)
- Saves last message timestamp to `state.json`
- Cleans up and closes WhatsApp client

## Message Format

The scraper expects messages in the following format:

### Standard Format

```
Reporter Name
Message content goes here.
Additional lines of content.
Links: https://example.com
```

### Parsing Rules

1. **Reporter Name** - First line of message (before first newline)
2. **Content** - All subsequent lines, concatenated with spaces
3. **Links** - Automatically extracted from content using URL regex
4. **Timestamps** - Converted from Unix timestamp to DD/MM/YYYY and HH:MM

### Example Message

**WhatsApp Message:**
```
רועי שרון
דיווח חשוב מהשטח.
ראו פרטים נוספים: https://news.example.com
```

**Parsed Output:**
```csv
reporter,content,date,time,links,hasMedia
"רועי שרון","דיווח חשוב מהשטח. ראו פרטים נוספים: https://news.example.com","10/02/2026","14:35","https://news.example.com",false
```

## Testing

The project includes comprehensive unit tests for all core modules.

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Manual Exporter Tests

```bash
npm run test:exporter
```

### Test Coverage

The test suite includes:
- **Parser Tests** - Message parsing, date/time formatting, link extraction
- **Exporter Tests** - CSV writing, UTF-8 encoding, file creation
- **State Manager Tests** - State persistence, retrieval, file operations
- **Integration Tests** - End-to-end workflow validation

Expected output:
```
PASS  __tests__/parser.test.js
PASS  __tests__/exporter.test.js
PASS  __tests__/stateManager.test.js
PASS  __tests__/setup.test.js

Test Suites: 4 passed, 4 total
Tests:       45 passed, 45 total
```

## Troubleshooting

### QR Code Not Displayed

**Problem:** QR code doesn't appear in terminal or browser

**Solutions:**
1. Check that `HEADLESS=false` in `.env`
2. Ensure terminal supports QR code rendering (use browser instead)
3. Check logs for connection errors:
   ```bash
   tail -f logs/scraper_$(date +%Y-%m-%d).log
   ```
4. Verify Node.js version:
   ```bash
   node --version  # Should be >= 18.0.0
   ```

### Chat Not Found

**Problem:** Error message "Chat not found"

**Solutions:**
1. **Verify exact chat name:**
   - Open WhatsApp Web manually
   - Copy the exact chat name (including special characters)
   - Update `CHAT_NAME` in `.env` with exact match

2. **Check for name variations:**
   ```env
   # Try different formats
   CHAT_NAME="צ'אט הכתבים N12"
   CHAT_NAME="Chat Name"
   ```

3. **Enable debug logging:**
   ```env
   LOG_LEVEL="debug"
   ```

4. **List all available chats:**
   - Temporarily modify `src/client.js` to log all chat names
   - Or check WhatsApp Web directly

### Session Expired

**Problem:** "Session expired" or "Authentication failed" errors

**Solutions:**
1. **Delete and re-authenticate:**
   ```bash
   rm -rf .wwebjs_auth/
   HEADLESS=false npm start
   ```

2. **Check WhatsApp Linked Devices:**
   - Open WhatsApp on phone
   - Go to Settings > Linked Devices
   - Remove old/inactive sessions
   - Re-scan QR code

3. **Verify session directory permissions:**
   ```bash
   ls -la .wwebjs_auth/
   chmod -R 755 .wwebjs_auth/
   ```

### Hebrew Text Garbled in CSV

**Problem:** Hebrew characters appear as gibberish or question marks

**Solutions:**
1. **Open CSV with UTF-8 encoding:**
   - Excel: Import Data > From Text/CSV > File Origin: UTF-8
   - Google Sheets: File > Import > Upload > automatically detects UTF-8
   - LibreOffice: Open with Character Set: Unicode (UTF-8)

2. **Verify file encoding:**
   ```bash
   file -I data/output/messages_*.csv
   # Should show: charset=utf-8
   ```

3. **Use proper CSV viewer:**
   - Avoid opening directly in Excel (may default to wrong encoding)
   - Use Google Sheets for best Hebrew support

### No New Messages

**Problem:** Scraper reports "0 new messages" but new messages exist

**Solutions:**
1. **Check state file:**
   ```bash
   cat data/state.json
   # Shows last processed message timestamp
   ```

2. **Reset state to re-process all messages:**
   ```bash
   rm data/state.json
   npm start
   ```

3. **Verify message timestamps:**
   - Ensure your system clock is accurate
   - Check that WhatsApp messages have valid timestamps

### Connection Timeout

**Problem:** "Connection timeout" or "Max retries exceeded"

**Solutions:**
1. **Increase retry settings:**
   ```env
   MAX_RETRIES=5
   RETRY_DELAY=60000  # 60 seconds
   ```

2. **Check internet connection:**
   ```bash
   ping whatsapp.com
   ```

3. **Disable firewall/VPN temporarily:**
   - WhatsApp Web may be blocked by network policies

4. **Try headful mode:**
   ```env
   HEADLESS=false  # Browser window can help diagnose issues
   ```

### High Memory Usage

**Problem:** Node.js process consumes excessive memory

**Solutions:**
1. **Process messages in smaller batches** - The scraper already filters new messages
2. **Clear WhatsApp cache periodically:**
   ```bash
   rm -rf .wwebjs_auth/session/Default/Cache/
   ```
3. **Increase Node.js memory limit:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```

### Logs Not Created

**Problem:** No log files in `logs/` directory

**Solutions:**
1. **Check directory permissions:**
   ```bash
   mkdir -p logs
   chmod 755 logs
   ```

2. **Verify logger configuration:**
   ```env
   LOG_LEVEL="info"  # Must be set
   ```

3. **Check disk space:**
   ```bash
   df -h .
   ```

## Logging

### Log File Location

Logs are stored in: `logs/scraper_YYYY-MM-DD.log`

Example: `logs/scraper_2026-02-10.log`

### Log Levels

- **DEBUG** - Detailed debugging information
- **INFO** - General informational messages
- **WARN** - Warning messages (non-critical issues)
- **ERROR** - Error messages (critical failures)
- **SUCCESS** - Success notifications

### Log Format

```
[LEVEL] Message content
```

### Example Log Output

```
[INFO] Starting scraper application
[INFO] Target chat: "צ'אט הכתבים N12"
[INFO] Headless mode: false
[INFO] QR code displayed in terminal
[INFO] Client is ready!
[INFO] Finding chat: צ'אט הכתבים N12
[INFO] Chat found successfully
[INFO] Starting message scraping workflow
[INFO] Retrieved 150 messages from chat
[INFO] Last processed message timestamp: 1738342800
[INFO] Found 15 new messages to process
[INFO] Exporting 15 messages to CSV
[SUCCESS] Successfully exported 15 messages
[INFO] Updated state with last message timestamp: 1738356000
[SUCCESS] Scraping completed successfully
[INFO] Messages processed: 15
[INFO] First run: No
[INFO] Output file: /path/to/data/output/messages_2026-02-10.csv
[INFO] Cleaning up: Destroying WhatsApp client
[SUCCESS] Client destroyed successfully
[INFO] Done
```

### Viewing Logs

**View latest log:**
```bash
tail -f logs/scraper_$(date +%Y-%m-%d).log
```

**Search for errors:**
```bash
grep ERROR logs/scraper_*.log
```

**View all logs:**
```bash
cat logs/scraper_*.log | less
```

## Future Enhancements

Planned features for future releases:

- [ ] **Multi-Chat Support** - Scrape multiple chats in parallel
- [ ] **Database Integration** - Store messages in SQLite/PostgreSQL
- [ ] **Web Dashboard** - Real-time monitoring and analytics
- [ ] **Message Filtering** - Filter by reporter, date range, keywords
- [ ] **Scheduled Runs** - Cron job integration for automatic scraping
- [ ] **Webhook Notifications** - Send alerts when new messages are detected
- [ ] **Media Download** - Automatically download and archive media files
- [ ] **Advanced Parsing** - Custom parsing rules per reporter/chat
- [ ] **Export Formats** - Support JSON, Excel, and database export
- [ ] **Cloud Deployment** - Docker container and cloud hosting guides
- [ ] **API Server** - REST API for programmatic access
- [ ] **Statistics Dashboard** - Message analytics and trends

## License

This project is licensed under the ISC License.

```
ISC License

Copyright (c) 2026 News Chat Scraper Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch:** `git checkout -b feature/amazing-feature`
3. **Make your changes** with descriptive commit messages
4. **Add tests** for new functionality
5. **Run tests:** `npm test`
6. **Submit a pull request** with detailed description

### Code Style

- Use ES6+ JavaScript features
- Follow existing code formatting
- Add JSDoc comments for functions
- Keep functions small and focused
- Write unit tests for new code

### Reporting Issues

Found a bug or have a feature request? Please open an issue on GitHub:

1. **Search existing issues** to avoid duplicates
2. **Use descriptive titles** and clear descriptions
3. **Include steps to reproduce** for bugs
4. **Attach logs** when reporting errors
5. **Specify environment:** Node.js version, OS, etc.

## Support

For questions, issues, or feature requests:

- **GitHub Issues:** [https://github.com/username/news-chat-scraper/issues](https://github.com/username/news-chat-scraper/issues)
- **Documentation:** Check this README and files in `docs/`
- **Logs:** Always check log files first for error details

## Acknowledgments

This project uses the following open-source libraries:

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API client
- [csv-writer](https://github.com/ryu1kn/csv-writer) - CSV file writing
- [dotenv](https://github.com/motdotla/dotenv) - Environment configuration
- [qrcode-terminal](https://github.com/gtanner/qrcode-terminal) - QR code terminal display
- [jest](https://jestjs.io/) - JavaScript testing framework

---

**Built with Node.js for efficient WhatsApp data extraction and analysis.**

---

# Video Digest & Knowledge Archive

Send a link — a YouTube or Instagram video, or any web page — and get back a structured
summary, every link and GitHub repo it mentioned, a topic-indexed row in Google Sheets, and
the ability to ask questions across everything you have ever sent it.

```
link ──▶ yt-dlp ──▶ captions (or ASR) ──▶ entity extraction ──▶ Claude ──┬─▶ data/archive/*.md
                                                                        └─▶ Google Sheets
                                                                                  │
                                                              npm run ask ◀───────┘
```

## What it does

- **Videos and pages** — YouTube (videos, Shorts, live replays), Instagram (Reels, posts,
  IGTV), and any other web page: an article, a product listing, documentation. The source
  type is detected from the URL; everything downstream is shared.
- **Product pages read their structured data** — price, currency, brand, SKU, availability,
  rating and review count come from the page's own JSON-LD, not from guessing at the copy.
- **A link is never lost** — if the page cannot be fetched, or the model cannot be reached,
  the link is still archived with whatever is known and marked pending. `npm run ask --
  --pending` lists what to complete, and `--force` completes it.
- **Transcripts, cheaply first** — existing captions are used when available; audio is only
  downloaded and transcribed when there are none. Rolling auto-captions are de-duplicated,
  so you get readable text instead of every line repeated three times.
- **Exact extraction** — links, GitHub repos, @handles, #hashtags, and chapter timestamps are
  pulled out by literal matching *before* the model runs, so they are never hallucinated.
- **Live GitHub metadata** — repos mentioned in a video are looked up on the GitHub API and
  archived with their description, stars, language, license, and last push date.
- **Structured summary** — TL;DR, key points, reusable topic labels, action items, tools
  mentioned, people named. Written in Hebrew by default (`VIDEO_SUMMARY_LANGUAGE`).
- **Two stores** — Google Sheets holds the table you browse (`Videos` + `Topics` tabs);
  `data/archive/` holds the full Markdown and the transcript, which is too long for a cell.
- **Ask questions** — `npm run ask` retrieves the relevant videos from the archive and answers
  with citations back to the source videos.
- **Idempotent** — re-sending the same link updates its row instead of duplicating it.

## Setup

### 1. Install the toolchain

`yt-dlp` is required. `ffmpeg` is only needed if you want the ASR fallback for videos
with no captions.

```bash
# macOS
brew install yt-dlp ffmpeg

# Linux
pipx install yt-dlp && sudo apt install ffmpeg

# Optional: local transcription for videos with no captions
pipx install openai-whisper        # or: pipx install faster-whisper
```

### 2. Configure

```bash
cp .env.example .env
```

Then set, at minimum:

| Variable | Why |
| --- | --- |
| `ANTHROPIC_API_KEY` | Summaries and Q&A |
| `VIDEO_SHEET_ID` | The spreadsheet to write to (falls back to `GOOGLE_SHEET_ID`) |
| `GOOGLE_CREDENTIALS_PATH` | Service-account JSON — see `GOOGLE_SHEETS_SETUP.md` |

Leave the sheet variables empty to archive locally only; everything else still works.

Share the spreadsheet with your service account's email address as an **Editor**, or the
first write will fail with a permission error. The `Videos` and `Topics` tabs are created
automatically on the first run.

### 3. Verify

```bash
npm run check
```

Prints what is installed, what is configured, and what is missing.

## Usage

```bash
# Digest one video, or any web page
npm run digest -- "https://youtu.be/dQw4w9WgXcQ"
npm run digest -- "https://shop.example.com/products/some-gadget"

# Several at once — one failure never stops the rest
npm run digest -- "https://youtu.be/aaa" "https://www.instagram.com/reel/Cxyz/"

# Re-process something already archived
npm run digest -- "https://youtu.be/aaa" --force

# Skip audio transcription (captions only — fast and free)
npm run digest -- "https://youtu.be/aaa" --no-asr

# Archive locally without touching Google Sheets
npm run digest -- "https://youtu.be/aaa" --no-sheet
```

### Asking questions

```bash
# Ask across everything archived
npm run ask -- "מה למדתי על סוכני AI?"
npm run ask -- "which repos were recommended for building agents?"

# Search the transcripts too — slower and pricier, but catches detail
# the summaries left out
npm run ask -- "what was the exact install command?" --transcripts

# See what the archive holds, grouped by topic
npm run topics

# List links saved but not yet summarized, with the command to complete each
npm run ask -- --pending

# Answer from Google Sheets instead of the local archive
# (for a machine that has the sheet but not the archive files)
npm run ask -- "מה יש לי על אבטחה?" --from-sheet
```

### Sending links from WhatsApp

Instead of the CLI, you can post links into a WhatsApp chat and have them digested
automatically, with the summary sent back as a reply:

```bash
# Set VIDEO_WATCH_CHAT_ID in .env to the chat you want to listen on,
# then leave this running
npm run watch:whatsapp
```

A chat with yourself works well as a personal inbox. The watcher only reacts to that one
chat, only to supported video links, and only ever replies — it never forwards or messages
anyone else. It reuses the same WhatsApp session as the scraper, so authenticate once.

> Note: this uses `whatsapp-web.js`, an unofficial automation of WhatsApp Web — the same
> dependency the scraper already relies on. The CLI path has no such dependency.

## What you get

### In Google Sheets

**`Videos` tab** — one row per source: id, date added, source type (`video` / `web`),
platform, URL, title, channel or site, published date, duration, content type, topics,
TL;DR, key points, action items, tools mentioned, people, product facts, GitHub repos,
links, transcript source, confidence, archive path.

**`Topics` tab** — one row per (topic, video) pair, so you can filter or pivot the whole
archive by subject.

### On disk

```
data/archive/
├── index.json                 # Lightweight index, drives Q&A retrieval
├── youtube_dQw4w9WgXcQ.json   # Full record, including the transcript
└── youtube_dQw4w9WgXcQ.md     # Human-readable digest
```

## Security

This tool runs a subprocess against a link you were sent and then feeds the resulting text
to a model, so both boundaries are handled explicitly. See
`docs/plans/2026-09-04-video-digest-design.md` for the full threat model.

- **URL rules, per source type** — video links are restricted to a YouTube/Instagram host
  allowlist. Web links accept any host, so they get the check that allowlist used to make
  unnecessary: https/http only, no credentials, ports 80/443 only, and a refusal for
  anything private, loopback, link-local, carrier-grade-NAT, `.internal`/`.local`/`.corp`,
  or single-label — **by literal IP and by what the hostname actually resolves to**,
  including IPv4-mapped IPv6 forms like `::ffff:127.0.0.1`. Cloud metadata endpoints
  (`169.254.169.254`, `metadata.google.internal`) are blocked explicitly.
- **Redirects are re-validated on every hop** — a redirect is the standard way to turn an
  allowed URL into an internal one, so each hop is re-checked and the request is never
  issued to a hop that fails. Residual risk is DNS rebinding, which is documented in
  `src/video/linkUrl.js`.
- **Page responses are bounded** — content-type checked, size-capped as the bytes arrive
  (not merely trusting `Content-Length`), and redirect chains cut off at five hops.
- **No shell** — every external tool is invoked with an argument array and `shell: false`,
  and URLs that could be read as a CLI flag are rejected. No user input is ever
  concatenated into a command line.
- **Prompt injection** — transcripts are attacker-authorable text. They are fenced in
  delimiters that the content cannot close, the system prompt states the region is data,
  the output shape is pinned by a JSON schema, and the summarizer declares no tools, so
  nothing it reads can cause an action. A video that tries it gets flagged in the record.
- **Spreadsheet formula injection** — cells are written with `valueInputOption: RAW` and
  values beginning with `= + - @` are prefixed, so a CSV export stays safe too.
- **Path containment** — video ids are validated against a filename-safe charset and every
  archive write is checked to resolve inside the archive root.
- **Secrets** — read from the environment only, never written to the archive or the sheet,
  and redacted from log output. External tools get a minimal environment (`PATH`, `HOME`,
  locale, proxy, CA variables) rather than inheriting yours, so `yt-dlp` never sees your
  API keys. `.env` is gitignored; keep it that way.
- **Resource limits** — every subprocess has a timeout and an output cap, audio downloads
  have a size and duration limit, temp files are removed in a `finally`, and transcript
  truncation is recorded in the record rather than happening silently.
- **GitHub** — metadata only, from `api.github.com` alone. Repos are never cloned or
  executed, and a redirect off the API host is refused.

## Costs

Roughly, per video: captions cost nothing, and one summary of a 20-minute video runs a few
cents on `claude-opus-5`. To spend less:

- `VIDEO_SUMMARY_EFFORT="low"` — noticeably cheaper, still solid for straightforward videos.
- `--no-asr` — never download audio; captions or nothing.
- `VIDEO_SUMMARY_MODEL="claude-sonnet-5"` — cheaper per token than Opus.

The system prompt is cached across every call, so repeated runs pay for it once per cache
window rather than every time.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `"yt-dlp" is not installed` | Install it, or set `YTDLP_PATH` to its full path |
| Instagram: "login required" | Set `YTDLP_COOKIES_FROM_BROWSER="chrome"` in `.env` |
| `transcriptSource: none` | The video has no captions and ASR is off or unavailable. Install `whisper` + `ffmpeg`, or accept a metadata-only summary |
| Sheets: permission denied | Share the spreadsheet with the service-account email as Editor |
| `Refusing to fetch an internal host` / `non-public address` | The link points at a private, loopback, or internal destination. This is deliberate and not configurable |
| A record says "saved, not yet summarized" | The page or the model was unreachable at capture time. `npm run ask -- --pending` lists them; re-run with `--force` |
| Video is longer than the limit | Raise `MAX_ASR_DURATION_SEC`, or use `--no-asr` |
| yt-dlp fails on a video that plays fine in a browser | Update it: `pipx upgrade yt-dlp`. Extractors break whenever the sites change |
| `blocked by a proxy or egress policy` in `npm run check` | A corporate proxy, VPN, or sandbox is refusing the host. The pipeline cannot work until that host is reachable |

## Tests

```bash
npm test                      # Everything
npx jest __tests__/video      # Video digest only
```

The suite covers the adversarial cases directly — flag-shaped URLs, `file://`, SSRF
targets, lookalike hostnames, path traversal in ids, formula injection into cells,
fence-escape attempts in transcripts, and redirects that try to leave the GitHub API host.
