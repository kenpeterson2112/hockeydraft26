/* draft.js — league rules, snake math, scoring, and persisted draft state.
   Pure logic: no DOM access lives in here. */
(function (global) {
  'use strict';

  var LEAGUE = {
    teamCount: 14,
    rosterSize: 24,
    keepersPerTeam: 3,
    // Roster slots carried at each position.
    slots: { F: 15, D: 6, G: 3 },
    // How many of those slots actually score each week.
    counting: { F: 12, D: 4, G: 2 }
  };
  // Keepers are pre-assigned and cost no pick, so only the remainder is drafted.
  LEAGUE.draftRounds = LEAGUE.rosterSize - LEAGUE.keepersPerTeam; // 21
  LEAGUE.totalPicks = LEAGUE.draftRounds * LEAGUE.teamCount;      // 294
  LEAGUE.totalKeepers = LEAGUE.keepersPerTeam * LEAGUE.teamCount; // 42

  var DEFAULT_TEAM_NAMES = [
    'Eric', 'Dan', 'Cory', 'Doug', 'Matthew', 'Hunter', 'Marc',
    'Nica', 'Clinton', 'Nick', 'Ryan', 'Ken', 'Darren', 'Rick'
  ];
  var DEFAULT_MY_SLOT = 12; // Ken drafts 12th

  var STORAGE_KEY = 'hockeydraft26.state.v1';

  /* ---------------------------------------------------------------- snake */

  // Slot (1-based) that owns pick number n (1-based). Odd rounds run 1->14,
  // even rounds run 14->1.
  function slotForPick(n) {
    var round = Math.floor((n - 1) / LEAGUE.teamCount); // 0-based
    var i = (n - 1) % LEAGUE.teamCount;
    return round % 2 === 0 ? i + 1 : LEAGUE.teamCount - i;
  }

  function roundForPick(n) {
    return Math.floor((n - 1) / LEAGUE.teamCount) + 1;
  }

  function pickInRound(n) {
    return ((n - 1) % LEAGUE.teamCount) + 1;
  }

  function pickLabel(n) {
    return roundForPick(n) + '.' + String(pickInRound(n)).padStart(2, '0');
  }

  // First pick number >= from that belongs to slot. Null once the draft ends.
  function nextPickForSlot(slot, from) {
    for (var n = Math.max(1, from); n <= LEAGUE.totalPicks; n++) {
      if (slotForPick(n) === slot) return n;
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

  function makeTeams(names) {
    var out = [];
    for (var i = 0; i < LEAGUE.teamCount; i++) {
      out.push({ id: i, slot: i + 1, name: (names && names[i]) || DEFAULT_TEAM_NAMES[i] });
    }
    return out;
  }

  function freshState() {
    return {
      v: 1,
      teams: makeTeams(DEFAULT_TEAM_NAMES),
      mySlot: DEFAULT_MY_SLOT,
      keepers: {},   // playerId -> teamId
      picks: [],     // [{ playerId, teamId, n }] in pick order
      setupDone: false
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      var s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.teams) || s.teams.length !== LEAGUE.teamCount) {
        return freshState();
      }
      s.keepers = s.keepers || {};
      s.picks = Array.isArray(s.picks) ? s.picks : [];
      return s;
    } catch (err) {
      // Corrupt or unavailable storage should never block draft day.
      console.warn('Could not load saved draft state; starting fresh.', err);
      return freshState();
    }
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    var made = state.picks.length;
    var current = made + 1;
    var complete = current > LEAGUE.totalPicks;
    var onClockSlot = complete ? null : slotForPick(current);
    var onClockTeam = complete ? null : teamBySlot(state, onClockSlot);
    var onClockIsMe = !complete && onClockSlot === state.mySlot;

    // When Ken is on the clock his "next turn" is the wheel back around —
    // that is the horizon worth drawing on the board.
    var from = onClockIsMe ? current + 1 : current;
    var target = complete ? null : nextPickForSlot(state.mySlot, from);

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
    STORAGE_KEY: STORAGE_KEY,
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
