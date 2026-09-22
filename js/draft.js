/* draft.js — league rules, snake math, scoring, and persisted draft state.
   Pure logic: no DOM access lives in here. */
(function (global) {
  'use strict';

  // Rules that do not depend on how many teams turn up. The team count is NOT
  // here: it lives in the draft's own state, because someone drops out and
  // because the live and mock drafts can legitimately differ in size.
  var LEAGUE = {
    rosterSize: 24,
    keepersPerTeam: 3,
    defaultTeams: 14,
    minTeams: 2,
    maxTeams: 20,
    // Roster slots carried at each position.
    slots: { F: 15, D: 6, G: 3 },
    // How many of those slots actually score each week.
    counting: { F: 12, D: 4, G: 2 }
  };
  // Keepers are pre-assigned and cost no pick, so only the remainder is drafted.
  LEAGUE.draftRounds = LEAGUE.rosterSize - LEAGUE.keepersPerTeam; // 21

  // Everything below scales with the size of the draft in hand. Derived from
  // state rather than stored, so the two can never disagree.
  function teamCount(state) { return state.teams.length; }
  function totalPicks(state) { return LEAGUE.draftRounds * state.teams.length; }
  function totalKeepers(state) { return LEAGUE.keepersPerTeam * state.teams.length; }

  var DEFAULT_TEAM_NAMES = [
    'Eric', 'Dan', 'Cory', 'Doug', 'Matthew', 'Hunter', 'Marc',
    'Nica', 'Clinton', 'Nick', 'Ryan', 'Ken', 'Darren', 'Rick'
  ];
  var DEFAULT_MY_SLOT = 12; // Ken drafts 12th

  // Live and mock drafts persist under separate keys so a practice run can
  // never touch the real one. Callers pass the key; omitting it means live.
  var STORAGE_KEY = 'hockeydraft26.state.v1';
  var MOCK_STORAGE_KEY = 'hockeydraft26.mock.v1';
  var MODE_KEY = 'hockeydraft26.mode';

  /* ---------------------------------------------------------------- snake */

  // Every snake function takes the size explicitly. It used to read a module
  // constant, which was fine while 14 was the only answer — but the app now
  // holds two drafts at once that may differ in size, and a shared mutable
  // count would silently compute one draft's order with the other's width.

  // Slot (1-based) that owns pick number n (1-based). Odd rounds run 1->N,
  // even rounds run N->1.
  function slotForPick(n, teams) {
    var round = Math.floor((n - 1) / teams); // 0-based
    var i = (n - 1) % teams;
    return round % 2 === 0 ? i + 1 : teams - i;
  }

  function roundForPick(n, teams) {
    return Math.floor((n - 1) / teams) + 1;
  }

  function pickInRound(n, teams) {
    return ((n - 1) % teams) + 1;
  }

  function pickLabel(n, teams) {
    return roundForPick(n, teams) + '.' + String(pickInRound(n, teams)).padStart(2, '0');
  }

  // First pick number >= from that belongs to slot. Null once the draft ends.
  function nextPickForSlot(slot, from, teams) {
    var last = LEAGUE.draftRounds * teams;
    for (var n = Math.max(1, from); n <= last; n++) {
      if (slotForPick(n, teams) === slot) return n;
    }
    return null;
  }

  /* --------------------------------------------------------------- scoring */

  // Effective total under the real counting rule: best 12 F + best 4 D +
  // best 2 G. Returns the total plus the set of player ids that count, so the
  // roster view can show which players are actually scoring.
  function scoreRoster(roster) {
    var total = 0;
    var raw = 0;
    var countingIds = Object.create(null);
    var counts = { F: 0, D: 0, G: 0 };

    for (var i = 0; i < roster.length; i++) {
      raw += roster[i].points;
      counts[roster[i].position]++;
    }

    ['F', 'D', 'G'].forEach(function (pos) {
      var atPos = roster.filter(function (p) { return p.position === pos; });
      atPos.sort(function (a, b) { return b.points - a.points; });
      var take = atPos.slice(0, LEAGUE.counting[pos]);
      for (var j = 0; j < take.length; j++) {
        total += take[j].points;
        countingIds[take[j].id] = true;
      }
    });

    return {
      effective: total,
      raw: raw,
      counts: counts,
      countingIds: countingIds
    };
  }

  /* ----------------------------------------------------------------- state */

  function makeTeams(names, count) {
    var n = count == null ? LEAGUE.defaultTeams : count;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        id: i, slot: i + 1,
        name: (names && names[i]) || DEFAULT_TEAM_NAMES[i] || ('Team ' + (i + 1))
      });
    }
    return out;
  }

  // Ids double as indexes into state.teams and are what keepers and picks point
  // at, so removing one means renumbering everything after it. Keepers held by
  // the departing team go back in the pool.
  //
  // Refuses once a pick exists: those picks were made under a snake order this
  // would renumber, so 2.03 would silently become a different pick.
  function removeTeam(state, teamId) {
    if (state.picks.length) return { ok: false, why: 'picks' };
    if (state.teams.length <= LEAGUE.minTeams) return { ok: false, why: 'min' };

    var going = state.teams[teamId];
    if (!going) return { ok: false, why: 'missing' };
    if (going.slot === state.mySlot) return { ok: false, why: 'mine' };

    var released = 0;
    var keepers = {};
    for (var id in state.keepers) {
      var owner = state.keepers[id];
      if (owner === teamId) { released++; continue; }
      keepers[id] = owner > teamId ? owner - 1 : owner;
    }
    state.keepers = keepers;

    state.teams.splice(teamId, 1);
    for (var i = 0; i < state.teams.length; i++) {
      state.teams[i].id = i;
      state.teams[i].slot = i + 1;
    }

    // Your own slot follows you up rather than pointing at whoever inherited
    // the number.
    if (state.mySlot > going.slot) state.mySlot--;

    return { ok: true, removed: going.name, released: released };
  }

  function addTeam(state, name) {
    if (state.picks.length) return { ok: false, why: 'picks' };
    if (state.teams.length >= LEAGUE.maxTeams) return { ok: false, why: 'max' };

    var i = state.teams.length;
    var team = {
      id: i, slot: i + 1,
      name: name || DEFAULT_TEAM_NAMES[i] || ('Team ' + (i + 1))
    };
    state.teams.push(team);
    return { ok: true, added: team.name };
  }

  function freshState() {
    return {
      v: 1,
      teams: makeTeams(DEFAULT_TEAM_NAMES),
      mySlot: DEFAULT_MY_SLOT,
      keepers: {},       // playerId -> teamId
      picks: [],         // [{ playerId, teamId, n }] in pick order
      customPlayers: [], // players entered by hand, absent from the rankings
      setupDone: false
    };
  }

  function load(key) {
    try {
      var raw = global.localStorage.getItem(key || STORAGE_KEY);
      if (!raw) return freshState();
      var s = JSON.parse(raw);
      // Was `!== LEAGUE.teamCount`, which quietly replaced any saved draft of a
      // different size with a blank one. Now that the size is the user's to
      // choose, that would throw away a real draft, so accept any legal width.
      if (!s || s.v !== 1 || !Array.isArray(s.teams) ||
          s.teams.length < LEAGUE.minTeams || s.teams.length > LEAGUE.maxTeams) {
        return freshState();
      }
      s.keepers = s.keepers || {};
      s.picks = Array.isArray(s.picks) ? s.picks : [];
      s.customPlayers = Array.isArray(s.customPlayers) ? s.customPlayers : [];
      return s;
    } catch (err) {
      // Corrupt or unavailable storage should never block draft day.
      console.warn('Could not load saved draft state; starting fresh.', err);
      return freshState();
    }
  }

  function save(state, key) {
    try {
      global.localStorage.setItem(key || STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.warn('Could not persist draft state.', err);
      return false;
    }
  }

  /* ------------------------------------------------------------- selectors */

  // playerId -> teamId, covering keepers and live picks alike.
  function ownerMap(state) {
    var owners = Object.create(null);
    for (var id in state.keepers) owners[id] = state.keepers[id];
    for (var i = 0; i < state.picks.length; i++) {
      owners[state.picks[i].playerId] = state.picks[i].teamId;
    }
    return owners;
  }

  function keeperCount(state) {
    return Object.keys(state.keepers).length;
  }

  function keepersForTeam(state, teamId) {
    var out = [];
    for (var id in state.keepers) {
      if (state.keepers[id] === teamId) out.push(id);
    }
    return out;
  }

  // Everything about whose turn it is and how far away Ken's next turn is.
  function clock(state) {
    var teams = state.teams.length;
    var made = state.picks.length;
    var current = made + 1;
    var complete = current > totalPicks(state);
    var onClockSlot = complete ? null : slotForPick(current, teams);
    var onClockTeam = complete ? null : teamBySlot(state, onClockSlot);
    var onClockIsMe = !complete && onClockSlot === state.mySlot;

    // When Ken is on the clock his "next turn" is the wheel back around —
    // that is the horizon worth drawing on the board.
    var from = onClockIsMe ? current + 1 : current;
    var target = complete ? null : nextPickForSlot(state.mySlot, from, teams);

    return {
      picksMade: made,
      currentPick: current,
      complete: complete,
      onClockSlot: onClockSlot,
      onClockTeam: onClockTeam,
      onClockIsMe: onClockIsMe,
      targetPick: target,
      // Picks other teams get to make before Ken is up again.
      picksUntilMine: target ? target - current : 0
    };
  }

  function teamBySlot(state, slot) {
    for (var i = 0; i < state.teams.length; i++) {
      if (state.teams[i].slot === slot) return state.teams[i];
    }
    return null;
  }

  function myTeam(state) {
    return teamBySlot(state, state.mySlot);
  }

  // Roster limits are advisory — the app warns but never blocks a pick.
  function rosterCounts(state, teamId, playersById) {
    var owners = ownerMap(state);
    var counts = { F: 0, D: 0, G: 0 };
    for (var id in owners) {
      if (owners[id] !== teamId) continue;
      var p = playersById[id];
      if (p) counts[p.position]++;
    }
    return counts;
  }

  global.Draft = {
    LEAGUE: LEAGUE,
    DEFAULT_TEAM_NAMES: DEFAULT_TEAM_NAMES,
    DEFAULT_MY_SLOT: DEFAULT_MY_SLOT,
    teamCount: teamCount,
    totalPicks: totalPicks,
    totalKeepers: totalKeepers,
    removeTeam: removeTeam,
    addTeam: addTeam,
    STORAGE_KEY: STORAGE_KEY,
    MOCK_STORAGE_KEY: MOCK_STORAGE_KEY,
    MODE_KEY: MODE_KEY,
    slotForPick: slotForPick,
    roundForPick: roundForPick,
    pickInRound: pickInRound,
    pickLabel: pickLabel,
    nextPickForSlot: nextPickForSlot,
    scoreRoster: scoreRoster,
    freshState: freshState,
    makeTeams: makeTeams,
    load: load,
    save: save,
    ownerMap: ownerMap,
    keeperCount: keeperCount,
    keepersForTeam: keepersForTeam,
    clock: clock,
    teamBySlot: teamBySlot,
    myTeam: myTeam,
    rosterCounts: rosterCounts
  };
})(window);
