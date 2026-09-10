/* app.js — controller: owns state, derives the board, renders, wires events. */
(function (global) {
  'use strict';

  var $ = UI.$, $$ = UI.$$, el = UI.el, num = UI.num, normalize = UI.normalize;
  var LEAGUE = Draft.LEAGUE;

  var APP_VERSION = '1.5.0';

  var players = [];              // seeded from data/players.json
  var playersById = {};
  var searchKeys = {};           // playerId -> normalized name, built once

  var state = Draft.freshState();

  // Transient view state — deliberately not persisted.
  var view = {
    tab: 'board',
    positions: { F: true, D: true, G: true },
    search: '',
    sort: 'tier',
    sortDir: 'asc',
    showDrafted: false,
    expandedTeams: {},
    keeperTeam: 0,
    keeperSearch: ''
  };

  /* ------------------------------------------------------------ board data */

  // Sortable columns. `best` is the direction that puts the most desirable
  // player first — descending for VORP and points, but ascending for tier,
  // since tier 1 is the good end. Tapping a column sorts it that way; tapping
  // the active column again reverses.
  var SORT_COLUMNS = {
    tier:   { best: 'asc',  value: function (p) { return p.tier; } },
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
    var col = SORT_COLUMNS[view.sort] || SORT_COLUMNS.tier;
    var diff = col.value(a) - col.value(b);
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
    if (!view.positions[p.position]) return false;
    if (!view.showDrafted && board.owners[p.id] != null) return false;
    return true;
  }

  /* --------------------------------------------------------------- actions */

  function draftPlayer(playerId, teamId) {
    if (state.picks.length >= LEAGUE.totalPicks) {
      UI.showToast('All ' + LEAGUE.totalPicks + ' picks are in.');
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
    Draft.save(state);
    render();

    var counts = Draft.rosterCounts(state, teamId, playersById);
    var over = counts[p.position] > LEAGUE.slots[p.position];
    var msg = Draft.pickLabel(n) + ' · ' + team.name + ' take ' + p.name;
    if (over) {
      msg += ' — over the ' + p.position + ' limit (' +
        counts[p.position] + '/' + LEAGUE.slots[p.position] + ')';
    }
    UI.showToast(msg, 'Undo', undoLastPick);
  }

  function undoLastPick() {
    if (!state.picks.length) return;
    var last = state.picks.pop();
    Draft.save(state);
    render();
    var p = playersById[last.playerId];
    UI.showToast('Undid ' + Draft.pickLabel(last.n) + ' — ' + (p ? p.name : 'pick') + ' is back on the board.');
  }

  // Removes a player from whichever team holds them. A live pick can only be
  // pulled back if it is the most recent one, so the snake stays consistent.
  function releasePlayer(playerId) {
    if (state.keepers[playerId] != null) {
      delete state.keepers[playerId];
      Draft.save(state);
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

  function assignKeeper(playerId, teamId) {
    if (Draft.ownerMap(state)[playerId] != null) return;
    if (Draft.keepersForTeam(state, teamId).length >= LEAGUE.keepersPerTeam) {
      UI.showToast(state.teams[teamId].name + ' already has ' + LEAGUE.keepersPerTeam + ' keepers.');
      return;
    }
    state.keepers[playerId] = teamId;
    Draft.save(state);
    render();
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
    ['F', 'D', 'G'].forEach(function (pos) {
      var badge = $('#badge-' + pos);
      var chip = $('.chip-' + pos);
      var s = scarcity[pos];

      if (s == null) {
        // No one left at the position — cannot happen with this pool, but the
        // badge should vanish rather than show a stale number if it ever does.
        badge.hidden = true;
        delete badge.dataset.level;
        chip.setAttribute('aria-label', 'Filter ' + POS_WORD[pos] + ', none left');
        return;
      }

      var level = scarcityLevel(s.count);
      badge.hidden = false;
      badge.textContent = String(s.tier);
      badge.dataset.level = level;
      chip.title = s.count + ' tier ' + s.tier + ' ' + POS_WORD[pos] + ' left';
      chip.setAttribute('aria-label',
        'Filter ' + POS_WORD[pos] + ', best tier available ' + s.tier + ', ' +
        s.count + ' left, ' + LEVEL_WORD[level]);
    });
  }

  function render() {
    var board = buildBoard();
    renderTopbar(board);
    renderTierBadges(board);
    if (view.tab === 'board') renderBoard(board);
    if (view.tab === 'teams') renderTeams(board);
    if (view.tab === 'setup') renderSetup(board);
  }

  function renderTopbar(board) {
    var c = Draft.clock(state);
    var topbar = $('#topbar');

    $('#undoBtn').disabled = state.picks.length === 0;

    if (c.complete) {
      $('#pickLabel').textContent = 'Done';
      $('#onClockText').textContent = 'Draft complete';
      $('#turnLine').textContent = LEAGUE.totalPicks + ' picks made · ' +
        Draft.keeperCount(state) + ' keepers';
      topbar.classList.remove('is-mine');
      $('#turnLine').classList.remove('is-mine');
      return;
    }

    $('#pickLabel').textContent = Draft.pickLabel(c.currentPick);
    $('#onClockText').innerHTML = '';
    $('#onClockText').appendChild(document.createTextNode(c.onClockTeam.name));
    if (c.onClockIsMe) {
      $('#onClockText').appendChild(el('span', 'me-tag', 'YOU'));
    }

    topbar.classList.toggle('is-mine', c.onClockIsMe);
    var turn = $('#turnLine');
    turn.classList.toggle('is-mine', c.onClockIsMe);
    turn.innerHTML = '';

    if (!state.setupDone) {
      turn.textContent = 'Finish setup to start the draft.';
      return;
    }

    if (c.onClockIsMe) {
      turn.appendChild(document.createTextNode("You're up. Next turn after this: "));
      var b1 = el('b', null, Draft.pickLabel(c.targetPick));
      turn.appendChild(b1);
      turn.appendChild(document.createTextNode(' (' + c.picksUntilMine + ' picks away)'));
    } else {
      var b2 = el('b', null, String(c.picksUntilMine));
      turn.appendChild(document.createTextNode('Your pick '));
      turn.appendChild(b2);
      turn.appendChild(document.createTextNode(
        ' pick' + (c.picksUntilMine === 1 ? '' : 's') + ' away · ' + Draft.pickLabel(c.targetPick)
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

    var shown = players.filter(function (p) { return matchesFilters(p, board); });
    shown.sort(function (a, b) {
      var ao = board.owners[a.id] != null, bo = board.owners[b.id] != null;
      if (ao !== bo) return ao ? 1 : -1; // drafted players sink to the bottom
      return displayCompare(a, b);
    });

    var split = horizon > 0 ? projectedSplit(shown, board, horizon) : null;

    for (var i = 0; i < shown.length; i++) {
      if (split && split.index === i) {
        frag.appendChild(buildDivider(horizon, c));
      }
      var p = shown[i];
      frag.appendChild(buildPlayerRow(p, board.owners[p.id], board.rankById[p.id], c, horizon));
    }
    if (split && split.index === shown.length) {
      frag.appendChild(buildDivider(horizon, c));
    }

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

  // Which players are projected gone is a property of the board, not of the
  // display order — a player is gone if their canonical rank falls inside the
  // horizon. So the line goes wherever that status first flips as the list is
  // read top to bottom, which lands it correctly under any sort, reversed
  // included. `goneFirst` says which side of the line the gone players are on.
  function projectedSplit(shown, board, horizon) {
    var prev = null;
    var first = null;
    var lastAvailableIndex = -1;

    for (var i = 0; i < shown.length; i++) {
      if (board.owners[shown[i].id] != null) continue; // drafted rows carry no rank
      var gone = board.rankById[shown[i].id] < horizon;
      if (first === null) first = gone;
      if (prev !== null && gone !== prev) return { index: i, goneFirst: first };
      prev = gone;
      lastAvailableIndex = i;
    }

    if (first === null) return null;                       // nothing available on screen
    // No transition: every visible player sits on the same side of the line.
    return first
      ? { index: lastAvailableIndex + 1, goneFirst: true }  // all projected gone
      : { index: 0, goneFirst: true };                      // none of them are
  }

  function buildDivider(horizon, c) {
    var li = el('li', 'divider');
    li.appendChild(el('span', 'divider-label', 'Your pick · ' + Draft.pickLabel(c.targetPick)));
    li.appendChild(el('span', 'divider-note',
      horizon + ' pick' + (horizon === 1 ? '' : 's') + ' away — shaded rows likely gone'));
    return li;
  }

  function buildPlayerRow(p, ownerId, rank, c, horizon) {
    var available = ownerId == null && state.setupDone && !c.complete;
    // Whether a player is projected gone is a fact about the board, so shading
    // the rows says it exactly — the divider alone can only approximate it once
    // the display order stops matching board rank.
    var projectedGone = ownerId == null && horizon > 0 && rank < horizon;
    var li = el('li', 'prow pos-' + p.position +
      (ownerId != null ? ' is-taken' : '') +
      (projectedGone ? ' is-projected-gone' : ''));

    li.appendChild(el('span', 'p-rank', ownerId == null ? String(rank + 1) : '–'));

    var main = el('div', 'p-main');
    main.appendChild(el('span', 'p-name', p.name));
    var sub = el('span', 'p-sub');
    sub.appendChild(el('span', 'p-pos', p.position));
    sub.appendChild(el('span', null, p.team));
    if (ownerId != null) {
      var isKeeper = state.keepers[p.id] != null;
      sub.appendChild(el('span', 'p-owner' + (isKeeper ? ' is-keeper' : ''),
        (isKeeper ? 'K · ' : '') + state.teams[ownerId].name));
    }
    main.appendChild(sub);
    li.appendChild(main);

    li.appendChild(el('span', 'p-num p-tier', String(p.tier)));
    li.appendChild(el('span', 'p-num p-vorp', num(p.vorp)));
    li.appendChild(el('span', 'p-num p-pts', num(p.points)));

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

  /* ------------------------------------------------------- hold-to-draft */

  var HOLD_MS = 2000;      // full press duration before the pick commits
  var MOVE_CANCEL_PX = 12; // treat as a scroll, not a press
  var HOLD_POP_GAP = 62;   // clearance from the press point, so a thumb cannot
                           // cover the popup or its progress bar

  var hold = null;

  function attachHold(li, p, team) {
    li.addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
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

    // Sit above the finger, but stay inside the viewport on all four sides.
    var w = pop.offsetWidth, h = pop.offsetHeight, pad = 8;
    var left = Math.min(Math.max(x, w / 2 + pad), global.innerWidth - w / 2 - pad);
    var top = y - h - HOLD_POP_GAP;
    pop.classList.toggle('is-below', top < pad);
    if (top < pad) top = y + HOLD_POP_GAP;
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
      ' · ' + num(p.vorp) + ' VORP · ' + num(p.points) + ' pts';

    UI.openSheet(p.name, sub, function (body) {
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
        'Draft to ' + c.onClockTeam.name + ' · ' + Draft.pickLabel(c.currentPick));
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

    state.teams.forEach(function (t) {
      var roster = rosters[t.id];
      var score = Draft.scoreRoster(roster);
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
      row.appendChild(el('span', 'r-tag', state.keepers[p.id] != null ? 'K' : ''));
      row.appendChild(el('span', 'r-pts', num(p.points)));
      body.appendChild(row);
    });
    return body;
  }

  /* ----------------------------------------------------------- setup view */

  function renderSetup(board) {
    renderTeamSetup();
    renderKeeperSetup(board);
    renderSetupStatus();
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
        Draft.save(state);
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
        Draft.save(state);
        render();
      });
      mine.appendChild(radio);
      row.appendChild(mine);

      frag.appendChild(row);
    });
    host.innerHTML = '';
    host.appendChild(frag);
    host.dataset.built = '1';
  }

  function renderKeeperSetup(board) {
    $('#keeperCounter').textContent = Draft.keeperCount(state) + ' / ' + LEAGUE.totalKeepers;

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
            Draft.save(state);
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
        assignKeeper(p.id, view.keeperTeam);
        view.keeperSearch = '';
      });
      li.appendChild(b);
      host.appendChild(li);
    });
    if (!matches.length) {
      host.appendChild(el('li', 'tc-empty', 'No available players match.'));
    }
  }

  function renderSetupStatus() {
    var host = $('#setupStatus');
    host.innerHTML = '';
    var kc = Draft.keeperCount(state);
    var me = Draft.myTeam(state);

    function row(label, value, cls) {
      var d = el('div');
      d.appendChild(el('span', null, label));
      d.appendChild(el('span', cls, value));
      host.appendChild(d);
    }

    row('Keepers assigned', kc + ' / ' + LEAGUE.totalKeepers,
      kc === LEAGUE.totalKeepers ? 'ok' : 'warn');
    row('Your team', me ? me.name + ' (slot ' + me.slot + ')' : '—', 'ok');
    row('Draft rounds', String(LEAGUE.draftRounds), 'ok');
    row('Total picks', String(LEAGUE.totalPicks), 'ok');
    row('Picks made', String(state.picks.length), 'ok');

    $('#startBtn').textContent = state.setupDone ? 'Back to board' : 'Start draft';
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
        var pos = chip.dataset.pos;
        if (pos === 'ALL') {
          view.positions = { F: true, D: true, G: true };
        } else {
          view.positions[pos] = !view.positions[pos];
          // Never leave the board with nothing selected.
          if (!view.positions.F && !view.positions.D && !view.positions.G) {
            view.positions[pos] = true;
          }
        }
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
    $('#sheetBackdrop').addEventListener('click', UI.closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && UI.sheetIsOpen()) UI.closeSheet();
    });

    $('#startBtn').addEventListener('click', function () {
      state.setupDone = true;
      Draft.save(state);
      setTab('board');
    });

    $('#exportBtn').addEventListener('click', exportState);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', importState);

    $('#resetBtn').addEventListener('click', openResetSheet);
  }

  /* ----------------------------------------------------------------- reset */

  // Three scopes, narrowest first, because re-running a sim is the common case
  // and re-entering 42 keepers is the expensive one. Player projections live in
  // data/players.json and are never written by the app, so no scope touches them.
  function resetPicksOnly() {
    var n = state.picks.length;
    state.picks = [];
    Draft.save(state);
    render();
    UI.showToast('Cleared ' + n + ' pick' + (n === 1 ? '' : 's') + '. Keepers and teams kept.');
  }

  function resetToSetup() {
    var n = state.picks.length;
    state.picks = [];
    state.setupDone = false;
    Draft.save(state);
    setTab('setup');
    UI.showToast('Draft cancelled — ' + n + ' pick' + (n === 1 ? '' : 's') +
      ' cleared. Keepers and teams kept.');
  }

  function resetEverything() {
    state = Draft.freshState();
    Draft.save(state);
    $('#teamSetup').dataset.built = '';
    view.keeperTeam = 0;
    view.keeperSearch = '';
    view.expandedTeams = {};
    setTab('setup');
    UI.showToast('Everything reset. Player projections are untouched.');
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
    var all = view.positions.F && view.positions.D && view.positions.G;
    $$('.chip').forEach(function (chip) {
      var pos = chip.dataset.pos;
      chip.classList.toggle('is-on', pos === 'ALL' ? all : view.positions[pos]);
    });
  }

  function exportState() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = 'hockeydraft26-state.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importState(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var next = JSON.parse(reader.result);
        if (!next || next.v !== 1 || !Array.isArray(next.teams) || next.teams.length !== LEAGUE.teamCount) {
          throw new Error('Not a draft state file');
        }
        state = next;
        state.keepers = state.keepers || {};
        state.picks = Array.isArray(state.picks) ? state.picks : [];
        Draft.save(state);
        $('#teamSetup').dataset.built = '';
        render();
        UI.showToast('State imported — ' + state.picks.length + ' picks, ' +
          Draft.keeperCount(state) + ' keepers.');
      } catch (err) {
        UI.showToast('That file is not a valid draft state.');
      }
      ev.target.value = '';
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ boot */

  function boot(data) {
    players = data;
    players.forEach(function (p) {
      playersById[p.id] = p;
      searchKeys[p.id] = normalize(p.name + p.team);
    });

    state = Draft.load();

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
    Draft.save(state);

    $('#versionLine').textContent = 'Draft Day 26 · v' + APP_VERSION + ' · ' +
      players.length + ' players';
    syncChips();
    wire();
    setTab(state.setupDone ? 'board' : 'setup');
  }

  function start() {
    fetch('./data/players.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(boot)
      .catch(function (err) {
        console.error('Could not load player data', err);
        $('#playerList').innerHTML = '';
        $('#boardEmpty').hidden = false;
        $('#boardEmpty').textContent =
          'Could not load player data. Reconnect once, then it works offline.';
      });
  }

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
