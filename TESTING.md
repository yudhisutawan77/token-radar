# TESTING — Token Radar (token-radar-01)

Environment: Node v24.22.1 (target is Node 22.18+; the entry uses only
Node's standard library and erasable TypeScript, the same shape as the kit
starter), Python 3.12.3, Chromium headless shell 159.0.8154.6 via Playwright.
Snapshot: `token-radar-01-kit/input/snapshot.json`, as_of 2026-11-14, 758
protocols, watchlist 40. All commands run from this directory.

## 1. Model check — `node dev/check-model.ts`

- Board: **178 rows** — 40 watchlist + 138 early rows below the $50M floor
  that pass the launch screen; 164 pre-token protocols screened out.
- Screen reasons: above-floor left out by watchlist 92, Liquid Staking 20,
  CEX 15, Bridge 13, versioned name 9, Canonical Bridge 7, wrapped/staked
  name 5, Liquid Restaking 3.
- Implied values strictly decreasing across ranks 1–178. Every row carries
  7 farm steps, each 108–183 characters.
- Top 5: Steakhouse Financial $1,188,413,256; Gauntlet $713,257,788; Veda
  $341,850,641; USDD $221,557,003; Nonce Capital $177,536,136.
- Bottom 3: Goonfi $1,038,695; Flying Tulip ftUSD $930,248; Nucleus $834,399.
- Global median market-cap / TVL of live-token protocols (ratios 0.02–20):
  0.310. Category multiples are medians shrunk toward it with 8
  pseudo-observations and clamped to 0.08x–1.20x.

## 2. Gate check — `node dev/check-gate.mjs out`

A local replica of the gate's seven rows, run against the output of
`main.ts`. Result at the last run (2026-11-17):

```
PASS dashboard_files — 3 files, 28,699 bytes
PASS board_file — 178 rows
PASS sorted_by_value — ranks 1..178: true, non-increasing: true
PASS coverage — watchlist 40, missing 0
PASS farm_steps — all rows 3-12 steps, 20-600 chars
PASS screenshots — 3 images; 1-board.png 145,717B 1440x900;
  2-detail.png 229,835B 1440x900; 3-filtered.png 148,668B 1440x900
PASS dossier_matches — 728,951 bytes, rebuild 728,951 bytes
GATE: all 7 rows pass
```

## 3. Determinism

`main.ts` run twice into `out/` and `out2/` produced byte-identical trees
(`diff -r` clean): board.json, data.js, dashboard/, screenshots/ and
dossier.json. No clock, no network, no randomness anywhere in the model.

## 4. Page / board agreement

A Node check loads `out/data.js`, compares every row with `out/board.json`,
and recomputes each row's implied value from the row's own multipliers
(TVL × category multiple × growth × maturity × 0.85):

- data.js vs board.json mismatches: **0** (178 rows, farm plans included).
- No `https://` string in `dashboard/`, `lib/`, `main.ts`, `data.js` or
  `board.json` (the gate refuses http/https in dashboard attributes, CSS
  and JS imports).
- The detail view prints the recomputed number and states it matches
  board.json; an early run caught a rounding mismatch here (multipliers
  were rounded to 4 decimals in the row, the board used full precision)
  and it was fixed by carrying full precision in the row.

## 5. Screenshots — `node dev/shoot.mjs out` (headless Chromium, 1440×900)

| file | size | shows |
| --- | --- | --- |
| `screenshots/1-board.png` | 142 KB | default board: hero, 4 stat cards, filters, top rows |
| `screenshots/2-detail.png` | 224 KB | detail dialog on rank 1 (Steakhouse Financial): implied-value breakdown with the recompute check, all 7 farm steps |
| `screenshots/3-filtered.png` | 145 KB | category filter "Risk Curators": 33 rows shown |

All three were read back visually: the board is legible at a glance, the
detail dialog shows the full equation and every farm step, the filtered
view shows the filter state and the reduced row count. Each is a real
render of the submitted dashboard, not a mock.

## 6. Dossier

`dossier.json` is byte-for-byte what `buildDossier` writes from the
output directory (verified by rebuilding in the gate check). Dossier text
is 28,963 bytes of the 65,536-byte cap, so the judge reads the whole
dashboard source — nothing is cut. Total dossier 729,017 bytes, under the
1.5 MiB cap. Screenshots are each under the 512 KiB cap.

## Known limitations

- Tested on Node v24.22.1, not on Node 22.18 itself. The code uses only
  the standard library and erasable TypeScript, matching the kit starter's
  shape, so it is expected to run the same under 22.18.
- The live-token view is a reference table (24 rows by market cap); its
  rows are not part of the 178-row board, by design — the board ranks
  pre-token protocols only.
- "Records no token" follows the snapshot; it is not proof a protocol has
  no token, and the dashboard says so wherever the claim appears.
