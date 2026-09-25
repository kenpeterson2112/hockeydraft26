/* app.js — controller: owns state, derives the board, renders, wires events. */
(function (global) {
  'use strict';

  var $ = UI.$, $$ = UI.$$, el = UI.el, num = UI.num, normalize = UI.normalize;
  var LEAGUE = Draft.LEAGUE;

  var APP_VERSION = '2.13.1';

  var players = [];              // seeded from data/players.json
  var playersById = {};
  var searchKeys = {};           // playerId -> normalized name, built once

  var state = Draft.freshState();

  // The draft's size is state, not a constant — the live and mock drafts can
  // differ, and a team can drop out before either starts.
  function nTeams() { return state.teams.length; }
  function nPicks() { return Draft.totalPicks(state); }
  function nKeepers() { return Draft.totalKeepers(state); }
  function label(n) { return Draft.pickLabel(n, state.teams.length); }

  /* ---------------------------------------------------------------- notes
     Scouting notes are research, not draft state: they are imported from a
     file on this device and kept under their own key, so no scope of the reset
     modal touches them and nothing is ever committed to the public repo. */

  var NOTES_KEY = 'hockeydraft26.notes.v1';
  var notes = {};   // playerId -> { age, ht, shoots, gp, g, a, pts, note, src, updated }

  function loadNotes() {
    try {
      var raw = global.localStorage.getItem(NOTES_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && parsed.notes) || {};
    } catch (err) {
      console.warn('Could not load player notes.', err);
      return {};
    }
  }

  function saveNotes(map) {
    try {
      global.localStorage.setItem(NOTES_KEY, JSON.stringify({ v: 1, notes: map }));
      return true;
    } catch (err) {
      // The pool is ~160KB, well inside the quota, but a full origin should
      // report honestly rather than silently drop the import.
      console.warn('Could not save player notes.', err);
      UI.showToast('Could not save notes — this device is out of storage.');
      return false;
    }
  }

  function noteFor(playerId) {
    var n = notes[playerId];
    return n && (n.note || n.age != null || n.gp != null) ? n : null;
  }

  function notesCoverage() {
    var n = 0;
    for (var i = 0; i < players.length; i++) if (noteFor(players[i].id)) n++;
    return n;
  }

  /* ------------------------------------------------------------- injuries
     data/injuries.json is ESPN's injury report cut down to this pool, built by
     tools/fetch-injuries.py and published with the app. Optional: a missing or
     unreadable file just means no badges. */

  var injuryDoc = null;   // { source, url, fetched, players: { id: {...} } }

  // Short code for the row, word for the sheet, and a severity for the colour.
  var INJURY = {
    'O':     { code: 'OUT',  word: 'Out',             sev: 'out' },
    'IR':    { code: 'IR',   word: 'Injured reserve', sev: 'out' },
    'IR-LT': { code: 'LTIR', word: 'Long-term IR',    sev: 'out' },
    'DTD':   { code: 'DTD',  word: 'Day-to-day',      sev: 'dtd' },
    'SUSP':  { code: 'SUSP', word: 'Suspended',       sev: 'susp' }
  };

  function injuryFor(playerId) {
    var i = injuryDoc && injuryDoc.players && injuryDoc.players[playerId];
    return i && INJURY[i.status] ? i : null;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "2026-10-02" -> "Oct 2". Parsed by hand: new Date() would read it as UTC
  // midnight and show the day before anywhere west of Greenwich.
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : '';
  }

  // The badge beside it already says OUT, so the box drops a word that only
  // repeats it; "Long-term IR" says more than LTIR and stays.
  function injurySummary(i, besideBadge) {
    var kind = INJURY[i.status];
    var parts = besideBadge && kind.word.toUpperCase() === kind.code ? [] : [kind.word];
    if (i.injury && i.injury.toLowerCase() !== 'suspension') parts.push(i.injury);
    if (i.return) parts.push('back ' + shortDate(i.return));
    return parts.join(' \u00b7 ');
  }

  function buildInjuryBox(i) {
    var box = el('div', 'injbox inj-' + INJURY[i.status].sev);
    var head = el('div', 'injbox-head');
    head.appendChild(el('span', 'p-inj inj-' + INJURY[i.status].sev, INJURY[i.status].code));
    head.appendChild(el('span', null, injurySummary(i, true)));
    box.appendChild(head);
    if (i.note) box.appendChild(el('p', 'injbox-note', i.note));
    box.appendChild(el('p', 'injbox-meta', 'ESPN' +
      (i.updated ? ' \u00b7 ' + shortDate(i.updated) : '')));
    return box;
  }

  function renderInjuryStatus() {
    var line = $('#injuryStatus');
    if (!line) return;
    if (!injuryDoc) {
      line.textContent = 'No injury report loaded.';
      return;
    }
    var n = Object.keys(injuryDoc.players || {}).length;
    var when = injuryDoc.fetched || '';
    line.textContent = 'Injuries: ' + n + ' player' + (n === 1 ? '' : 's') +
      ' flagged, from ESPN as of ' + shortDate(when) +
      (when.length >= 16 ? ', ' + when.slice(11, 16) + ' UTC' : '') + '.';
  }

  /* ------------------------------------------------------------------ mode
     'live' and 'mock' are two complete drafts persisted under two different
     keys. Everything below reads and writes whichever one is active, so a
     practice run has no route to the real draft's storage at all. */

  var mode = 'live';

  function storageKey() {
    return mode === 'mock' ? Draft.MOCK_STORAGE_KEY : Draft.STORAGE_KEY;
  }

  function saveState() { return Draft.save(state, storageKey()); }

  function isMock() { return mode === 'mock'; }

  // Transient view state — deliberately not persisted.
  var view = {
    tab: 'board',
    // One position at a time: 'ALL' | 'F' | 'D' | 'G'. The chips are a radio
    // group, not three independent toggles.
    position: 'ALL',
    search: '',
    sort: 'rank',
    sortDir: 'asc',
    showDrafted: false,
    expandedTeams: {},
    keeperTeam: 0,
    keeperSearch: '',
    // The most recent bot pick, for the top-bar readout and the row flash.
    // Deliberately transient: a reload should not replay a stale flash.
    lastPick: null
  };

  /* ------------------------------------------------------------ board data */

  // Sortable columns. `best` is the direction that puts the most desirable
  // player first — descending for VORP and points, ascending for ADP (drafted
  // earlier is better). Tapping a column sorts it that way; tapping the active
  // column again reverses. '#' sorts by board order, which is how tier sorting
  // stays reachable now that tier has no column of its own.
  var SORT_COLUMNS = {
    rank:   { best: 'asc',  value: null },
    adp:    { best: 'asc',  value: function (p) { return p.adp; } },
    vorp:   { best: 'desc', value: function (p) { return p.vorp; } },
    points: { best: 'desc', value: function (p) { return p.points; } }
  };

  // Fixed value ordering used for the # column and the next-pick divider,
  // independent of however the user has chosen to display the list.
  function canonicalCompare(a, b) {
    return (a.tier - b.tier) || (b.vorp - a.vorp) || (b.points - a.points) ||
      a.name.localeCompare(b.name);
  }

  function displayCompare(a, b) {
    var col = SORT_COLUMNS[view.sort] || SORT_COLUMNS.rank;
    if (!col.value) return canonicalCompare(a, b);

    var av = col.value(a), bv = col.value(b);
    // Players with no ADP sink to the bottom either way — an absent value is
    // not a good value, and it is not a bad one either.
    if (av == null && bv == null) return canonicalCompare(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;

    var diff = av - bv;
    if (diff) return view.sortDir === 'asc' ? diff : -diff;
    return canonicalCompare(a, b);
  }

  // The full combined board of everyone still available. Ranks come from here —
  // never from the filtered view — because opponents can take any position
  // between now and Ken's next turn.
  function buildBoard() {
    var owners = Draft.ownerMap(state);
    var available = players.filter(function (p) { return owners[p.id] == null; });
    available.sort(canonicalCompare);

    var rankById = {};
    for (var i = 0; i < available.length; i++) rankById[available[i].id] = i;

    return { owners: owners, available: available, rankById: rankById };
  }

  // A name search is a "jump to this player" action, so it deliberately
  // overrides both the position filter and the hide-drafted rule — otherwise
  // looking someone up depends on having the right chips selected.
  function matchesFilters(p, board) {
    if (view.search) return searchKeys[p.id].indexOf(view.search) !== -1;
    if (view.position === 'QUEUE') return queued(p.id) !== -1;
    if (view.position !== 'ALL' && p.position !== view.position) return false;
    if (!view.showDrafted && board.owners[p.id] != null) return false;
    return true;
  }

  /* --------------------------------------------------------------- actions */

  function draftPlayer(playerId, teamId) {
    if (state.picks.length >= nPicks()) {
      UI.showToast('All ' + nPicks() + ' picks are in.');
      return;
    }
    if (Draft.ownerMap(state)[playerId] != null) {
      UI.showToast('That player is already off the board.');
      return;
    }

    var p = playersById[playerId];
    var team = state.teams[teamId];
    var n = state.picks.length + 1;

    state.picks.push({ playerId: playerId, teamId: teamId, n: n });
    dropFromQueue(playerId);
    if (isMock()) view.lastPick = { playerId: playerId, teamId: teamId, n: n };
    saveState();
    render();
    if (isMock()) mock.nudge();

    var counts = Draft.rosterCounts(state, teamId, playersById);
    var over = counts[p.position] > LEAGUE.slots[p.position];
    var msg = label(n) + ' · ' + team.name + ' take ' + p.name;
    if (over) {
      msg += ' — over the ' + p.position + ' limit (' +
        counts[p.position] + '/' + LEAGUE.slots[p.position] + ')';
    }
    UI.showToast(msg, 'Undo', undoLastPick);
  }

  function undoLastPick() {
    if (!state.picks.length) return;
    // Undoing mid-mock means he wants a moment; do not let the clock run on.
    if (isMock() && mock.isRunning()) mock.pause();
    view.lastPick = null;
    var last = state.picks.pop();
    var p = playersById[last.playerId];
    var name = p ? p.name : 'pick';

    // A hand-entered player only exists because of the pick that created it, so
    // undoing that pick removes it rather than orphaning it in the roster data.
    var wasCustom = forgetCustomPlayer(last.playerId);

    saveState();
    render();
    UI.showToast('Undid ' + label(last.n) + ' — ' + name +
      (wasCustom ? ' removed.' : ' is back on the board.'));
  }

  // Removes a player from whichever team holds them. A live pick can only be
  // pulled back if it is the most recent one, so the snake stays consistent.
  function releasePlayer(playerId) {
    if (view.lastPick && view.lastPick.playerId === playerId) view.lastPick = null;
    if (state.keepers[playerId] != null) {
      delete state.keepers[playerId];
      saveState();
      render();
      UI.showToast('Keeper removed.');
      return;
    }
    var idx = -1;
    for (var i = 0; i < state.picks.length; i++) {
      if (state.picks[i].playerId === playerId) idx = i;
    }
    if (idx === -1) return;
    if (idx !== state.picks.length - 1) {
      UI.showToast('Only the most recent pick can be undone — undo back to it first.');
      return;
    }
    undoLastPick();
  }

  /* ------------------------------------------------- manually entered picks */

  var DEFAULT_CUSTOM_POINTS = 45;

  // Registered into the id lookup but deliberately NOT into `players`: a
  // hand-entered player has no ranking, so it must never surface on the board.
  // It exists only as a roster entry, which is all the scoring needs.
  function registerCustomPlayers() {
    for (var i = 0; i < state.customPlayers.length; i++) {
      var p = state.customPlayers[i];
      playersById[p.id] = p;
    }
  }

  function forgetCustomPlayer(playerId) {
    var kept = state.customPlayers.filter(function (p) { return p.id !== playerId; });
    if (kept.length === state.customPlayers.length) return false;
    state.customPlayers = kept;
    delete playersById[playerId];
    return true;
  }

  function customId(name) {
    return 'custom-' + (normalize(name) || 'player') + '-' + Date.now().toString(36);
  }

  // Returns whether the keeper was actually added, so the caller only resets
  // the search box on a real assignment.
  function assignKeeper(playerId, teamId) {
    if (Draft.ownerMap(state)[playerId] != null) return false;
    if (Draft.keepersForTeam(state, teamId).length >= LEAGUE.keepersPerTeam) {
      UI.showToast(state.teams[teamId].name + ' already has ' + LEAGUE.keepersPerTeam + ' keepers.');
      return false;
    }
    state.keepers[playerId] = teamId;
    // A keeper is owned before the draft starts, so he is no longer a plan.
    // The sheet will not offer to queue an owned player, but queueing someone
    // and THEN keepering him is a path the sheet cannot see.
    dropFromQueue(playerId);
    saveState();
    render();
    return true;
  }

  /* ---------------------------------------------------------------- render */

  // Lowest (best) tier still unowned at each position, and how many are left in
  // it. Keepers count as owned, so these reflect keeper losses before pick 1.
  function positionScarcity(board) {
    var out = { F: null, D: null, G: null };
    var i, p;
    for (i = 0; i < board.available.length; i++) {
      p = board.available[i];
      if (out[p.position] == null || p.tier < out[p.position].tier) {
        out[p.position] = { tier: p.tier, count: 0 };
      }
    }
    for (i = 0; i < board.available.length; i++) {
      p = board.available[i];
      if (out[p.position] && p.tier === out[p.position].tier) out[p.position].count++;
    }
    return out;
  }

  // The badge colour tracks how deep the tier still is, not which tier it is:
  // plenty left means you can wait, a handful means the run is nearly over.
  function scarcityLevel(count) {
    if (count >= 7) return 'good';
    if (count >= 4) return 'concern';
    return 'danger';
  }

  var POS_WORD = { F: 'forwards', D: 'defence', G: 'goalies' };
  var LEVEL_WORD = { good: 'plenty left', concern: 'thinning', danger: 'nearly gone' };

  function renderTierBadges(board) {
    var scarcity = positionScarcity(board);
    var me = Draft.myTeam(state);
    var mine = me ? Draft.rosterCounts(state, me.id, playersById) : { F: 0, D: 0, G: 0 };

    ['F', 'D', 'G'].forEach(function (pos) {
      var badge = $('#badge-' + pos);
      var chip = $('.chip-' + pos);
      var s = scarcity[pos];

      // Left of the chip: how full Ken's own roster is at this position.
      var have = mine[pos];
      var limit = LEAGUE.slots[pos];
      var countEl = $('#count-' + pos);
      countEl.textContent = have + '/' + limit;
      countEl.classList.toggle('is-full', have >= limit);

      if (s == null) {
        // No one left at the position — cannot happen with this pool, but the
        // badge should vanish rather than show a stale number if it ever does.
        badge.hidden = true;
        delete badge.dataset.level;
        chip.setAttribute('aria-label',
          'Show only ' + POS_WORD[pos] + ', you have ' + have + ' of ' + limit + ', none left');
        return;
      }

      var level = scarcityLevel(s.count);
      badge.hidden = false;
      badge.textContent = String(s.tier);
      badge.dataset.level = level;
      chip.title = 'You have ' + have + ' of ' + limit + ' ' + POS_WORD[pos] + ' · ' +
        s.count + ' tier ' + s.tier + ' left';
      chip.setAttribute('aria-label',
        'Show only ' + POS_WORD[pos] + ', you have ' + have + ' of ' + limit +
        ', best tier available ' + s.tier + ', ' + s.count + ' left, ' + LEVEL_WORD[level]);
    });
  }

  function render() {
    var board = buildBoard();
    renderTopbar(board);
    renderTierBadges(board);
    syncChips();
    renderMockChrome(board);
    renderStart();
    if (view.tab === 'board') renderBoard(board);
    if (view.tab === 'teams') renderTeams(board);
    if (view.tab === 'setup') renderSetup(board);
  }

  function renderTopbar(board) {
    var c = Draft.clock(state);
    var topbar = $('#topbar');

    $('#undoBtn').disabled = state.picks.length === 0;
    $('#addPickBtn').hidden = !state.setupDone || c.complete;

    if (c.complete) {
      $('#pickLabel').textContent = 'Done';
      $('#onClockText').textContent = 'Draft complete';
      $('#turnLine').textContent = nPicks() + ' picks made · ' +
        Draft.keeperCount(state) + ' keepers';
      topbar.classList.remove('is-mine');
      $('#turnLine').classList.remove('is-mine');
      return;
    }

    $('#pickLabel').textContent = label(c.currentPick);
    $('#onClockText').innerHTML = '';
    $('#onClockText').appendChild(document.createTextNode(c.onClockTeam.name));
    if (c.onClockIsMe) {
      $('#onClockText').appendChild(el('span', 'me-tag', 'YOU'));
    }
    if (c.onClockVia) {
      $('#onClockText').appendChild(el('span', 'via-tag', 'via ' + c.onClockVia.name));
    }

    topbar.classList.toggle('is-mine', c.onClockIsMe);
    var turn = $('#turnLine');
    turn.classList.toggle('is-mine', c.onClockIsMe);
    turn.innerHTML = '';

    if (!state.setupDone) {
      turn.textContent = isMock() ? 'Mock not started.' : 'Live draft not started.';
      return;
    }

    if (c.onClockIsMe) {
      turn.appendChild(document.createTextNode("You're up! Next selection in "));
      turn.appendChild(el('b', null, String(c.picksUntilMine)));
      turn.appendChild(document.createTextNode(
        ' pick' + (c.picksUntilMine === 1 ? '' : 's') + '.'));
    } else {
      var b2 = el('b', null, String(c.picksUntilMine));
      turn.appendChild(document.createTextNode('Your pick '));
      turn.appendChild(b2);
      turn.appendChild(document.createTextNode(
        ' pick' + (c.picksUntilMine === 1 ? '' : 's') + ' away · ' + label(c.targetPick)
      ));
    }
  }

  function renderBoard(board) {
    var list = $('#playerList');
    var frag = document.createDocumentFragment();
    var c = Draft.clock(state);
    var horizon = (state.setupDone && !c.complete) ? c.picksUntilMine : 0;

    // Rows are about to be replaced; never leave a press pointing at one.
    cancelHold();
    renderHoldHint(c);
    renderSortHeader();

    var inQueue = view.position === 'QUEUE' && !view.search;
    var shown = players.filter(function (p) { return matchesFilters(p, board); });
    shown.sort(function (a, b) {
      // Your queue is an ordering you made on purpose; no column overrules it.
      if (inQueue) return queued(a.id) - queued(b.id);
      var ao = board.owners[a.id] != null, bo = board.owners[b.id] != null;
      if (ao !== bo) return ao ? 1 : -1; // drafted players sink to the bottom
      return displayCompare(a, b);
    });

    // Two rulers, because they answer different questions: the first is what
    // you can still get this turn, the second is what survives to the pick
    // after it — which is what decides whether you can afford to wait.
    var marks = [];
    if (horizon > 0 && !inQueue) {
      marks.push({ at: dividerIndex(shown, board, horizon), horizon: horizon,
                   pick: c.targetPick, second: false });
      if (c.picksUntilSecond > 0) {
        marks.push({ at: dividerIndex(shown, board, c.picksUntilSecond),
                     horizon: c.picksUntilSecond, pick: c.secondPick, second: true });
      }
    }
    var heat = buildHeat(board.available);

    var emit = function (idx) {
      for (var m = 0; m < marks.length; m++) {
        if (marks[m].at === idx) frag.appendChild(buildDivider(marks[m], c));
      }
    };

    for (var i = 0; i < shown.length; i++) {
      emit(i);
      var p = shown[i];
      frag.appendChild(buildPlayerRow(p, board.owners[p.id], board.rankById[p.id], c, horizon, heat));
    }
    emit(shown.length);

    // Drives which value column is emphasised, so the eye lands on the column
    // the list is actually ordered by.
    list.dataset.sort = view.sort;
    list.innerHTML = '';
    list.appendChild(frag);
    $('#boardEmpty').hidden = shown.length > 0;
    $('#searchNote').hidden = !view.search;
  }

  // One line naming the team a hold would draft to, rather than repeating that
  // team on every row. It is discovery UI, so it retires after the first few
  // picks and gives its height back to the board; the on-clock team stays
  // visible in the header regardless.
  var HINT_PICKS = 3;

  function renderHoldHint(c) {
    var hint = $('#holdHint');
    hint.hidden = !state.setupDone || c.complete || state.picks.length >= HINT_PICKS;
    if (hint.hidden) return;
    hint.innerHTML = '';
    hint.appendChild(document.createTextNode('Hold a player to draft to '));
    hint.appendChild(el('b', null, c.onClockTeam.name));
    hint.appendChild(document.createTextNode(' \u00b7 tap to choose another team'));
  }

  function renderSortHeader() {
    $$('.lh-sort').forEach(function (btn) {
      var key = btn.dataset.sort;
      var active = key === view.sort;
      var dir = active ? view.sortDir : null;
      btn.classList.toggle('is-active', active);
      btn.classList.toggle('is-asc', dir === 'asc');
      $('.lh-arrow', btn).textContent = active ? (dir === 'asc' ? '\u25B2' : '\u25BC') : '';
      btn.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  function sortBy(key) {
    if (!SORT_COLUMNS[key]) return;
    if (view.sort === key) {
      view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      view.sort = key;
      view.sortDir = SORT_COLUMNS[key].best;
    }
    renderBoard(buildBoard());
  }

  // The line is a ruler, not a claim: it sits exactly `horizon` rows down so the
  // picks until Ken is up can be counted off the screen, and it stays put when
  // the position filter changes. Which players are actually projected gone is a
  // property of the board rather than of the view, and that is carried by the
  // per-row shading instead — the two coincide on an unfiltered board and each
  // stays honest when they diverge.
  function dividerIndex(shown, board, horizon) {
    var seen = 0;
    for (var i = 0; i < shown.length; i++) {
      if (board.owners[shown[i].id] != null) continue; // drafted rows are not picks to come
      seen++;
      if (seen === horizon) return i + 1;
    }
    return null; // fewer rows on screen than picks to count
  }

  function buildDivider(mark, c) {
    var li = el('li', 'divider' + (mark.second ? ' is-second' : ''));
    li.appendChild(el('span', 'divider-label',
      (mark.second ? 'Your 2nd pick · ' : 'Your pick · ') + label(mark.pick)));
    li.appendChild(el('span', 'divider-note',
      mark.horizon + ' pick' + (mark.horizon === 1 ? '' : 's') +
      (mark.second ? ' away' : " until you're up")));
    return li;
  }

  // One decimal below 10, where the gap between the first and second pick
  // actually means something, and whole numbers above it, where it does not —
  // which also keeps the column narrow enough to leave room for the name.
  /* ------------------------------------------------ value-column heat map */

  // Percentile anchors the user asked for: best remaining is green, the 66th
  // percentile amber, the 33rd and below red.
  var HEAT_STOPS = [{ at: 0.33, h: 0 }, { at: 0.66, h: 45 }, { at: 1, h: 150 }];

  // Where each remaining player sits on a metric, 1 = best, 0 = worst.
  // Measured over the whole remaining pool rather than the filtered view: the
  // question the colour answers is "is this good for what is still out there",
  // and that does not change because a position chip is selected.
  function percentiles(available, valueOf, bestIs) {
    var rows = [];
    for (var i = 0; i < available.length; i++) {
      var v = valueOf(available[i]);
      if (v != null) rows.push({ id: available[i].id, v: v });
    }
    rows.sort(function (a, b) { return bestIs === 'asc' ? a.v - b.v : b.v - a.v; });

    var out = Object.create(null);
    for (var j = 0; j < rows.length; j++) {
      out[rows[j].id] = rows.length > 1 ? 1 - (j / (rows.length - 1)) : 1;
    }
    return out;
  }

  function buildHeat(available) {
    return {
      // Low ADP is good, high VORP is good — the ramp reads desirability, not
      // magnitude, so both columns are green at the top.
      adp: percentiles(available, function (p) { return p.adp; }, 'asc'),
      vorp: percentiles(available, function (p) { return p.vorp; }, 'desc')
    };
  }

  function heatColor(pct) {
    if (pct == null) return null;
    var hue = HEAT_STOPS[0].h;
    for (var i = 1; i < HEAT_STOPS.length; i++) {
      var lo = HEAT_STOPS[i - 1], hi = HEAT_STOPS[i];
      if (pct <= lo.at) break;
      var t = Math.min(1, (pct - lo.at) / (hi.at - lo.at));
      hue = lo.h + t * (hi.h - lo.h);
    }
    return 'hsl(' + Math.round(hue) + ', 78%, 62%)';
  }

  // Colour the value column the list is NOT ordered by: sorted by ADP, the VORP
  // number tells you what consensus is missing, and vice versa. Under the # or
  // Pts sort neither is the key, so both are coloured.
  function heatFor(key) {
    return view.sort !== key;
  }

  function formatAdp(v) {
    if (v == null) return '–';
    return v < 10 ? v.toFixed(1) : String(Math.round(v));
  }

  function buildPlayerRow(p, ownerId, rank, c, horizon, heat) {
    var available = ownerId == null && state.setupDone && !c.complete;
    // Whether a player is projected gone is a fact about the board, so shading
    // the rows says it exactly — the divider alone can only approximate it once
    // the display order stops matching board rank.
    var projectedGone = ownerId == null && horizon > 0 && rank < horizon;
    // Only visible with "Drafted" ticked — the row is off the board otherwise,
    // which is the ordinary case and why the top-bar line carries the signal.
    var justPicked = view.lastPick && view.lastPick.playerId === p.id;
    var li = el('li', 'prow pos-' + p.position +
      (ownerId != null ? ' is-taken' : '') +
      (projectedGone ? ' is-projected-gone' : ''));
    if (justPicked && isMock()) {
      li.classList.add('is-justpicked');
      li.style.animationDuration = mock.getSpeed() + 's';
    }

    li.appendChild(el('span', 'p-rank', ownerId == null ? String(rank + 1) : '–'));

    var main = el('div', 'p-main');
    main.appendChild(el('span', 'p-name', p.name));
    var sub = el('span', 'p-sub');
    sub.appendChild(el('span', 'p-pos', p.position));
    sub.appendChild(el('span', 'p-tier-chip', 'T' + p.tier));
    sub.appendChild(el('span', null, p.team));
    var qAt = queued(p.id);
    if (qAt !== -1) {
      var star = el('span', 'p-queued', '\u2605' + (qAt + 1));
      star.title = 'Number ' + (qAt + 1) + ' in your queue';
      sub.appendChild(star);
    }
    if (ownerId != null) {
      var isKeeper = state.keepers[p.id] != null;
      sub.appendChild(el('span', 'p-owner' + (isKeeper ? ' is-keeper' : ''),
        (isKeeper ? 'K · ' : '') + state.teams[ownerId].name));
    }
    // Icon buttons go last, at the true end of the row -- away from the name
    // and team text a thumb is actually aiming at, and grouped together so
    // there is one place to learn they are both safe to tap mid-press.
    var hurt = injuryFor(p.id);
    if (hurt) sub.appendChild(buildInjuryBadge(hurt, p));
    // Only where there is something to read, so the button doubles as "I have
    // research on this guy" and there are no dead taps.
    if (noteFor(p.id)) sub.appendChild(buildNotesButton(p));
    main.appendChild(sub);
    li.appendChild(main);

    var adpCell = el('span', 'p-num p-adp', formatAdp(p.adp));
    var vorpCell = el('span', 'p-num p-vorp', num(p.vorp));
    // Only for players still on the board: the scale is defined over what is
    // remaining, so a drafted row has no place on it. Inline rather than a
    // class so it cannot collide with the sorted-column rule — and it never
    // has to, since the coloured column is by definition not the sorted one.
    if (heat && ownerId == null) {
      if (heatFor('adp')) tint(adpCell, heat.adp[p.id]);
      if (heatFor('vorp')) tint(vorpCell, heat.vorp[p.id]);
    }
    li.appendChild(adpCell);
    li.appendChild(vorpCell);
    li.appendChild(el('span', 'p-num p-pts', num(p.points)));

    // Reordering lives only in the queue view, where the order is the point.
    if (view.position === 'QUEUE' && !view.search && qAt !== -1) {
      li.classList.add('has-qmove');
      var moves = el('span', 'q-move');
      [['\u25b2', -1, 'up'], ['\u25bc', 1, 'down']].forEach(function (spec) {
        var b = el('button', 'q-btn', spec[0]);
        b.type = 'button';
        b.disabled = spec[1] < 0 ? qAt === 0 : qAt === state.queue.length - 1;
        b.setAttribute('aria-label', 'Move ' + p.name + ' ' + spec[2] + ' the queue');
        b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
        b.addEventListener('click', function (ev) {
          ev.stopPropagation(); ev.preventDefault();
          moveInQueue(p.id, spec[1]);
        });
        moves.appendChild(b);
      });
      li.appendChild(moves);
    }

    if (available) {
      li.classList.add('is-actionable');
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.setAttribute('aria-label',
        'Hold to draft ' + p.name + ' to ' + c.onClockTeam.name + ', or tap to choose a team');
      attachHold(li, p, c.onClockTeam);
    }

    return li;
  }

  /* ---------------------------------------------------------------- queue */

  function queued(playerId) { return (state.queue || []).indexOf(playerId); }

  function toggleQueue(playerId) {
    if (!state.queue) state.queue = [];
    var at = state.queue.indexOf(playerId);
    if (at === -1) state.queue.push(playerId);
    else state.queue.splice(at, 1);
    saveState();
    render();
    return at === -1;
  }

  // Up and down rather than drag: a drag handle on a row that is also a
  // press-to-draft target is a mis-draft waiting to happen, and reordering a
  // shortlist of five is not worth that risk.
  function moveInQueue(playerId, delta) {
    var at = state.queue.indexOf(playerId);
    var to = at + delta;
    if (at === -1 || to < 0 || to >= state.queue.length) return;
    state.queue.splice(to, 0, state.queue.splice(at, 1)[0]);
    saveState();
    render();
  }

  // Someone else took him, so he is no longer a plan. Called on every pick,
  // including the bots' during a mock.
  function dropFromQueue(playerId) {
    if (!state.queue) return false;
    var at = state.queue.indexOf(playerId);
    if (at === -1) return false;
    state.queue.splice(at, 1);
    return true;
  }

  /* --------------------------------------------------------- player notes */

  // The row is already a press target, so a button living inside it — the
  // notes "i" and the injury badge alike — must never reach the hold. Two
  // guards, deliberately redundant: it stops its own events here, and
  // attachHold bails on anything inside .p-infobtn — that second one cannot
  // be defeated by event ordering once the global hold listeners are live.
  function buildRowIconButton(content, ariaLabel, onClick) {
    var btn = el('button', 'p-infobtn');
    btn.type = 'button';
    btn.setAttribute('aria-label', ariaLabel);
    if (typeof content === 'string') btn.textContent = content;
    else btn.appendChild(content);
    btn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      onClick();
    });
    return btn;
  }

  function buildNotesButton(p) {
    var btn = buildRowIconButton('i', 'Notes on ' + p.name, function () { openNotes(p); });
    btn.classList.add('p-notes');
    return btn;
  }

  // Tapping it opens the same info popover as the notes "i" — the injury box
  // rides at the top of it — so checking on a hurt player never risks landing
  // mid-press on the row underneath.
  function buildInjuryBadge(i, p) {
    var pill = el('span', 'p-inj inj-' + INJURY[i.status].sev, INJURY[i.status].code);
    var btn = buildRowIconButton(pill,
      injurySummary(i) + ' — tap for details', function () { openNotes(p); });
    btn.title = injurySummary(i);
    return btn;
  }

  // A top-level element rather than a child of the row: a mock draft rebuilds
  // every row on each pick, which would otherwise tear an open modal down.
  //
  // Doubles as the injury popover (opened from the badge) and carries a
  // draft action of its own, so checking on a player never has to end with
  // closing this and re-finding him in a rebuilt list to actually take him.
  //
  // That draft action names a team and a pick number as of right now; a mock
  // left running underneath could move the clock while this sits open and
  // turn it into a mis-draft. Same call as undo: reading this means he wants
  // a moment, so the clock stops rather than racing him.
  function openNotes(p) {
    if (isMock() && mock.isRunning()) mock.pause();

    var n = notes[p.id] || {};
    var modal = $('#noteModal');

    $('#noteName').textContent = p.name;
    $('#noteSub').textContent = p.position + ' · ' + p.team + ' · Tier ' + p.tier +
      ' · ADP ' + formatAdp(p.adp) + ' · ' + num(p.points) + ' pts';

    var injHost = $('#noteInj');
    injHost.innerHTML = '';
    var hurt = injuryFor(p.id);
    if (hurt) injHost.appendChild(buildInjuryBox(hurt));
    injHost.hidden = !hurt;

    var facts = $('#noteFacts');
    facts.innerHTML = '';
    addFact(facts, 'Age', n.age);
    addFact(facts, 'Ht', n.ht);
    // A goalie catches rather than shoots, and wins and shutouts are the only
    // two numbers that score for him in this league — showing his goal total
    // instead would be showing the wrong stat line entirely.
    if (p.position === 'G') {
      addFact(facts, 'Catches', n.shoots);
      addFact(facts, 'GP', n.gp);
      addFact(facts, 'W', n.w);
      addFact(facts, 'SO', n.so);
    } else {
      addFact(facts, 'Shoots', n.shoots);
      addFact(facts, 'GP', n.gp);
      addFact(facts, 'G', n.g);
      addFact(facts, 'A', n.a);
      addFact(facts, 'Pts', n.pts);
    }
    facts.hidden = !facts.childNodes.length;

    $('#noteText').textContent = n.note || 'No summary for this player yet.';
    $('#noteText').classList.toggle('is-empty', !n.note);

    var meta = [];
    if (n.src) meta.push(n.src);
    if (n.updated) meta.push('updated ' + n.updated);
    $('#noteMeta').textContent = meta.join(' · ');
    $('#noteMeta').hidden = !meta.length;

    // Same "can this be drafted right now" test buildPlayerRow uses for the
    // row itself, so the button appears exactly when the hold would have
    // worked — and stays silent for an owned player or a draft not running.
    //
    // Deliberately one hop, not a direct commit: this popover is opened with
    // the same light, repeatable tap used to just glance at a player, and a
    // one-tap "Draft to X" button living right there turned out to draft
    // whoever the user was glancing at, the moment a quick run through
    // several players landed a stray tap on it. Handing off to the sheet
    // keeps it to a single tap here and a second, deliberate one there — the
    // same two steps a plain tap on the row itself has always taken.
    var c = Draft.clock(state);
    var ownerId = Draft.ownerMap(state)[p.id];
    var actions = $('#noteActions');
    actions.innerHTML = '';
    var canDraft = ownerId == null && state.setupDone && !c.complete;
    if (canDraft) {
      var go = el('button', 'btn btn-primary', 'Draft this player…');
      go.type = 'button';
      go.addEventListener('click', function () {
        closeNotes();
        openPlayerSheet(p);
      });
      actions.appendChild(go);
    }
    actions.hidden = !canDraft;

    $('#sheetBackdrop').hidden = false;
    modal.hidden = false;
    $('#noteClose').focus();
  }

  function addFact(host, label, value) {
    if (value == null || value === '') return;
    var f = el('span', 'note-fact');
    f.appendChild(el('span', 'nf-label', label));
    f.appendChild(el('span', 'nf-value', String(value)));
    host.appendChild(f);
  }

  function closeNotes() {
    $('#noteModal').hidden = true;
    // The draft sheet shares this backdrop; only clear it if nothing else is up.
    if (!UI.sheetIsOpen()) $('#sheetBackdrop').hidden = true;
  }

  function notesAreOpen() { return !$('#noteModal').hidden; }

  // A missing ADP gets no colour at all. It is not a good value and it is not
  // a bad one — the same rule the sort follows.
  function tint(cell, pct) {
    var c = heatColor(pct);
    if (!c) return;
    cell.style.color = c;
    cell.style.fontWeight = '700';
  }

  /* ------------------------------------------------------- hold-to-draft */

  var HOLD_MS = 1500;      // full press duration before the pick commits
  var MOVE_CANCEL_PX = 12; // treat as a scroll, not a press
  var HOLD_POP_GAP = 62;   // clearance from the press point, so a thumb cannot
                           // cover the popup or its progress bar

  var hold = null;

  function attachHold(li, p, team) {
    li.addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      // The notes and injury buttons live inside the row; pressing either
      // must never begin a draft, however long the press is held.
      if (ev.target.closest && ev.target.closest('.p-infobtn, .q-btn')) return;
      startHold(ev, li, p, team);
    });
    // Keyboard users get the team chooser, which is fully operable.
    li.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openPlayerSheet(p);
      }
    });
  }

  function startHold(ev, li, p, team) {
    cancelHold();
    hold = {
      player: p,
      team: team,
      li: li,
      startX: ev.clientX,
      startY: ev.clientY,
      start: 0,
      raf: 0,
      halfway: false,
      done: false
    };
    li.classList.add('is-holding');
    showHoldPop(p, team, ev.clientX, ev.clientY);
    buzz(8);

    global.addEventListener('pointermove', onHoldMove, { passive: true });
    global.addEventListener('pointerup', onHoldEnd);
    global.addEventListener('pointercancel', onHoldAbort);
    global.addEventListener('scroll', onHoldAbort, { passive: true });
    global.addEventListener('contextmenu', onContextMenu);

    hold.raf = global.requestAnimationFrame(stepHold);
  }

  function stepHold(ts) {
    if (!hold) return;
    if (!hold.start) hold.start = ts;
    var pct = Math.min(1, (ts - hold.start) / HOLD_MS);
    $('#holdPopBar').style.width = (pct * 100).toFixed(1) + '%';

    // Three beats through the press: 0ms, halfway, and a double at the commit.
    if (!hold.halfway && pct >= 0.5) {
      hold.halfway = true;
      buzz(12);
    }

    if (pct >= 1) {
      var p = hold.player, team = hold.team;
      hold.done = true;
      buzz([18, 40, 18]);
      cancelHold();
      draftPlayer(p.id, team.id);
      return;
    }
    hold.raf = global.requestAnimationFrame(stepHold);
  }

  function onHoldMove(ev) {
    if (!hold) return;
    if (Math.abs(ev.clientX - hold.startX) > MOVE_CANCEL_PX ||
        Math.abs(ev.clientY - hold.startY) > MOVE_CANCEL_PX) {
      cancelHold();
    }
  }

  // Releasing early is a plain tap: open the team chooser instead.
  function onHoldEnd() {
    if (!hold || hold.done) return;
    var p = hold.player;
    cancelHold();
    openPlayerSheet(p);
  }

  function onHoldAbort() { cancelHold(); }

  function onContextMenu(ev) { if (hold) ev.preventDefault(); }

  function cancelHold() {
    if (!hold) return;
    if (hold.raf) global.cancelAnimationFrame(hold.raf);
    hold.li.classList.remove('is-holding');
    hold = null;
    hideHoldPop();
    global.removeEventListener('pointermove', onHoldMove);
    global.removeEventListener('pointerup', onHoldEnd);
    global.removeEventListener('pointercancel', onHoldAbort);
    global.removeEventListener('scroll', onHoldAbort);
    global.removeEventListener('contextmenu', onContextMenu);
  }

  function showHoldPop(p, team, x, y) {
    var pop = $('#holdPop');
    $('#holdPopPlayer').textContent = p.name;
    $('#holdPopTeam').textContent = team.name;
    $('#holdPopBar').style.width = '0%';
    pop.hidden = false;

    // Prefer above the finger; drop below if there is no room; and if the panel
    // is too tall for either, clamp it into the viewport and drop the tail,
    // which would otherwise point at nothing.
    var w = pop.offsetWidth, h = pop.offsetHeight, pad = 8;
    var maxTop = global.innerHeight - h - pad;
    var left = Math.min(Math.max(x, w / 2 + pad), global.innerWidth - w / 2 - pad);

    var top = y - h - HOLD_POP_GAP;
    var below = top < pad;
    if (below) top = y + HOLD_POP_GAP;

    var clamped = top > maxTop || top < pad;
    if (clamped) top = Math.max(pad, Math.min(top, maxTop));

    pop.classList.toggle('is-below', below);
    pop.classList.toggle('is-clamped', clamped);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function hideHoldPop() {
    $('#holdPop').hidden = true;
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (err) { /* not supported */ }
    }
  }

  function openPlayerSheet(p) {
    var owners = Draft.ownerMap(state);
    var ownerId = owners[p.id];
    var c = Draft.clock(state);
    var sub = p.position + ' · ' + p.team + ' · Tier ' + p.tier +
      ' · ADP ' + formatAdp(p.adp) + ' · ' + num(p.vorp) + ' VORP · ' +
      num(p.points) + ' pts';

    UI.openSheet(p.name, sub, function (body) {
      var hurt = injuryFor(p.id);
      if (hurt) body.appendChild(buildInjuryBox(hurt));

      // Offered for anyone still available, whatever else the sheet shows —
      // queueing is planning, and it is useful before setup is even finished.
      if (ownerId == null) {
        var at = queued(p.id);
        var q = el('button', 'btn btn-queue' + (at !== -1 ? ' is-on' : ''),
          at !== -1 ? '\u2605 In your queue (' + (at + 1) + ') · tap to remove'
                    : '\u2606 Add to queue');
        q.type = 'button';
        q.addEventListener('click', function () {
          UI.closeSheet();
          var added = toggleQueue(p.id);
          UI.showToast(added
            ? p.name + ' queued at ' + state.queue.length + '.'
            : p.name + ' removed from the queue.');
        });
        body.appendChild(q);
      }

      if (ownerId != null) {
        body.appendChild(el('div', 'sheet-section-label',
          (state.keepers[p.id] != null ? 'Keeper for' : 'Drafted by')));
        body.appendChild(el('div', 'p-name', state.teams[ownerId].name));
        var rel = el('button', 'btn btn-danger', 'Remove from ' + state.teams[ownerId].name);
        rel.type = 'button';
        rel.style.marginTop = '12px';
        rel.addEventListener('click', function () {
          UI.closeSheet();
          releasePlayer(p.id);
        });
        body.appendChild(rel);
        return;
      }

      if (!state.setupDone) {
        body.appendChild(el('p', 'sheet-warn', 'Finish setup before drafting.'));
        return;
      }
      if (c.complete) {
        body.appendChild(el('p', 'sheet-warn', 'The draft is complete.'));
        return;
      }

      var primary = el('button', 'btn btn-primary',
        'Draft to ' + c.onClockTeam.name + ' · ' + label(c.currentPick));
      primary.type = 'button';
      primary.addEventListener('click', function () {
        UI.closeSheet();
        draftPlayer(p.id, c.onClockTeam.id);
      });
      body.appendChild(primary);

      body.appendChild(el('div', 'sheet-section-label', 'Or assign to another team'));
      var grid = el('div', 'teamgrid');
      state.teams.forEach(function (t) {
        var counts = Draft.rosterCounts(state, t.id, playersById);
        var full = counts[p.position] >= LEAGUE.slots[p.position];
        var b = el('button', 'tgbtn' +
          (t.id === c.onClockTeam.id ? ' is-onclock' : '') +
          (t.slot === state.mySlot ? ' is-mine' : '') +
          (full ? ' is-full' : ''));
        b.type = 'button';
        b.appendChild(el('span', null, t.name));
        b.appendChild(el('span', 'tg-sub',
          p.position + ' ' + counts[p.position] + '/' + LEAGUE.slots[p.position]));
        b.addEventListener('click', function () {
          UI.closeSheet();
          draftPlayer(p.id, t.id);
        });
        grid.appendChild(b);
      });
      body.appendChild(grid);

      var onClockCounts = Draft.rosterCounts(state, c.onClockTeam.id, playersById);
      if (onClockCounts[p.position] >= LEAGUE.slots[p.position]) {
        body.appendChild(el('p', 'sheet-warn',
          c.onClockTeam.name + ' already has ' + onClockCounts[p.position] + ' ' +
          p.position + ' (limit ' + LEAGUE.slots[p.position] + ').'));
      }
    });
  }

  /* ----------------------------------------------------------- teams view */

  function rostersByTeam(board) {
    var out = {};
    state.teams.forEach(function (t) { out[t.id] = []; });
    for (var id in board.owners) {
      var p = playersById[id];
      if (p) out[board.owners[id]].push(p);
    }
    return out;
  }

  function renderTeams(board) {
    var rosters = rostersByTeam(board);
    var host = $('#teamList');
    var frag = document.createDocumentFragment();

    // Your team is pinned to the top; everyone else ranks by effective total,
    // so the card order is the standings. Draft slot breaks ties so the order
    // stays stable before anyone has scored.
    var cards = state.teams.map(function (t) {
      var roster = rosters[t.id];
      return { team: t, roster: roster, score: Draft.scoreRoster(roster) };
    });
    cards.sort(function (a, b) {
      var am = a.team.slot === state.mySlot, bm = b.team.slot === state.mySlot;
      if (am !== bm) return am ? -1 : 1;
      return (b.score.effective - a.score.effective) || (a.team.slot - b.team.slot);
    });

    cards.forEach(function (entry) {
      var t = entry.team;
      var roster = entry.roster;
      var score = entry.score;
      var isMine = t.slot === state.mySlot;

      var card = el('div', 'teamcard' + (isMine ? ' is-mine' : ''));

      var head = el('button', 'tc-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', view.expandedTeams[t.id] ? 'true' : 'false');

      var left = el('div');
      var nameLine = el('div', 'tc-name');
      nameLine.appendChild(el('span', 'slot', String(t.slot)));
      nameLine.appendChild(document.createTextNode(t.name));
      if (isMine) nameLine.appendChild(el('span', 'me-tag', 'YOU'));
      left.appendChild(nameLine);

      var counts = el('div', 'tc-counts');
      ['F', 'D', 'G'].forEach(function (pos) {
        var n = score.counts[pos];
        var lim = LEAGUE.slots[pos];
        counts.appendChild(el('span', 'c-' + pos + (n >= lim ? ' is-full' : ''),
          pos + ' ' + n + '/' + lim));
      });
      counts.appendChild(el('span', null, roster.length + '/' + LEAGUE.rosterSize));
      left.appendChild(counts);
      head.appendChild(left);

      var right = el('div', 'tc-score');
      right.appendChild(el('div', 'tc-eff', num(score.effective)));
      right.appendChild(el('div', 'tc-raw', 'raw ' + num(score.raw)));
      head.appendChild(right);

      head.addEventListener('click', function () {
        view.expandedTeams[t.id] = !view.expandedTeams[t.id];
        renderTeams(buildBoard());
      });
      card.appendChild(head);

      if (view.expandedTeams[t.id]) {
        card.appendChild(buildRosterBody(roster, score));
      }
      frag.appendChild(card);
    });

    host.innerHTML = '';
    host.appendChild(frag);
  }

  function buildRosterBody(roster, score) {
    var body = el('div', 'tc-body');
    if (!roster.length) {
      body.appendChild(el('div', 'tc-empty', 'No players yet.'));
      return body;
    }
    var order = { F: 0, D: 1, G: 2 };
    roster.slice().sort(function (a, b) {
      return (order[a.position] - order[b.position]) || (b.points - a.points);
    }).forEach(function (p) {
      var counting = !!score.countingIds[p.id];
      var row = el('div', 'rrow pos-' + p.position + (counting ? '' : ' is-bench'));
      row.appendChild(el('span', 'r-pos', p.position));
      row.appendChild(el('span', 'r-name', p.name));
      row.appendChild(el('span', 'r-tag' + (p.custom ? ' is-custom' : ''),
        state.keepers[p.id] != null ? 'K' : (p.custom ? '+' : '')));
      row.appendChild(el('span', 'r-pts', num(p.points)));
      body.appendChild(row);
    });
    return body;
  }

  /* ----------------------------------------------------------- setup view */

  function renderSetup(board) {
    renderTeamSetup();
    renderKeeperSetup(board);
    renderLeagueLine();
    renderTrades();
    renderNotesStatus();
    renderInjuryStatus();
  }

  function renderTeamSetup() {
    var host = $('#teamSetup');
    if (host.dataset.built === '1') {
      // Rebuilding on every keystroke would steal focus from the inputs.
      $$('.tsrow', host).forEach(function (row) {
        var id = Number(row.dataset.teamId);
        row.classList.toggle('is-mine', state.teams[id].slot === state.mySlot);
        $('input[type=radio]', row).checked = state.teams[id].slot === state.mySlot;
      });
      return;
    }

    var frag = document.createDocumentFragment();
    state.teams.forEach(function (t) {
      var row = el('li', 'tsrow' + (t.slot === state.mySlot ? ' is-mine' : ''));
      row.dataset.teamId = String(t.id);
      row.appendChild(el('span', 'ts-slot', String(t.slot)));

      var input = el('input');
      input.type = 'text';
      input.value = t.name;
      input.setAttribute('aria-label', 'Team in slot ' + t.slot);
      input.addEventListener('input', function () {
        state.teams[t.id].name = input.value.trim() || ('Team ' + t.slot);
        saveState();
        renderTopbar(buildBoard());
      });
      row.appendChild(input);

      var mine = el('label', 'ts-me');
      var radio = el('input');
      radio.type = 'radio';
      radio.name = 'myslot';
      radio.checked = t.slot === state.mySlot;
      radio.setAttribute('aria-label', 'I am ' + t.name);
      radio.addEventListener('change', function () {
        state.mySlot = t.slot;
        saveState();
        render();
      });
      mine.appendChild(radio);
      row.appendChild(mine);

      var drop = el('button', 'ts-drop', '\u00d7');
      drop.type = 'button';
      drop.setAttribute('aria-label', 'Remove ' + t.name + ' from the draft');
      drop.title = 'Remove ' + t.name;
      drop.addEventListener('click', function () { dropTeam(t.id); });
      row.appendChild(drop);

      frag.appendChild(row);
    });
    host.innerHTML = '';
    host.appendChild(frag);
    host.dataset.built = '1';
    syncTeamCount();
  }

  // The count is only editable before the draft starts: every existing pick was
  // made under a snake order that renumbering would invalidate, so 2.03 would
  // quietly become a different pick.
  function teamsLocked() { return state.picks.length > 0; }

  function syncTeamCount() {
    var locked = teamsLocked();
    var n = state.teams.length;
    $$('.ts-drop').forEach(function (b) {
      b.disabled = locked || n <= LEAGUE.minTeams;
    });
    $('#addTeamBtn').disabled = locked || n >= LEAGUE.maxTeams;
    $('#teamCountNote').textContent = locked
      ? n + ' teams · clear the picks to change this'
      : n + ' teams · ' + Draft.totalPicks(state) + ' picks over ' +
        LEAGUE.draftRounds + ' rounds';
  }

  function dropTeam(teamId) {
    var team = state.teams[teamId];
    if (!team) return;

    var res = Draft.removeTeam(state, teamId);
    if (!res.ok) {
      UI.showToast(
        res.why === 'picks' ? 'Clear the picks before changing the teams.'
        : res.why === 'mine' ? 'That is your own team — move your slot first.'
        : res.why === 'min' ? 'A draft needs at least ' + LEAGUE.minTeams + ' teams.'
        : 'Could not remove that team.');
      return;
    }

    afterTeamChange();
    UI.showToast('Removed ' + res.removed + '.' +
      (res.released ? ' ' + res.released + ' keeper' + (res.released === 1 ? '' : 's') +
        ' back in the pool.' : '') +
      ' Now ' + state.teams.length + ' teams.' + tradesClearedNote(res.tradesCleared));
  }

  function addTeamRow() {
    var res = Draft.addTeam(state);
    if (!res.ok) {
      UI.showToast(res.why === 'picks' ? 'Clear the picks before changing the teams.'
        : 'A draft tops out at ' + LEAGUE.maxTeams + ' teams.');
      return;
    }
    afterTeamChange();
    UI.showToast('Added ' + res.added + '. Now ' + state.teams.length + ' teams.' +
      tradesClearedNote(res.tradesCleared));
  }

  // Traded picks are numbers in a snake of one width; a new width moves every
  // one of them to a different pick, so they are cleared rather than kept wrong.
  function tradesClearedNote(n) {
    return n ? ' ' + n + ' traded pick' + (n === 1 ? '' : 's') +
      ' cleared — the pick numbers no longer line up.' : '';
  }

  // Team ids shift, so anything holding one has to be rebuilt rather than
  // patched: the setup list, the keeper panel's selected team, and the board.
  function afterTeamChange() {
    if (view.keeperTeam >= state.teams.length) view.keeperTeam = 0;
    view.expandedTeams = {};
    view.lastPick = null;
    saveState();
    $('#teamSetup').dataset.built = '';
    render();
  }

  function renderKeeperSetup(board) {
    $('#keeperCounter').textContent = Draft.keeperCount(state) + ' / ' + nKeepers();

    var picker = $('#keeperTeamPicker');
    picker.innerHTML = '';
    state.teams.forEach(function (t) {
      var n = Draft.keepersForTeam(state, t.id).length;
      var b = el('button', 'ktbtn' +
        (t.id === view.keeperTeam ? ' is-sel' : '') +
        (n >= LEAGUE.keepersPerTeam ? ' is-full' : ''));
      b.type = 'button';
      b.appendChild(el('span', null, t.name));
      b.appendChild(el('span', 'kt-n', n + '/' + LEAGUE.keepersPerTeam));
      b.addEventListener('click', function () {
        view.keeperTeam = t.id;
        renderKeeperSetup(buildBoard());
      });
      picker.appendChild(b);
    });

    var panel = $('#keeperPanel');
    panel.innerHTML = '';

    var teamId = view.keeperTeam;
    var held = Draft.keepersForTeam(state, teamId);

    var slots = el('div', 'kp-slots');
    for (var i = 0; i < LEAGUE.keepersPerTeam; i++) {
      var pid = held[i];
      var slot = el('div', 'kp-slot' + (pid ? ' is-filled' : ''));
      if (pid) {
        var p = playersById[pid];
        slot.appendChild(el('span', null, p.name + '  ·  ' + p.position + ' ' + p.team +
          '  ·  ' + num(p.points) + ' pts'));
        var x = el('button', 'kp-x', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Remove ' + p.name);
        (function (id) {
          x.addEventListener('click', function () {
            delete state.keepers[id];
            saveState();
            render();
          });
        })(pid);
        slot.appendChild(x);
      } else {
        slot.appendChild(el('span', 'kp-empty', 'Empty keeper slot'));
        slot.appendChild(el('span', null, ''));
      }
      slots.appendChild(slot);
    }
    panel.appendChild(slots);

    if (held.length >= LEAGUE.keepersPerTeam) return;

    var search = el('input', 'kp-search');
    search.type = 'search';
    search.placeholder = 'Search a keeper for ' + state.teams[teamId].name + '…';
    search.value = view.keeperSearch;
    search.autocomplete = 'off';
    search.addEventListener('input', function () {
      view.keeperSearch = search.value;
      renderKeeperResults(results, buildBoard());
    });
    panel.appendChild(search);

    var results = el('ul', 'kp-results');
    panel.appendChild(results);
    renderKeeperResults(results, board);
  }

  function renderKeeperResults(host, board) {
    host.innerHTML = '';
    var q = normalize(view.keeperSearch);
    var matches = players.filter(function (p) {
      if (board.owners[p.id] != null) return false;
      return !q || searchKeys[p.id].indexOf(q) !== -1;
    });
    matches.sort(canonicalCompare);
    matches.slice(0, q ? 25 : 12).forEach(function (p) {
      var li = el('li');
      var b = el('button', 'kp-result pos-' + p.position);
      b.type = 'button';
      var left = el('span');
      left.appendChild(el('span', 'p-name', p.name));
      left.appendChild(el('span', 'kr-sub', p.position + ' · ' + p.team + ' · Tier ' + p.tier));
      b.appendChild(left);
      b.appendChild(el('span', 'kr-pts', num(p.points)));
      b.addEventListener('click', function () {
        // Clear before assigning: assignKeeper re-renders this panel, and the
        // rebuilt input reads view.keeperSearch, so clearing afterwards would
        // be overwritten by the value that was just on screen.
        var previous = view.keeperSearch;
        view.keeperSearch = '';
        if (assignKeeper(p.id, view.keeperTeam)) {
          focusKeeperSearch();
        } else {
          view.keeperSearch = previous;
        }
      });
      li.appendChild(b);
      host.appendChild(li);
    });
    if (!matches.length) {
      host.appendChild(el('li', 'tc-empty', 'No available players match.'));
    }
  }

  // Puts the cursor back in the box so 42 keepers can be entered without
  // reaching for the field between each one. Absent once a team is full.
  function focusKeeperSearch() {
    var input = $('.kp-search');
    if (input) input.focus();
  }

  function renderLeagueLine() {
    var me = Draft.myTeam(state);
    var kc = Draft.keeperCount(state);
    var trades = Draft.tradedPicks(state).length;
    var line = $('#leagueLine');
    line.innerHTML = '';
    line.appendChild(document.createTextNode(nTeams() + ' teams · ' +
      (me ? me.name + ' picks ' + ordinal(me.slot) : 'no team marked as yours') + ' · '));
    line.appendChild(el('span', kc === nKeepers() ? 'ok' : 'warn',
      kc + '/' + nKeepers() + ' keepers'));
    line.appendChild(document.createTextNode(' · ' + trades + ' traded pick' +
      (trades === 1 ? '' : 's') + ' · ' + nPicks() + ' picks'));
  }

  function renderTrades() {
    var trades = Draft.tradedPicks(state);
    $('#tradeCounter').textContent = String(trades.length);
    var host = $('#tradeList');
    host.innerHTML = '';
    if (!trades.length) {
      host.appendChild(el('li', 'tc-empty', 'No traded picks — every pick follows the snake.'));
      return;
    }
    trades.forEach(function (t) {
      var li = el('li', 'traderow' + (t.to.slot === state.mySlot || t.from.slot === state.mySlot ? ' is-mine' : ''));
      li.appendChild(el('span', 'tr-pick', label(t.n)));
      li.appendChild(el('span', 'tr-n', '#' + t.n));
      li.appendChild(el('span', 'tr-to', t.to.name));
      li.appendChild(el('span', 'tr-from', 'from ' + t.from.name));
      host.appendChild(li);
    });
  }

  /* ---------------------------------------------------------- start panel
     Starting is the first thing on Setup and, until a draft is running, on
     the board as well — two big buttons, live and mock, each saying where that
     draft stands. The other draft is read straight from storage (never
     written), so both buttons are accurate whichever mode is active. */

  function draftStatus(s) {
    var total = Draft.totalPicks(s);
    var made = s.picks.length;
    return {
      made: made,
      total: total,
      complete: made >= total,
      started: made > 0 || !!s.setupDone,
      next: made < total ? Draft.pickLabel(made + 1, s.teams.length) : null
    };
  }

  function buildStartButton(kind, title, sub, current, onGo) {
    var b = el('button', 'startbtn startbtn-' + kind + (current ? ' is-current' : ''));
    b.type = 'button';
    var head = el('span', 'sb-title', title);
    if (current) head.appendChild(el('span', 'sb-tag', 'Active'));
    b.appendChild(head);
    b.appendChild(el('span', 'sb-sub', sub));
    b.addEventListener('click', onGo);
    return b;
  }

  function renderStart() {
    var live = isMock() ? Draft.load(Draft.STORAGE_KEY) : state;
    var mk = isMock() ? state : Draft.load(Draft.MOCK_STORAGE_KEY);
    var ls = draftStatus(live), ms = draftStatus(mk);
    var bots = nTeams() - 1;

    var liveTitle = ls.complete ? 'Live draft complete'
      : ls.made ? 'Resume live draft'
      : ls.started ? 'Back to live draft' : 'Start live draft';
    var liveSub = ls.made
      ? (ls.complete ? 'All ' + ls.total + ' picks in' : 'Pick ' + ls.next + ' · ' + ls.made + ' of ' + ls.total + ' made')
      : 'The real one · you pick ' + ordinal(live.mySlot) + ' · you enter every pick';

    var mockLive = ms.made && !ms.complete;
    var mockTitle = mockLive ? 'Resume mock draft'
      : ms.complete ? 'Start a new mock' : 'Start a mock draft';
    var mockSub = mockLive
      ? 'Pick ' + ms.next + ' · ' + ms.made + ' of ' + ms.total + ' made'
      : (ms.complete ? 'Last one finished · ' : '') +
        'Practice against ' + bots + ' bots · starts drafting right away';

    $$('[data-start-host]').forEach(function (host) {
      host.innerHTML = '';
      host.appendChild(buildStartButton('live', liveTitle, liveSub,
        !isMock() && state.setupDone, startLive));
      host.appendChild(buildStartButton('mock', mockTitle, mockSub,
        isMock() && state.setupDone, startMock));
    });

    $('#boardStart').hidden = state.setupDone;
    $('#mockActions').hidden = !isMock();
  }

  function startLive() {
    setMode('live');
    state.setupDone = true;
    saveState();
    setTab('board');
  }

  // Resumes a mock in progress; otherwise starts a fresh one from the live
  // league and sets the clock going, since starting is what he just asked for.
  function startMock() {
    var existing = isMock() ? state : Draft.load(Draft.MOCK_STORAGE_KEY);
    var st = draftStatus(existing);
    var fresh = !st.made || st.complete;
    setMode('mock', fresh ? { force: true, fresh: true } : null);
    state.setupDone = true;
    saveState();
    setTab('board');
    if (!state.picks.length && !Draft.clock(state).onClockIsMe) mock.resume();
  }

  /* ---------------------------------------------------------------- events */

  function setTab(name) {
    view.tab = name;
    $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + name); });
    render();
    global.scrollTo(0, 0);
  }

  function wire() {
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });

    $('#undoBtn').addEventListener('click', undoLastPick);
    $('#addPickBtn').addEventListener('click', openAddPickSheet);

    var search = $('#search');
    search.addEventListener('input', function () {
      view.search = normalize(search.value);
      $('#searchClear').hidden = !search.value;
      renderBoard(buildBoard());
    });
    $('#searchClear').addEventListener('click', function () {
      search.value = '';
      view.search = '';
      $('#searchClear').hidden = true;
      renderBoard(buildBoard());
      search.focus();
    });

    $$('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        // A radio, so a tap always selects — there is no way to end up with an
        // empty board, and no guard is needed against one.
        if (chip.dataset.pos === 'QUEUE' && !(state.queue || []).length) {
          UI.showToast('Your queue is empty — tap a player, then Add to queue.');
          return;
        }
        view.position = chip.dataset.pos;
        syncChips();
        renderBoard(buildBoard());
      });
    });

    $$('.lh-sort').forEach(function (btn) {
      btn.addEventListener('click', function () { sortBy(btn.dataset.sort); });
    });

    $('#showDrafted').addEventListener('change', function () {
      view.showDrafted = $('#showDrafted').checked;
      renderBoard(buildBoard());
    });

    $('#sheetClose').addEventListener('click', UI.closeSheet);
    $('#sheetBackdrop').addEventListener('click', function () {
      if (notesAreOpen()) closeNotes();
      else UI.closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (notesAreOpen()) closeNotes();
      else if (UI.sheetIsOpen()) UI.closeSheet();
    });

    $('#updateBtn').addEventListener('click', checkForUpdate);
    $('#exportBtn').addEventListener('click', exportState);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', importState);

    $('#resetBtn').addEventListener('click', openResetSheet);
    $('#addTeamBtn').addEventListener('click', addTeamRow);

    $('#notesImportBtn').addEventListener('click', function () { $('#notesFile').click(); });
    $('#notesFile').addEventListener('change', importNotes);
    $('#notesClearBtn').addEventListener('click', clearNotes);
    $('#noteClose').addEventListener('click', closeNotes);
  }

  /* ----------------------------------------------------------------- reset */

  // Three scopes, narrowest first, because re-running a sim is the common case
  // and re-entering 42 keepers is the expensive one. Player projections live in
  // data/players.json and are never written by the app, so no scope touches them.
  function resetPicksOnly() {
    var n = state.picks.length;
    // Hand-entered players exist only through their pick, so they go with it.
    state.customPlayers.forEach(function (p) { delete playersById[p.id]; });
    state.customPlayers = [];
    state.picks = [];
    state.queue = [];
    view.lastPick = null;
    saveState();
    render();
    UI.showToast('Cleared ' + n + ' pick' + (n === 1 ? '' : 's') + '. Keepers and teams kept.');
  }

  function resetToSetup() {
    var n = state.picks.length;
    state.customPlayers.forEach(function (p) { delete playersById[p.id]; });
    state.customPlayers = [];
    state.picks = [];
    state.queue = [];
    view.lastPick = null;
    state.setupDone = false;
    saveState();
    setTab('setup');
    UI.showToast('Draft cancelled — ' + n + ' pick' + (n === 1 ? '' : 's') +
      ' cleared. Keepers and teams kept.');
  }

  function resetEverything() {
    state.customPlayers.forEach(function (p) { delete playersById[p.id]; });
    // "Defaults" are the real 2026 league — order, keepers and traded picks.
    state = Draft.freshState();
    view.lastPick = null;
    saveState();
    $('#teamSetup').dataset.built = '';
    view.keeperTeam = 0;
    view.keeperSearch = '';
    view.expandedTeams = {};
    setTab('setup');
    UI.showToast('Reset to the 2026 league — real keepers and traded picks reloaded.');
  }

  function openAddPickSheet() {
    var c = Draft.clock(state);
    if (!state.setupDone || c.complete) return;

    UI.openSheet('Off-board pick', 'For a player who is not in the rankings.', function (body) {
      var form = el('div', 'addform');

      var posRow = el('label', 'addfield');
      posRow.appendChild(el('span', 'addfield-label', 'Position'));
      var pos = el('select', 'addfield-input');
      [['F', 'Forward'], ['D', 'Defence'], ['G', 'Goalie']].forEach(function (o) {
        var opt = el('option', null, o[1]);
        opt.value = o[0];
        pos.appendChild(opt);
      });
      posRow.appendChild(pos);
      form.appendChild(posRow);

      var nameRow = el('label', 'addfield');
      nameRow.appendChild(el('span', 'addfield-label', 'Name'));
      var name = el('input', 'addfield-input');
      name.type = 'text';
      name.placeholder = 'Player name';
      name.autocomplete = 'off';
      name.autocapitalize = 'words';
      nameRow.appendChild(name);
      form.appendChild(nameRow);

      var ptsRow = el('label', 'addfield');
      ptsRow.appendChild(el('span', 'addfield-label', 'Projected points'));
      var pts = el('input', 'addfield-input');
      pts.type = 'number';
      pts.inputMode = 'decimal';
      pts.step = '1';
      pts.min = '0';
      pts.value = String(DEFAULT_CUSTOM_POINTS);
      ptsRow.appendChild(pts);
      form.appendChild(ptsRow);

      body.appendChild(form);

      var warn = el('p', 'sheet-warn');
      warn.hidden = true;
      body.appendChild(warn);

      var go = el('button', 'btn btn-primary',
        'Draft to ' + c.onClockTeam.name + ' · ' + label(c.currentPick));
      go.type = 'button';
      go.style.marginTop = '12px';
      go.addEventListener('click', function () {
        submitAddPick(name.value, pos.value, pts.value, c.onClockTeam, warn);
      });
      body.appendChild(go);

      name.focus();
    });
  }

  function submitAddPick(rawName, position, rawPoints, team, warn) {
    var name = String(rawName).trim().replace(/\s+/g, ' ');
    var points = parseFloat(rawPoints);

    function reject(msg) {
      warn.textContent = msg;
      warn.hidden = false;
    }

    if (!name) return reject('Give the player a name.');
    if (!isFinite(points) || points < 0) return reject('Projected points must be a number of 0 or more.');

    // If the name is already in the rankings, use that player rather than
    // creating a second entry for the same person.
    var key = normalize(name);
    var existing = null;
    for (var i = 0; i < players.length; i++) {
      if (normalize(players[i].name) === key) { existing = players[i]; break; }
    }
    if (existing) {
      var owner = Draft.ownerMap(state)[existing.id];
      if (owner != null) {
        return reject(existing.name + ' is already on ' + state.teams[owner].name + "'s roster.");
      }
      UI.closeSheet();
      draftPlayer(existing.id, team.id);
      UI.showToast(existing.name + ' was already in the rankings — drafted from the board.');
      return;
    }

    var player = {
      id: customId(name),
      name: name,
      position: position,
      team: '—',
      tier: null,
      vorp: null,
      points: points,
      adp: null,
      custom: true
    };
    state.customPlayers.push(player);
    playersById[player.id] = player;

    UI.closeSheet();
    draftPlayer(player.id, team.id);
  }

  function openResetSheet() {
    var picks = state.picks.length;
    var keepers = Draft.keeperCount(state);

    UI.openSheet('Reset', 'Player names, tiers, VORP and projected points are never changed.', function (body) {
      var options = [
        {
          title: 'Clear picks only',
          detail: 'Removes ' + picks + ' draft pick' + (picks === 1 ? '' : 's') +
            '. Keeps all ' + keepers + ' keepers, team names, and stays on the board — ' +
            'ready to redraft immediately.',
          label: 'Clear picks',
          run: resetPicksOnly
        },
        {
          title: 'Cancel the current draft',
          detail: 'Clears the ' + picks + ' pick' + (picks === 1 ? '' : 's') +
            ' and returns to setup so you can change keepers or team names before ' +
            'starting again.',
          label: 'Cancel draft',
          run: resetToSetup
        },
        {
          title: 'Clear everything',
          detail: 'Wipes picks, all ' + keepers + ' keepers, and resets team names to the ' +
            'default draft order. Nothing but the player pool survives.',
          label: 'Clear everything',
          run: resetEverything,
          confirm: true
        }
      ];

      options.forEach(function (opt) {
        var card = el('div', 'resetopt' + (opt.confirm ? ' is-severe' : ''));
        card.appendChild(el('div', 'resetopt-title', opt.title));
        card.appendChild(el('div', 'resetopt-detail', opt.detail));

        var btn = el('button', 'btn btn-danger', opt.label);
        btn.type = 'button';
        var armed = false;
        btn.addEventListener('click', function () {
          // The destructive scope asks twice; the sim-friendly ones do not.
          if (opt.confirm && !armed) {
            armed = true;
            btn.textContent = 'Tap again to confirm';
            btn.classList.add('is-armed');
            return;
          }
          UI.closeSheet();
          opt.run();
        });
        card.appendChild(btn);
        body.appendChild(card);
      });

      var cancel = el('button', 'btn', 'Cancel');
      cancel.type = 'button';
      cancel.style.marginTop = '4px';
      cancel.addEventListener('click', UI.closeSheet);
      body.appendChild(cancel);
    });
  }

  function syncChips() {
    $$('.chip').forEach(function (chip) {
      var on = chip.dataset.pos === view.position;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var n = (state.queue || []).length;
    var qc = $('#queueCount');
    if (qc) qc.textContent = n ? String(n) : '';
    var chip = $('.chip-queue');
    if (chip) {
      chip.classList.toggle('is-empty', n === 0);
      chip.setAttribute('aria-label', n ? 'Show your queue of ' + n : 'Your queue is empty');
    }
  }

  /* ------------------------------------------------------------ app update */

  // Clearing caches while offline would take the app's offline copy with it, so
  // the network is confirmed before anything is thrown away, and the remote
  // version is read first so a pointless reload is avoided.
  function checkForUpdate() {
    var btn = $('#updateBtn');
    var reset = function (label) {
      btn.disabled = false;
      btn.textContent = label || 'Check for update';
    };

    if (global.navigator && global.navigator.onLine === false) {
      UI.showToast("You're offline — the cached version stays put.");
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Checking…';

    fetch('./sw.js?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var m = text.match(/CACHE_VERSION\s*=\s*'v?([^']+)'/);
        var remote = m ? m[1] : null;
        if (remote && remote === APP_VERSION) {
          reset();
          UI.showToast('Already up to date (v' + APP_VERSION + ').');
          return null;
        }
        btn.textContent = 'Updating to v' + (remote || '?') + '…';
        return applyUpdate();
      })
      .catch(function (err) {
        console.warn('Update check failed', err);
        reset();
        UI.showToast('Could not reach the server. Still on v' + APP_VERSION + '.');
      });
  }

  // Drop every cache and the worker itself, so the next load fetches a clean
  // copy and re-precaches it. Draft state is in localStorage and is untouched.
  function applyUpdate() {
    var step = global.caches
      ? global.caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return global.caches.delete(k); }));
        })
      : Promise.resolve();

    return step
      .then(function () {
        if (!navigator.serviceWorker) return null;
        return navigator.serviceWorker.getRegistration();
      })
      .then(function (reg) { return reg ? reg.unregister() : null; })
      .catch(function (err) { console.warn('Update cleanup failed', err); })
      .then(function () { global.location.reload(); });
  }

  var BACKUP_KIND = 'hockeydraft26.backup';

  function isDraftState(s) {
    return !!s && s.v === 1 && Array.isArray(s.teams) &&
      s.teams.length >= LEAGUE.minTeams && s.teams.length <= LEAGUE.maxTeams;
  }

  // Everything that would be painful to recreate, in one file: both drafts and
  // the notes. The active draft is written to storage first, so an export taken
  // mid-draft includes the pick that just landed rather than the last save.
  function buildBackup() {
    saveState();
    return {
      v: 1,
      kind: BACKUP_KIND,
      app: APP_VERSION,
      exported: new Date().toISOString(),
      live: Draft.load(Draft.STORAGE_KEY),
      mock: Draft.load(Draft.MOCK_STORAGE_KEY),
      notes: notes
    };
  }

  function exportState() {
    var backup = buildBackup();
    // Dated, so successive backups sit beside each other instead of the newest
    // silently replacing the one that was actually good.
    var stamp = backup.exported.slice(0, 16).replace(/[:T]/g, '-');
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = 'hockeydraft26-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    var kept = notesCoverage();
    UI.showToast('Backed up ' + backup.live.picks.length + ' live picks, ' +
      Draft.keeperCount(backup.live) + ' keepers and ' + kept +
      ' player note' + (kept === 1 ? '' : 's') + '.');
  }

  // Validated the same way a saved draft is on boot: ids the pool does not
  // carry are dropped and counted, never silently absorbed.
  function importNotes(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var incoming = parsed && parsed.notes;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          throw new Error('Not a notes file');
        }

        var kept = {}, matched = 0, dropped = 0;
        for (var id in incoming) {
          if (playersById[id]) { kept[id] = incoming[id]; matched++; }
          else dropped++;
        }

        notes = kept;
        saveNotes(notes);
        render();

        var msg = 'Imported notes for ' + matched + ' of ' + players.length + ' players.';
        if (dropped) msg += ' ' + dropped + ' unknown id' + (dropped === 1 ? '' : 's') + ' dropped.';
        UI.showToast(msg);
      } catch (err) {
        UI.showToast('That file is not a valid notes file.');
      }
      ev.target.value = '';
    };
    reader.readAsText(file);
  }

  function clearNotes() {
    var had = notesCoverage();
    notes = {};
    try { global.localStorage.removeItem(NOTES_KEY); } catch (err) { /* private mode */ }
    closeNotes();
    render();
    UI.showToast('Cleared notes for ' + had + ' player' + (had === 1 ? '' : 's') + '.');
  }

  function renderNotesStatus() {
    var line = $('#notesStatus');
    if (!line) return;
    var have = notesCoverage();
    line.textContent = have
      ? have + ' of ' + players.length + ' players have notes.'
      : 'No notes on this device yet.';
    $('#notesClearBtn').disabled = !have;
  }

  function tidyState(next) {
    next.keepers = next.keepers || {};
    next.picks = Array.isArray(next.picks) ? next.picks : [];
    next.customPlayers = Array.isArray(next.customPlayers) ? next.customPlayers : [];
    return next;
  }

  // Accepts a full backup, and still accepts a bare draft state exported by an
  // older build — a backup taken before this change must not become unreadable.
  function importState(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var next = JSON.parse(reader.result);
        var parts;

        if (next && next.kind === BACKUP_KIND) {
          // Validate everything before writing anything, so a half-bad file
          // cannot leave one draft restored and the other clobbered.
          if (!isDraftState(next.live)) throw new Error('Backup has no usable live draft');
          parts = [];

          state.customPlayers.forEach(function (p) { delete playersById[p.id]; });

          Draft.save(tidyState(next.live), Draft.STORAGE_KEY);
          parts.push(next.live.picks.length + ' live picks');

          if (isDraftState(next.mock)) {
            Draft.save(tidyState(next.mock), Draft.MOCK_STORAGE_KEY);
            if (next.mock.picks.length) parts.push(next.mock.picks.length + ' mock picks');
          }

          if (next.notes && typeof next.notes === 'object' && !Array.isArray(next.notes)) {
            var kept = {}, n = 0;
            for (var id in next.notes) if (playersById[id]) { kept[id] = next.notes[id]; n++; }
            notes = kept;
            saveNotes(notes);
            parts.push(n + ' note' + (n === 1 ? '' : 's'));
          }

          state = Draft.load(storageKey());
          parts.push(Draft.keeperCount(state) + ' keepers');
        } else if (isDraftState(next)) {
          state.customPlayers.forEach(function (p) { delete playersById[p.id]; });
          state = tidyState(next);
          saveState();
          parts = [state.picks.length + ' picks', Draft.keeperCount(state) + ' keepers'];
        } else {
          throw new Error('Not a draft file');
        }

        view.lastPick = null;
        registerCustomPlayers();
        $('#teamSetup').dataset.built = '';
        render();
        UI.showToast('Restored — ' + parts.join(', ') + '.');
      } catch (err) {
        UI.showToast('That file is not a valid backup.');
      }
      ev.target.value = '';
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ mock draft */

  // Bots draft only from the ranked pool, and only from positions the team can
  // still fill. Injectable so a test can seed it and assert an exact draft.
  var botRng = Math.random;

  // True while skipping ahead, so 26 picks cost one render instead of 26.
  var mockBulk = false;

  function botPick() {
    var c = Draft.clock(state);
    if (c.complete || c.onClockIsMe) return false;

    var board = buildBoard();
    var counts = Draft.rosterCounts(state, c.onClockTeam.id, playersById);
    var choice = Bot.choose(board.available, counts, positionScarcity(board), botRng);
    if (!choice) return false;

    // The reason is stored with the pick so the transcript can explain the
    // draft after the fact, and so a reload does not lose it.
    state.picks.push({
      playerId: choice.player.id,
      teamId: c.onClockTeam.id,
      n: c.currentPick,
      why: choice.reason
    });
    dropFromQueue(choice.player.id);
    // Drives the top-bar readout and the row flash. Recorded before render()
    // so both land in the same paint as the pick itself.
    view.lastPick = {
      playerId: choice.player.id, teamId: c.onClockTeam.id, n: c.currentPick
    };
    saveState();
    if (!mockBulk) render();
    return true;
  }

  var mock = Mock.create({
    isComplete: function () { return state.picks.length >= nPicks(); },
    isMyTurn: function () {
      var c = Draft.clock(state);
      return !c.complete && c.onClockIsMe;
    },
    // A press in progress owns the screen; a bot pick would rebuild the rows
    // out from under his thumb.
    isBlocked: function () { return hold != null; },
    pick: botPick,
    onChange: function (why) {
      if (mockBulk) return;
      renderMockChrome(buildBoard());
      if (why === 'complete') {
        setTab('board');
        UI.showToast('Mock draft complete — ' + nPicks() + ' picks.');
      }
    }
  });

  /* ------------------------------------------------------- mode switching */

  // A mock always starts from the live league: same teams, same slot, the same
  // 42 keepers, zero picks. Re-entering keepers for a practice run would be
  // both tedious and a source of wrong answers.
  function seedMockFromLive() {
    var live = Draft.load(Draft.STORAGE_KEY);
    var seeded = Draft.freshState();
    seeded.teams = live.teams;
    seeded.mySlot = live.mySlot;
    seeded.pickOwners = {};
    for (var n in live.pickOwners || {}) seeded.pickOwners[n] = live.pickOwners[n];
    seeded.keepers = {};
    for (var id in live.keepers) {
      if (playersById[id]) seeded.keepers[id] = live.keepers[id];
    }
    // A mock is for drafting, so skip straight past setup if the league is ready.
    seeded.setupDone = Draft.keeperCount(seeded) === Draft.totalKeepers(seeded);
    return seeded;
  }

  function setMode(next, opts) {
    if (next === mode && !(opts && opts.force)) return;

    mock.stop();
    view.lastPick = null;
    // Hand-entered players belong to the draft that created them.
    state.customPlayers.forEach(function (p) { delete playersById[p.id]; });

    mode = next;
    try { global.localStorage.setItem(Draft.MODE_KEY, mode); } catch (err) { /* private mode */ }
    document.body.classList.toggle('is-mock', isMock());

    if (isMock()) {
      var existing = Draft.load(Draft.MOCK_STORAGE_KEY);
      var fresh = (opts && opts.fresh) || !existing.picks.length;
      state = fresh ? seedMockFromLive() : existing;
    } else {
      state = Draft.load(Draft.STORAGE_KEY);
    }

    registerCustomPlayers();
    saveState();
    $('#teamSetup').dataset.built = '';
    view.expandedTeams = {};
    setTab(state.setupDone ? 'board' : 'setup');
  }

  /* ------------------------------------------------------------ mock chrome */

  function renderMockChrome(board) {
    var on = isMock();
    $('#modeBadge').hidden = !on;
    renderLastPick();
    // Once the draft is done every control is dead; the summary card is what
    // the screen is for.
    var done = state.picks.length >= nPicks();
    $('#mockStrip').hidden = !on || !state.setupDone || done;

    if (!on) { $('#mockSummary').hidden = true; return; }

    var c = Draft.clock(state);
    var play = $('#mockPlay');
    play.disabled = c.complete || c.onClockIsMe;
    play.textContent = mock.isRunning() ? 'Pause' :
      (state.picks.length ? 'Resume' : 'Start');
    play.classList.toggle('is-running', mock.isRunning());
    $('#mockStep').disabled = c.complete || c.onClockIsMe;
    $('#mockSkip').disabled = c.complete || c.onClockIsMe;

    $('#mockState').textContent = c.complete ? 'complete'
      : c.onClockIsMe ? 'waiting on you'
      : mock.isRunning() ? 'running'
      : state.picks.length ? 'paused' : 'ready';

    $('#mockSpeedInput').value = String(mock.getSpeed());
    $('#mockSpeedOut').textContent = mock.getSpeed().toFixed(1) + 's';

    renderMockSummary(board, c);
  }

  // Who just went. At two seconds a pick a toast per pick would be unreadable,
  // so this replaces itself instead of stacking, and names the team that MADE
  // the pick — never the one on the clock, which by now is the next team along.
  function renderLastPick() {
    var host = $('#lastPick');
    var lp = view.lastPick;

    if (!isMock() || !lp) {
      host.hidden = true;
      host.classList.remove('is-flash');
      return;
    }

    var p = playersById[lp.playerId];
    var team = state.teams[lp.teamId];
    if (!p || !team) { host.hidden = true; return; }

    host.hidden = false;
    host.innerHTML = '';
    host.appendChild(el('span', 'lp-pick', label(lp.n)));
    host.appendChild(el('span', 'lp-team', team.name));
    host.appendChild(el('span', 'lp-arrow', '\u2192'));
    host.appendChild(el('span', 'lp-name', p.name));
    host.appendChild(el('span', 'lp-meta', p.position + ' T' + p.tier));

    flash(host);
  }

  // Spend the flash over exactly one pick interval, so it is done as the next
  // pick lands. Re-adding a class that is already there will not restart an
  // animation, hence the forced reflow between.
  function flash(node) {
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.style.animationDuration = mock.getSpeed() + 's';
    node.classList.add('is-flash');
  }

  function renderMockSummary(board, c) {
    var host = $('#mockSummary');
    if (!c.complete) { host.hidden = true; return; }

    var rosters = rostersByTeam(board);
    var ranked = state.teams.map(function (t) {
      return { team: t, score: Draft.scoreRoster(rosters[t.id]) };
    }).sort(function (a, b) { return b.score.effective - a.score.effective; });

    var meIndex = ranked.findIndex(function (r) { return r.team.slot === state.mySlot; });
    var mine = ranked[meIndex];

    host.hidden = false;
    host.innerHTML = '';
    host.appendChild(el('h2', null, 'Mock complete'));

    var line = el('p', 'ms-place');
    line.appendChild(el('b', null, ordinal(meIndex + 1)));
    line.appendChild(document.createTextNode(' of ' + nTeams() + ' · '));
    line.appendChild(el('b', null, num(mine.score.effective)));
    line.appendChild(document.createTextNode(' effective pts · ' +
      num(ranked[0].score.effective) + ' leads'));
    host.appendChild(line);

    var gaps = [];
    ['F', 'D', 'G'].forEach(function (pos) {
      var have = mine.score.counts[pos];
      if (have < LEAGUE.slots[pos]) {
        gaps.push((LEAGUE.slots[pos] - have) + ' short at ' + pos);
      }
      if (have < LEAGUE.counting[pos]) {
        gaps.push('cannot fill the ' + LEAGUE.counting[pos] + ' counting ' + pos + ' slots');
      }
    });
    host.appendChild(el('p', 'hint', gaps.length ? gaps.join(' · ') : 'Roster complete at every position.'));

    var row = el('div', 'btnrow');
    var copy = el('button', 'btn btn-primary', 'Copy transcript');
    copy.type = 'button';
    copy.addEventListener('click', copyTranscript);
    var dl = el('button', 'btn', 'Save .txt');
    dl.type = 'button';
    dl.addEventListener('click', downloadTranscript);
    row.appendChild(copy);
    row.appendChild(dl);
    host.appendChild(row);
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* -------------------------------------------------------------- transcript */

  function pad(str, width) {
    str = String(str);
    return str.length >= width ? str : str + new Array(width - str.length + 1).join(' ');
  }

  function padLeft(str, width) {
    str = String(str);
    return str.length >= width ? str : new Array(width - str.length + 1).join(' ') + str;
  }

  // Plain text, self-describing: the header states the league rules so the
  // transcript can be critiqued by someone (or something) with no other context.
  function buildTranscript() {
    var board = buildBoard();
    var rosters = rostersByTeam(board);
    var me = Draft.myTeam(state);
    var out = [];

    out.push('Draft Day 26 — ' + (isMock() ? 'mock' : 'live') + ' draft transcript');
    out.push(nTeams() + '-team snake. ' + (me ? me.name : 'I') +
      ' picks ' + ordinal(state.mySlot) + ' and is marked KEN below.');
    out.push('Scoring: skaters 1 pt per goal and 1 per assist; goalies 2 per win, +3 per shutout.');
    out.push('Roster ' + LEAGUE.slots.F + 'F / ' + LEAGUE.slots.D + 'D / ' + LEAGUE.slots.G +
      'G = ' + LEAGUE.rosterSize + '. Only the best ' + LEAGUE.counting.F + 'F + ' +
      LEAGUE.counting.D + 'D + ' + LEAGUE.counting.G + 'G score.');
    out.push(LEAGUE.keepersPerTeam + ' keepers per team, owned before the draft and costing no pick, so ' +
      LEAGUE.draftRounds + ' rounds are drafted (' + nPicks() + ' picks).');
    if (injuryDoc) {
      out.push('Injury flags (OUT/IR/LTIR/DTD/SUSP) are ESPN\'s report as of ' +
        shortDate(injuryDoc.fetched) + '.');
    }
    var trades = Draft.tradedPicks(state);
    if (trades.length) {
      out.push('Traded picks: ' + trades.map(function (t) {
        return '#' + t.n + ' ' + t.to.name + ' (from ' + t.from.name + ')';
      }).join(', ') + '.');
    }
    out.push('"why" is the bot\'s stated reason for the pick. Projected points follow each name.');
    out.push('');

    out.push('KEEPERS');
    state.teams.forEach(function (t) {
      var kept = Draft.keepersForTeam(state, t.id).map(function (id) {
        var p = playersById[id];
        return p ? p.name + ' (' + p.position + ' ' + num(p.points) + ')' : id;
      });
      out.push('  ' + pad(t.name + (t.slot === state.mySlot ? ' [KEN]' : ''), 16) +
        (kept.length ? kept.join(', ') : '—'));
    });
    out.push('');

    out.push('PICKS');
    state.picks.forEach(function (pick, i) {
      var p = playersById[pick.playerId];
      var t = state.teams[pick.teamId];
      var isMine = t && t.slot === state.mySlot;
      out.push(
        padLeft('#' + (i + 1), 5) + '  ' +
        pad(label(pick.n), 6) +
        pad(isMine ? 'KEN' : (t ? t.name : '?'), 10) +
        pad(p ? p.name : pick.playerId, 24) +
        pad(p ? p.position : '?', 3) +
        pad(p && p.tier ? 'T' + p.tier : '', 4) +
        pad(p && p.adp != null ? 'ADP ' + p.adp.toFixed(1) : 'no ADP', 11) +
        padLeft(p ? num(p.points) : '', 7) +
        (isMine ? '   [your pick]' : (pick.why ? '   [' + pick.why + ']' : '')) +
        (state.pickOwners && state.pickOwners[pick.n] ? '   (traded pick)' : '') +
        (injuryFor(pick.playerId) ? '   ' + INJURY[injuryFor(pick.playerId).status].code : '')
      );
    });
    out.push('');

    if (me) {
      var myRoster = rosters[me.id] || [];
      var myScore = Draft.scoreRoster(myRoster);
      out.push('MY ROSTER — effective ' + num(myScore.effective) + ', raw ' + num(myScore.raw));
      ['F', 'D', 'G'].forEach(function (pos) {
        var atPos = myRoster.filter(function (p) { return p.position === pos; })
          .sort(function (a, b) { return b.points - a.points; });
        out.push('  ' + pos + ' (' + atPos.length + '/' + LEAGUE.slots[pos] + ', best ' +
          LEAGUE.counting[pos] + ' count)');
        atPos.forEach(function (p, i) {
          out.push('    ' + (i < LEAGUE.counting[pos] ? 'counts ' : 'bench  ') +
            pad(p.name, 24) + padLeft(num(p.points), 7) +
            (state.keepers[p.id] != null ? '  keeper' : ''));
        });
      });
      out.push('');
    }

    out.push('FINAL STANDINGS (effective total)');
    state.teams.map(function (t) {
      return { team: t, score: Draft.scoreRoster(rosters[t.id] || []) };
    }).sort(function (a, b) {
      return b.score.effective - a.score.effective;
    }).forEach(function (r, i) {
      out.push('  ' + padLeft(i + 1, 3) + '. ' +
        pad(r.team.name + (r.team.slot === state.mySlot ? ' [KEN]' : ''), 18) +
        padLeft(num(r.score.effective), 8) + '   raw ' + num(r.score.raw));
    });

    return out.join('\n');
  }

  // Clipboard first: he is pasting this into Claude, and a blob download in a
  // standalone iOS PWA is unreliable. The download stays as the fallback.
  function copyTranscript() {
    var text = buildTranscript();
    var done = function () { UI.showToast('Transcript copied — ' + state.picks.length + ' picks.'); };
    var failed = function () {
      UI.showToast('Could not copy. Use Save .txt instead.');
    };
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(done, failed);
    } else {
      failed();
    }
  }

  function downloadTranscript() {
    var blob = new Blob([buildTranscript()], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = 'hockeydraft26-' + mode + '-transcript.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function wireMock() {
    $('#mockRestart').addEventListener('click', function () {
      setMode('mock', { force: true, fresh: true });
      UI.showToast('New mock — teams, keepers and traded picks copied from the live draft.');
    });
    $('#mockCopy').addEventListener('click', copyTranscript);
    $('#mockDownload').addEventListener('click', downloadTranscript);

    $('#mockPlay').addEventListener('click', function () {
      if (mock.isRunning()) mock.pause(); else mock.resume();
    });
    $('#mockStep').addEventListener('click', function () { mock.step(); });
    $('#mockSkip').addEventListener('click', function () {
      cancelHold();
      mockBulk = true;
      var made = mock.skipToMine();
      mockBulk = false;
      render();
      UI.showToast(made ? 'Skipped ' + made + ' pick' + (made === 1 ? '' : 's') + '.'
        : 'Nothing to skip.');
    });

    var slider = $('#mockSpeedInput');
    slider.min = String(Mock.MIN_SPEED);
    slider.max = String(Mock.MAX_SPEED);
    slider.addEventListener('input', function () {
      mock.setSpeed(slider.value);
    });

    document.addEventListener('visibilitychange', function () {
      if (isMock()) mock.onVisibility(document.hidden);
    });
  }

  // Chrome's default is "best-effort" storage, which it may clear when the
  // device runs low on space — a draft and a season's notes are not something
  // to leave on best effort. Asking marks the origin persistent; Chrome grants
  // it silently for an installed PWA. Purely an upgrade: a refusal, or a
  // browser without the API, leaves behaviour exactly as it was.
  function requestPersistence() {
    if (!global.navigator.storage || !global.navigator.storage.persist) return;
    global.navigator.storage.persisted().then(function (already) {
      if (already) return true;
      return global.navigator.storage.persist();
    }).then(function (granted) {
      if (!granted) console.info('Storage is best-effort; export a backup before draft day.');
    }).catch(function () { /* nothing to do, and nothing lost */ });
  }

  /* ------------------------------------------------------------------ boot */

  function boot(data) {
    players = data;
    players.forEach(function (p) {
      playersById[p.id] = p;
      searchKeys[p.id] = normalize(p.name + p.team);
    });

    notes = loadNotes();
    requestPersistence();

    // Come back in whichever draft he left, so a reload mid-mock is not a trap.
    try {
      if (global.localStorage.getItem(Draft.MODE_KEY) === 'mock') mode = 'mock';
    } catch (err) { /* private mode */ }
    document.body.classList.toggle('is-mock', isMock());

    state = Draft.load(storageKey());
    // Must precede the prune below: a saved pick pointing at a hand-entered
    // player is only resolvable once that player is back in the lookup.
    registerCustomPlayers();

    // Drop any saved reference to a player the data file no longer carries.
    var stale = false;
    for (var id in state.keepers) {
      if (!playersById[id]) { delete state.keepers[id]; stale = true; }
    }
    var kept = state.picks.filter(function (pick) { return !!playersById[pick.playerId]; });
    if (kept.length !== state.picks.length) { stale = true; }
    state.picks = kept.map(function (pick, i) {
      return { playerId: pick.playerId, teamId: pick.teamId, n: i + 1 };
    });
    if (stale) {
      console.warn('Dropped saved players missing from the data file.');
    }
    // Write on boot so a fresh install has a state record immediately, rather
    // than only after the first pick.
    saveState();

    $('#versionLine').textContent = 'Draft Day 26 · v' + APP_VERSION + ' · ' +
      players.length + ' players';
    syncChips();
    wire();
    wireMock();
    setTab(state.setupDone ? 'board' : 'setup');
  }

  function start() {
    // The injury report is optional: a missing or broken file must never
    // stop the board from loading, so its failure resolves to null.
    var injuriesLoad = fetch('./data/injuries.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    fetch('./data/players.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        return injuriesLoad.then(function (doc) {
          injuryDoc = doc && doc.players ? doc : null;
          boot(data);
        });
      })
      .catch(function (err) {
        console.error('Could not load player data', err);
        $('#playerList').innerHTML = '';
        $('#boardEmpty').hidden = false;
        $('#boardEmpty').textContent =
          'Could not load player data. Reconnect once, then it works offline.';
      });
  }

  // Test seam. The Playwright suite needs a seeded bot to assert an exact
  // draft and a way to run the clock without waiting on real seconds.
  global.MockTest = {
    seed: function (n) { botRng = Bot.seededRandom(n); },
    unseed: function () { botRng = Math.random; },
    controller: function () { return mock; },
    mode: function () { return mode; },
    transcript: buildTranscript,
    picks: function () { return state.picks.length; },
    // Run a whole mock to the end with the bot drafting for Ken too, so a test
    // can reach pick 294 without 294 round trips. Bounded so a stuck board
    // ends the loop rather than hanging the page.
    runToEnd: function () {
      mockBulk = true;
      var guard = nPicks() + 5;
      while (guard-- > 0 && state.picks.length < nPicks()) {
        var c = Draft.clock(state);
        if (c.onClockIsMe) {
          var board = buildBoard();
          var counts = Draft.rosterCounts(state, c.onClockTeam.id, playersById);
          var choice = Bot.choose(board.available, counts, positionScarcity(board), botRng);
          if (!choice) break;
          state.picks.push({
            playerId: choice.player.id, teamId: c.onClockTeam.id, n: c.currentPick
          });
          saveState();
        } else if (!botPick()) {
          break;
        }
      }
      mockBulk = false;
      render();
      return state.picks.length;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  if ('serviceWorker' in navigator) {
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('Service worker registration failed', err);
      });
    });
  }
})(window);
