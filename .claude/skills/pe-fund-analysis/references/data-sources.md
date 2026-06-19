# Data Sources & Search Patterns for PE Fund Analysis

Free, public sources ranked by reliability, plus the exact queries to run.

## Tier 1 — Primary disclosures (most authoritative)

| Source | What you get | How to access |
|---|---|---|
| Firm website / IR page | AUM, strategy, fund family list, team, philosophy | `WebSearch "<firm> assets under management strategy"`, then `WebFetch` the site |
| SEC EDGAR — Form ADV | Regulatory AUM, # of funds, ownership, conflicts | full-text search at efts.sec.gov; `WebSearch "<firm> Form ADV SEC"` |
| SEC filings (10-K, 10-Q, N-CEN) | For **listed** managers: fee-related earnings, AUM by segment, fund performance disclosures | EDGAR. Listed: Blackstone (BX), KKR, Apollo (APO), Carlyle (CG), Ares (ARES), Brookfield (BAM/BN), TPG, Blue Owl (OWL), EQT, Bridgepoint |
| Investor day / earnings decks | AUM growth, fundraising, deployment, dry powder, realizations | `WebSearch "<firm> investor day presentation <year>"` |

## Tier 2 — LP public disclosures (best free source of hard fund-level returns)

US public pension funds are legally required to disclose **net IRR, investment
multiple (TVPI), and DPI** for each PE fund they invest in. This is gold.

Search patterns:
- `WebSearch "<fund name> net IRR CalPERS"`
- `WebSearch "<fund name> investment multiple CalSTRS private equity performance"`
- `WebSearch "<firm> fund performance public pension disclosure"`

Key disclosing LPs and their PE performance pages:
- **CalPERS** — "Private Equity Program Fund Performance Review"
- **CalSTRS** — Private Equity Portfolio Performance
- **Oregon PERS** — one of the most detailed historical disclosures
- **Washington State Investment Board (WSIB)**
- **New York State Common / NYC Retirement Systems**
- **Texas TRS / Texas ERS / TRS of Texas**
- **Florida SBA, Minnesota SBI, New Jersey, Pennsylvania PSERS**
- **University endowments** that publish (less common)

Note: LP-reported IRRs are net to that LP, as of a specific quarter — record the
as-of date. Different LPs may report slightly different numbers for the same fund
due to timing of cash flows and fees.

## Tier 3 — Data providers, databases & press

| Source | Use for |
|---|---|
| PitchBook | Fund sizes, IRR/multiple benchmarks, deals, valuations (often paywalled — use summary snippets) |
| Preqin | Quartile benchmarks by vintage/strategy, fundraising, dry powder |
| Cambridge Associates / Burgiss(MSCI) | Benchmark index ranges by vintage |
| Crunchbase | VC/growth portfolio companies, rounds, exits |
| Bloomberg / Reuters / WSJ / FT | Deals, fundraising closes, exits, leadership |
| PEI (Private Equity International), Buyouts, Institutional Investor | Fundraising league tables, strategy news |
| Company press releases | Closes, acquisitions, exits, IPOs |

Search patterns:
- `WebSearch "<firm> fund <N> size close billion"`
- `WebSearch "<firm> portfolio companies exits IPO acquisition"`
- `WebSearch "<firm> fundraising <year>"`
- `WebSearch "<strategy> <vintage> private equity benchmark top quartile IRR"`

## Benchmarks to pull

- **Vintage-year quartiles** for the same strategy/region (top-quartile, median,
  bottom-quartile net IRR and TVPI). Sources: Preqin, PitchBook, Cambridge.
- **PME vs. public index** (S&P 500 / MSCI World / Russell 2000 depending on
  strategy) — Kaplan-Schoar or Direct Alpha PME if cash flows are available.
- **Peer firms** — same strategy and size bracket, prior-fund track records.

## Data-quality checklist

- [ ] Every figure has a value + as-of date + source.
- [ ] Net vs. gross IRR is labeled.
- [ ] Fund vintage and strategy are explicit (benchmarks depend on them).
- [ ] Reporting lag noted (PE marks are typically 1–2 quarters behind).
- [ ] Conflicting numbers across sources are flagged, not silently averaged.
