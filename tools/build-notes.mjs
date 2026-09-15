#!/usr/bin/env node
/* build-notes.mjs — assemble data/notes.json for the draft board.

   The output is private research and is gitignored: it is imported on the
   device via Setup -> Player notes, never published with the app.

   Sources:
     - NHL public API, for hard facts (age, height, shoots, last season's line)
     - tools/notes-source.json, for the 2-3 sentence summaries you write or
       generate yourself

   Usage:
     node tools/build-notes.mjs              fetch facts, merge summaries
     node tools/build-notes.mjs --offline    summaries only, no network
     node tools/build-notes.mjs --limit 120  only the top N by ADP

   Responses are cached under tools/.cache/ so re-runs cost nothing and a
   failed run never re-hammers the API.                                    */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const SEARCH = 'https://search.d3.nhle.com/api/v1/search/player';
const LANDING = 'https://api-web.nhle.com/v1/player';

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? Number(argv[i + 1]) : Infinity;
})();

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

// Same folding the app uses for search, so "stutzle" matches "Tim Stützle".
const normalize = (s) => String(s)
  .toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '');

// The pool marks position in the name for ambiguous cases, e.g. "Elias
// Pettersson (D)". Strip it for lookup but never for identity.
const bareName = (name) => name.replace(/\s*\([A-Z]+\)\s*$/, '').trim();

async function cachedFetch(url, key) {
  const file = path.join(CACHE, key + '.json');
  if (fs.existsSync(file)) return readJson(file, null);
  if (OFFLINE) return null;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = await res.json();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
  await new Promise((r) => setTimeout(r, 120)); // be a polite client
  return body;
}

async function resolveNhlId(player) {
  const q = encodeURIComponent(bareName(player.name));
  const hits = await cachedFetch(
    `${SEARCH}?culture=en-us&limit=8&q=${q}`, 'search-' + player.id);
  if (!hits || !hits.length) return { id: null, why: 'no search result' };

  const want = normalize(bareName(player.name));
  const exact = hits.filter((h) => normalize(h.name) === want);

  // A wrong match is worse than a gap, so anything ambiguous is reported
  // rather than guessed. Position breaks the common two-players-one-name case.
  if (exact.length === 1) return { id: exact[0].playerId, why: 'exact' };
  if (exact.length > 1) {
    const pos = exact.filter((h) =>
      player.position === 'G' ? h.positionCode === 'G'
        : player.position === 'D' ? h.positionCode === 'D'
          : ['C', 'L', 'R'].includes(h.positionCode));
    if (pos.length === 1) return { id: pos[0].playerId, why: 'exact + position' };
    return { id: null, why: `ambiguous (${exact.length} exact matches)` };
  }
  return { id: null, why: 'no exact name match' };
}

function factsFrom(landing) {
  if (!landing) return {};
  const out = {};
  if (landing.birthDate) {
    const b = new Date(landing.birthDate);
    out.age = Math.floor((Date.now() - b.getTime()) / 31557600000);
  }
  if (landing.heightInInches) {
    out.ht = `${Math.floor(landing.heightInInches / 12)}'${landing.heightInInches % 12}"`;
  }
  if (landing.shootsCatches) out.shoots = landing.shootsCatches;

  const last = landing.featuredStats?.regularSeason?.subSeason;
  if (last) {
    if (last.gamesPlayed != null) out.gp = last.gamesPlayed;
    if (last.goals != null) out.g = last.goals;
    if (last.assists != null) out.a = last.assists;
    if (last.points != null) out.pts = last.points;
    if (last.wins != null) out.w = last.wins;
    if (last.shutouts != null) out.so = last.shutouts;
  }
  return out;
}

async function main() {
  const players = readJson(path.join(ROOT, 'data', 'players.json'), null);
  if (!players) throw new Error('data/players.json not found');

  const summaries = readJson(path.join(ROOT, 'tools', 'notes-source.json'), {});
  const ranked = players
    .slice()
    .sort((a, b) => (a.adp ?? 999) - (b.adp ?? 999))
    .slice(0, LIMIT);

  const notes = {};
  const unresolved = [];
  let withFacts = 0, withSummary = 0;

  // A summary written against an id the pool does not carry is silently lost
  // otherwise — and ids are slugs, so "tim-stutzle" vs "tim-st-tzle" is an easy
  // miss. Report them with the closest match rather than dropping them.
  const poolIds = new Set(players.map((x) => x.id));
  const orphans = Object.keys(summaries)
    .filter((id) => id !== '_comment' && !poolIds.has(id))
    .map((id) => {
      const want = normalize(id);
      const near = players.find((x) => normalize(x.id) === want) ||
        players.find((x) => normalize(x.name) === want);
      return near ? `${id} -> did you mean "${near.id}" (${near.name})?` : id;
    });

  for (const p of ranked) {
    const entry = {};

    if (!OFFLINE) {
      try {
        const { id, why } = await resolveNhlId(p);
        if (id) {
          Object.assign(entry, factsFrom(await cachedFetch(`${LANDING}/${id}/landing`, 'player-' + id)));
          if (Object.keys(entry).length) withFacts++;
        } else {
          unresolved.push(`${p.name} (${p.position}) — ${why}`);
        }
      } catch (err) {
        unresolved.push(`${p.name} (${p.position}) — ${err.message}`);
      }
    }

    if (summaries[p.id]) { entry.note = summaries[p.id]; withSummary++; }
    if (!Object.keys(entry).length) continue;

    entry.src = OFFLINE ? 'manual' : 'nhl+manual';
    entry.updated = new Date().toISOString().slice(0, 10);
    notes[p.id] = entry;
  }

  const out = path.join(ROOT, 'data', 'notes.json');
  fs.writeFileSync(out, JSON.stringify({
    v: 1, generated: new Date().toISOString().slice(0, 10), notes
  }, null, 2));

  console.log(`\nWrote ${out}`);
  console.log(`  ${Object.keys(notes).length} of ${ranked.length} players covered`);
  console.log(`  ${withFacts} with NHL facts, ${withSummary} with a written summary`);
  if (orphans.length) {
    console.log(`\n${orphans.length} summary id(s) are not in the player pool:`);
    orphans.forEach((o) => console.log('  ' + o));
  }
  if (unresolved.length) {
    console.log(`\n${unresolved.length} name(s) not resolved — add them to`);
    console.log('notes-source.json by hand rather than letting the script guess:');
    unresolved.forEach((u) => console.log('  ' + u));
  }
  console.log('\nImport it in the app: Setup -> Player notes -> Import notes.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
