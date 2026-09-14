/* bot.js — how an auto-drafted team decides on a pick.
   Pure logic: no DOM, no timers, injectable RNG so tests are reproducible. */
(function (global) {
  'use strict';

  var LEAGUE = global.Draft.LEAGUE;

  // A player with no ADP is one the wider world is not drafting; treat them as
  // late rather than as missing, so they are still reachable but never reached
  // for. The pool tops out around 293.
  var NO_ADP = 360;

  // How many of the best candidates the weighted draw considers. Wider means
  // more surprising drafts; narrower means more chalk.
  var SHORTLIST = 5;

  /* ------------------------------------------------------------------- rng */

  // Deterministic, seedable generator (mulberry32) so a test can assert an
  // exact draft while production just passes Math.random.
  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------------- scoring */

  // Which positions this team can still take, and how badly it wants each.
  // Counting slots (12F/4D/2G) are what actually score, so filling those is
  // urgent; slots beyond them are depth and barely register.
  function positionalNeed(counts) {
    var need = {};
    ['F', 'D', 'G'].forEach(function (pos) {
      var have = counts[pos];
      var limit = LEAGUE.slots[pos];
      var scoring = LEAGUE.counting[pos];

      if (have >= limit) { need[pos] = null; return; } // roster full here

      if (have < scoring) {
        // Sharper as the hole gets bigger: a team with 0 of 2 goalies is in
        // more trouble than one with 1 of 2.
        need[pos] = 1 + 2 * ((scoring - have) / scoring);
      } else {
        need[pos] = 0.25; // bench depth only
      }
    });
    return need;
  }

  // Scarcity of the best tier still open at each position, as a multiplier.
  // A tier about to empty pulls picks forward — the run is the reason.
  function scarcityBoost(scarcity) {
    var boost = { F: 1, D: 1, G: 1 };
    ['F', 'D', 'G'].forEach(function (pos) {
      var s = scarcity[pos];
      if (!s) return;
      if (s.count <= 3) boost[pos] = 1.35;
      else if (s.count <= 6) boost[pos] = 1.15;
    });
    return boost;
  }

  // Lower is better, like ADP itself: the number is "effective draft position".
  // Need and scarcity pull a player earlier; poor value pushes them later.
  function scoreCandidate(p, need, boost, bestVorp) {
    var base = p.adp == null ? NO_ADP : p.adp;
    var value = bestVorp > 0 && p.vorp != null ? (p.vorp / bestVorp) : 0;

    // Need and scarcity both shrink the effective ADP.
    var pull = need[p.position] * boost[p.position];
    return base / (1 + 0.45 * pull + 0.35 * value);
  }

  function reasonFor(p, need, scarcity, counts) {
    var bits = [];
    var scoring = LEAGUE.counting[p.position];
    if (counts[p.position] < scoring) {
      bits.push('need ' + counts[p.position] + '/' + scoring + ' ' + p.position);
    } else {
      bits.push('depth ' + p.position);
    }
    var s = scarcity[p.position];
    if (s && s.count <= 6) {
      bits.push(s.count + ' left in ' + p.position + ' tier ' + s.tier);
    }
    bits.push(p.adp == null ? 'no ADP' : 'ADP ' + (p.adp < 10 ? p.adp.toFixed(1) : Math.round(p.adp)));
    return bits.join(' · ');
  }

  /* ---------------------------------------------------------------- choose */

  // available: ranked players still unowned (board.available)
  // counts:    this team's roster counts, from Draft.rosterCounts
  // scarcity:  { F|D|G: {tier, count} }, from the app's positionScarcity
  // rng:       () => [0,1)
  function choose(available, counts, scarcity, rng) {
    var need = positionalNeed(counts);
    var boost = scarcityBoost(scarcity);
    var random = rng || Math.random;

    var eligible = available.filter(function (p) { return need[p.position] != null; });
    if (!eligible.length) return null; // every position full — cannot happen in 21 rounds

    var bestVorp = 0;
    for (var i = 0; i < eligible.length; i++) {
      if (eligible[i].vorp != null && eligible[i].vorp > bestVorp) bestVorp = eligible[i].vorp;
    }

    var scored = eligible.map(function (p) {
      return { player: p, score: scoreCandidate(p, need, boost, bestVorp) };
    });
    scored.sort(function (a, b) { return a.score - b.score; });

    // Weighted draw over the shortlist rather than always the top one, so two
    // mocks from the same keepers diverge. Weights fall off steeply, so the
    // best candidate still usually wins.
    var short = scored.slice(0, Math.min(SHORTLIST, scored.length));
    var weights = short.map(function (_, i) { return 1 / (i + 1); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);

    var roll = random() * total;
    var pickedIndex = short.length - 1;
    for (var j = 0; j < short.length; j++) {
      roll -= weights[j];
      if (roll <= 0) { pickedIndex = j; break; }
    }

    var chosen = short[pickedIndex].player;
    return {
      player: chosen,
      reason: reasonFor(chosen, need, scarcity, counts),
      shortlist: short.map(function (s) { return s.player.name; })
    };
  }

  global.Bot = {
    NO_ADP: NO_ADP,
    SHORTLIST: SHORTLIST,
    seededRandom: seededRandom,
    positionalNeed: positionalNeed,
    scarcityBoost: scarcityBoost,
    choose: choose
  };
})(window);
