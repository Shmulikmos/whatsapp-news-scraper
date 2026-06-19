---
name: pe-fund-analysis
description: >-
  Analyze a private equity, venture capital, or alternative-asset fund/firm by
  name and produce a structured performance, trends, and data report. Use when
  the user gives the name of a financial fund (e.g. "Blackstone", "KKR fund VI",
  "Insight Partners", "Apollo", "Sequoia", or any PE/VC/credit/infra fund) and
  asks to analyze performance, returns, trends, AUM, portfolio, exits,
  fundraising, or "any data that can help". Gathers data from public sources via
  web search, computes/benchmarks the standard PE metrics (IRR, TVPI/MOIC, DPI,
  RVPI), and outputs a sourced report. Replies in the user's language (Hebrew if
  the user writes in Hebrew).
---

# Private Equity Fund Analysis

Turn a fund or firm name into a structured, sourced analysis of performance,
trends, and any data that helps an investor or analyst form a view.

## When the user invokes this skill

The input is a fund or firm name (and optionally a specific fund vintage, e.g.
"KKR North America Fund XIII" or "Sequoia Capital Fund". The deliverable is a
written report following `references/report-template.md`.

Respond in the **user's language**. If the user wrote in Hebrew, write the whole
report in Hebrew (keep metric acronyms like IRR, TVPI, DPI, MOIC in Latin
letters — they are industry standard).

## Workflow

Follow these steps in order. Do not skip the disambiguation step.

### 1. Identify and disambiguate the fund

A fund name can be ambiguous. Before researching, pin down:

- **Firm vs. fund**: Is the user asking about the whole manager (e.g.
  "Blackstone") or a specific commingled fund vintage (e.g. "Blackstone Capital
  Partners VIII")? Firm-level = AUM/strategy/track record across funds.
  Fund-level = the precise IRR/TVPI/DPI for that vintage.
- **Asset class**: buyout/PE, venture, growth, private credit, real estate,
  infrastructure, secondaries, fund-of-funds. The relevant benchmarks differ.
- **Region & vintage year**: returns are only meaningful when benchmarked
  against the same vintage and geography.

If the name is genuinely ambiguous (multiple real firms share it, or you can't
tell firm vs. fund), ask **one** short clarifying question via `AskUserQuestion`
with the candidate options. Otherwise state your assumption in one line and
proceed — don't block on minor ambiguity.

### 2. Gather data (web research)

Use `WebSearch` to find sources, then `WebFetch` to read the strongest ones.
Run several searches in parallel. See `references/data-sources.md` for the full
source map and the exact query patterns to use.

Prioritize, in order:
1. **Primary disclosures** — the firm's own site (AUM, strategy, fund list),
   SEC filings (Form ADV, 10-K/N-CEN for listed managers like BX, KKR, APO,
   CG, ARES, BAM), investor-relations decks, and press releases.
2. **LP public disclosures** — US public pension funds (CalPERS, CalSTRS,
   Oregon PERS, Washington SIB, NY State/City, Texas TRS, etc.) publish
   **net IRR, TVPI/multiple, and DPI per fund**. This is the single best free
   source of hard fund-level performance numbers. Always check these.
3. **Data providers & press** — PitchBook, Preqin, Crunchbase summaries,
   Bloomberg, Reuters, WSJ, FT, Institutional Investor, Buyouts/PEI for AUM,
   fundraising, deals, and exits.

Capture for each number: the **value, as-of date, and source**. PE data is
lagged (usually reported a quarter or two behind) — record the reporting date.

### 3. Compute and benchmark

Work with the standard private-markets metrics. If you only have some inputs,
derive what you can and clearly mark the rest as unavailable.

- **TVPI / MOIC** = (cumulative distributions + residual NAV) / paid-in capital.
  Total value the fund has created per $1 invested.
- **DPI** (realized) = cumulative distributions / paid-in capital. Cash actually
  returned. DPI ≥ 1.0 means LPs got their money back.
- **RVPI** (unrealized) = residual NAV / paid-in capital. TVPI = DPI + RVPI.
- **IRR** — time-weighted-of-cash-flows return. Note **net** (to LPs, after
  fees/carry) vs **gross**; LP disclosures are net. Net is what matters to an
  investor.
- **PME** (public-market equivalent) — compares the fund to investing the same
  cash flows in a public index (e.g. S&P 500). PME > 1.0 means the fund beat
  public markets. Use it whenever you can.

Benchmark against: (a) the same **vintage-year** and strategy quartiles
(top-quartile / median / bottom-quartile from Preqin/PitchBook/Cambridge
ranges), and (b) the firm's **own prior funds** to see the trend.

### 4. Identify trends

Go beyond a single snapshot:
- **Performance trajectory** across consecutive fund vintages (improving,
  declining, mean-reverting?).
- **Fundraising momentum** — fund sizes over time, time-to-close, re-up rates.
- **Deployment & dry powder** — pace of capital deployment, uncalled commitments.
- **Realization cycle** — DPI maturing as funds age; exit environment (IPO/M&A).
- **Strategy drift** — sector/geography/check-size shifts, new product lines.
- **Macro overlay** — rates, leverage costs, exit windows affecting the strategy.

### 5. Write the report

Use `references/report-template.md`. Requirements:
- Lead with a 3–5 line **executive summary / bottom line** an investor can act on.
- Put hard numbers in **tables** with an as-of date column.
- Every non-obvious figure gets an inline **source**.
- Include a **data-confidence note**: PE performance is largely private, so be
  explicit about what is verified, what is estimated, and what is unavailable.
- End with **risks/watch-items** and, if the user's intent is investment-related,
  a balanced **assessment** (strengths vs. concerns) — never a guarantee.

## Guardrails

- **No fabrication.** If a number isn't found, say "not publicly disclosed."
  Never invent IRRs, multiples, or AUM. A sourced "unknown" is more useful than
  a confident guess.
- **Distinguish fact from inference.** Label estimates and your own reasoning.
- **Not investment advice.** Provide analysis and data; flag that it's
  informational and that the user should do their own due diligence. Returns are
  historical and not indicative of future performance.
- **Mind the data lag and survivorship/selection bias** in reported PE returns.
