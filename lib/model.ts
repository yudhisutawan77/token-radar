// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by an implied value that is anchored in the
// snapshot's own live market, not in a hand-picked multiple:
//
//   1. Comparables. For every category, take the live-token protocols in the
//      snapshot (they already trade, so their market cap is a fact) and compute
//      the median market-cap / TVL ratio, keeping only ratios between 0.02 and
//      20 so one outlier cannot set the price. A category with few live
//      protocols is shrunk toward the global median with 8 pseudo-observations,
//      so a category with one live protocol does not inherit its multiple
//      wholesale. The result is clamped to [0.08, 1.20].
//   2. Growth. The protocol's 7-day TVL change, clamped to [-50%, +100%],
//      moves the value by 0.6x the change: a protocol growing 10% in a week is
//      worth 6% more than a flat one at the same TVL.
//   3. Maturity. Age since first listing, 0.70 + 0.30 * min(age, 1095) / 1095.
//      A protocol that has run for years with no token has survived longer
//      without one, so its launch, if it comes, is priced on a longer record.
//      An unknown listing date uses 365 days.
//   4. Pre-token discount. 0.85: a token that does not exist yet cannot be
//      sold today, so its implied value is worth less than the same TVL with a
//      live token.
//
//   implied = round(TVL x categoryMultiple x growthMult x maturityMult x 0.85)
//
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard shows every input, so a reader can recompute any row.
//
// Coverage. The watchlist (40 protocols) is the floor and is always covered.
// The early radar adds every other pre-token protocol below the floor that
// passes the same screen the watchlist uses: not a CEX, bridge, liquid
// staking / restaking or restaked-BTC product, not a versioned pool, not a
// wrapped / staked product, not an exchange's own product. Protocols the
// watchlist leaves out above the floor are not ranked: the house's rule had a
// reason for them (a parent protocol in DefiLlama's record, which this
// snapshot does not carry), so the radar does not second-guess it. Live-token
// protocols are kept apart in a Live view with their market caps, never mixed
// into the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  pre_token_discount: number;
  shrink_pseudo: number;
  multiple_floor: number;
  multiple_cap: number;
  ratio_low: number;
  ratio_high: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  pre_token_discount: 0.85,
  shrink_pseudo: 8,
  multiple_floor: 0.08,
  multiple_cap: 1.2,
  ratio_low: 0.02,
  ratio_high: 20,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comparables_n: number;
    category_median: number | null;
    global_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page never re-derives it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  comparables_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl: number | null;
  change_7d: number | null;
}

/** One category's comparable: the live market's own multiple for it. */
export interface Comparable {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the comparables and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  screened_out: number;
  screen_reasons: { reason: string; count: number }[];
  comparables: Comparable[];
  global_median: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when it holds nothing. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables: for every category, the median market-cap / TVL of its
 * live-token protocols, shrunk toward the global median. Categories with no
 * live protocol use the global median itself.
 */
export function comparables(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, Comparable>; globalMedian: number } {
  const liveRatios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < model.ratio_low || r > model.ratio_high) continue;
    liveRatios.push(r);
    const key = p.category ?? 'Other';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }
  liveRatios.sort((a, b) => a - b);
  const globalMedian = medianOf(liveRatios) ?? 0.2;
  const out = new Map<string, Comparable>();
  for (const [cat, ratios] of byCat) {
    ratios.sort((a, b) => a - b);
    const med = medianOf(ratios);
    const n = ratios.length;
    const multiple = Math.min(
      model.multiple_cap,
      Math.max(model.multiple_floor, ((med ?? globalMedian) * n + globalMedian * model.shrink_pseudo) / (n + model.shrink_pseudo)),
    );
    out.set(cat, { category: cat, n, median: med, multiple });
  }
  return { byCategory: out, globalMedian };
}

/** The category multiple for one protocol, from the comparables table. */
function multipleFor(p: SnapshotProtocol, comps: Map<string, Comparable>, globalMedian: number, model: ModelConstants): { multiple: number; n: number; median: number | null } {
  const c = comps.get(p.category ?? 'Other');
  if (c === undefined) return { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian)), n: 0, median: null };
  return { multiple: c.multiple, n: c.n, median: c.median };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: Map<string, Comparable>,
  globalMedian: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; compN: number; compMedian: number | null; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, n, median } = multipleFor(protocol, comps, globalMedian, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * model.pre_token_discount));
  return { implied, multiple, compN: n, compMedian: median, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product, not a launch of their own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The reason a pre-token protocol fails the launch screen, or null when it passes. */
export function screenReason(p: SnapshotProtocol): string | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped or staked name';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and past the launch screen. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && screenReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; screenedOut: number; screenReasons: { reason: string; count: number }[] } {
  const { byCategory, globalMedian } = comparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol below the floor that passes
  // the same launch screen the watchlist uses. Above the floor, a protocol the
  // watchlist leaves out is not ranked: the house's rule had a reason for it
  // (a parent protocol in DefiLlama's record, which this snapshot does not
  // carry), so the radar does not second-guess it.
  const reasonCounts = new Map<string, number>();
  let screenedOut = 0;
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) {
      screenedOut++;
      reasonCounts.set('above the floor, left out by the watchlist', (reasonCounts.get('above the floor, left out by the watchlist') ?? 0) + 1);
      continue;
    }
    const reason = screenReason(p);
    if (reason !== null) {
      screenedOut++;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      continue;
    }
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, byCategory, globalMedian, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comparables_n: s.compN,
      category_median: s.compMedian,
      global_median: globalMedian,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  const screenReasons = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  return { board, screenedOut, screenReasons };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('cdp')) return `Deposit $${capital} of collateral with ${name} on ${chain} and mint its stable asset against it.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it through one distribution.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('chain') || c.includes('payment')) return `Open a ${name} wallet on ${chain}, fund it with $${capital}, and use it for one real payment.`;
  if (c.includes('governance')) return `Lock $${capital} in ${name}'s governance vault on ${chain} and vote once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different touchpoint, same protocol. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `Borrow $20 against the supply on ${name} and repay it the same week.`;
  if (c.includes('cdp')) return `Repay a small part of the minted asset on ${name} and mint it again.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $25 through ${name}'s main pool on ${chain}.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Allocate to a second ${name} vault on ${chain} with $25.`;
  if (c.includes('restak') || c.includes('staking')) return `Delegate a second $25 stake through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Hold the ${name} asset through one yield distribution and claim it.`;
  if (c.includes('basis')) return `Check ${name}'s funding rate on ${chain} and rebalance the vault position once.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a fresh one half its size.`;
  if (c.includes('prediction')) return `Settle one market on ${name} and place a second $10 position.`;
  if (c.includes('insurance')) return `File a test claim check on ${name} and renew the cover once.`;
  if (c.includes('stable')) return `Redeem $25 of the stable asset through ${name} and mint it again.`;
  if (c.includes('chain') || c.includes('payment')) return `Send a second payment through ${name} on ${chain} to a wallet you control.`;
  if (c.includes('governance')) return `Vote on a second ${name} proposal on ${chain}.`;
  return `Make a second $25 deposit into ${name} on ${chain} a week later.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. No token is promised: the
 * plan farms usage history, and the detail view says so in plain words.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: secondActionFor(p, chain), cost: 'about $25 of capital and $2 of gas', time: '10 minutes' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it in stages.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included so the page never re-derives it. */
export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comparables_n: row.model.comparables_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, screenedOut, screenReasons } = buildBoard(snapshot, model);
  const { byCategory, globalMedian } = comparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comps: Comparable[] = [...byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: 'DefiLlama protocol index, fetched 2026-11-14',
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    screened_out: screenedOut,
    screen_reasons: screenReasons,
    comparables: comps,
    global_median: round4(globalMedian),
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
