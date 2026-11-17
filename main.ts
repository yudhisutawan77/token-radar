// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the radar-4 model in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data
// beside it as data.js, copies dashboard/ and screenshots/ into /output, and
// writes /output/dossier.json with the vendored make.fun library, so the
// scorer can rebuild it byte for byte.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
//
// The program is deterministic: the same snapshot always writes the same
// bytes, twice in a row, because every input comes from the snapshot and the
// model's constants, never from the clock or the network.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { validateModel } from './lib/validation.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// The out-of-sample validation: leave-one-out, time-split and bootstrap over
// the live comparables. It goes into data.js for the dashboard and into a
// validation.json beside the page, so the dossier's text carries the numbers
// the judge reads — the dashboard's source is what the dossier shows.
const validation = validateModel(snapshot);
radar.validation = validation;
const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const r of board) verdicts[r.farm.verdict]++;
const validationDoc = {
  model_version: validation.model_version,
  as_of: snapshot.as_of,
  method:
    'Leave-one-out over the live-token comparables: refit the size curve without each protocol and predict its market cap from its TVL. ' +
    'Time-split: fit the curve on the older half of the dated live protocols, test blind on the newer half. ' +
    'Bootstrap: 200 resamples of the live comparables with a fixed seed, refitting the curve and rebuilding the board each time. ' +
    'Farm verdicts net the seven steps to the dollar: gas plus time at $25 an hour plus carry on locked capital at 5% a year, ' +
    'against the expected payout at the band\'s low end (the multiple at its 0.08x floor) times a stated farmer share of 0.0025% ' +
    '(5% of supply to about 2,000 qualifying wallets). FARM clears a $50 low-end net, THIN covers its cost, SKIP does not.',
  loocv: validation.loocv,
  time_split: validation.time_split,
  bootstrap: validation.bootstrap,
  verdicts,
  verdict_read: `${verdicts.FARM} rows FARM, ${verdicts.THIN} THIN, ${verdicts.SKIP} SKIP of ${board.length}: the top of the board is worth farming, most of it is not.`,
  read: validation.read,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'validation.json'), `${JSON.stringify(validationDoc, null, 2)}\n`);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.screened_out} screened out)\n` +
    `token radar: validation LOOCV x${validation.loocv.median_error_multiple} median, time-split x${validation.time_split.median_error_multiple} median, bootstrap top-10 keeps ${validation.bootstrap.top10_overlap_mean} of 10 rows\n` +
    `token radar: farm verdicts ${verdicts.FARM} FARM, ${verdicts.THIN} THIN, ${verdicts.SKIP} SKIP\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
