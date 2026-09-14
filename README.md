# Draft Day 26

Mobile-first, installable PWA for a 14-team fantasy hockey keeper snake draft.
Static site, no build step, works fully offline once loaded.

Live @ https://kenpeterson2112.github.io/hockeydraft26/

## League rules encoded in the app

| | |
|---|---|
| Teams | 14, snake order |
| Ken's slot | 12th |
| Keepers | 3 per team (42 total), pre-owned, **cost no pick** |
| Drafted rounds | 21 (24 roster spots − 3 keepers) |
| Total live picks | 294 |
| Roster | 15 F / 6 D / 3 G = 24 |
| Counting | best **12 F** + best **4 D** + best **2 G** = 18 score, 6 sit |
| Skater scoring | 1 pt per goal, 1 per assist |
| Goalie scoring | 2 pts per win, +3 per shutout |

Player projections already reflect that scoring — the app treats `points` as the
season total and never recomputes it from categories.

## Using it on draft day

1. **Setup → Draft order.** The 14 names are pre-filled in order (Eric … Rick,
   Ken 12th). Edit any name; the radio marks which team is yours.
2. **Setup → Keepers.** Pick a team chip, search a player, tap to assign. The
   search box clears and keeps focus after each pick, so 42 keepers can be typed
   straight through. Three slots per team; the counter tracks progress.
3. **Start draft.** The board takes over.
4. **Board.**
   - **Press and hold a row for 1.5 seconds** to draft that player to whoever is
     on the clock. It buzzes on press, again at the halfway mark, and twice on
     commit. A panel appears above your finger naming the player and,
     in large type, the team the pick will go to, with a progress bar filling
     left to right; the pick commits when the bar completes. Sliding your finger more than 12px cancels it, so
     scrolling never drafts anyone by accident.
   - **Tap a row** to open the sheet and assign the pick to a different team.
   - **Undo** is in the header and on every toast.
   - **The + beside the team name** handles a player who is not in the
     rankings at all. Enter position, name and a projected points figure
     (defaults to 45) and it drafts straight to the team on the clock.

   The hold duration is `HOLD_MS` in `js/app.js`.
   When it is your turn the whole header turns purple and the line reads
   **"You're up! Next selection in X picks."** in white.
5. **Teams.** Your team is pinned to the top; the other 13 rank by effective
   total, so the tab reads as live standings and re-orders as picks land. Each
   card shows effective total, raw total and positional counts. Tap one to
   expand the roster — benched (non-counting) players are dimmed.

### Sorting

There is no sort control — the **column headers are the sort buttons**: **#**,
**ADP**, **VORP**, **Pts**. Tapping one sorts by it most-desirable-first (ADP
low→high, VORP and points high→low); tapping the active column again reverses.
An arrow marks the active column and direction.

**#** sorts by *board order* — tier, then VORP, then points — which is both the
default and how tier sorting stays reachable now that tier has no column of its
own. The number in that column is the canonical board rank, not the row's
position in the current view, so under an alternate sort it reads
non-contiguously (1, 4, 5, 19…). That is deliberate: it tells you where a player
sits on the real board while you look at an ADP- or points-ordered view.

Players with no ADP sort to the bottom in **both** directions — an absent value
is not a good one, and it is not a bad one either.

### The "next pick" divider

Two things are shown, because they answer different questions.

**The dashed purple line is a ruler.** It sits exactly N rows down, N being the
picks between now and Ken's next turn, so the wait can be counted straight off
the screen. It does not move when the position filter or the sort changes —
the number of picks until your turn does not depend on what you are looking at.
When Ken is on the clock it counts to the wheel, his *following* pick, which is
the decision that actually matters.

**The purple rank numbers are the projection.** A player's rank number turns
purple when their canonical board rank falls inside that horizon — they are
expected to be gone. (A row tint carried this originally; layered under the
positional tint it muddied the colour that matters more, so only the number
carries it now.) This is measured against the **full combined board**, not
the filtered view, because opponents can take any position. Filter to defence
and you see exactly which defencemen you expect to lose, which is usually fewer
than N.

On an unfiltered board in the default sort the two coincide: N rows above the
line, all purple-numbered. They diverge under a filter, and each stays honest — the line
keeps counting picks, the shading keeps naming players.

### The position filter chips

Each F / D / G chip carries three things:

```
 2/15      F      (3)
 ^ yours   ^ pos   ^ best tier left
```

- **Left** — how many of that position are on *your* roster, out of the limit
  (15 F / 6 D / 3 G). Keepers count. It turns green once the position is full.
  It can read over the limit, e.g. 4/3, because the app warns about an
  over-limit pick but never blocks one.
- **Centre** — the position letter.
- **Right** — the tier badge, below.

The **number** in the badge is
the lowest-numbered tier that still has at least one unowned player at that
position. The **ring colour** reports how many players remain in that tier —
it warns that a run is ending, not which tier it happens to be:

| Left in the tier | Ring | Meaning |
|---|---|---|
| 7 or more | green | plenty left, you can wait |
| 4 to 6 | amber | thinning |
| 1 to 3 | red | nearly gone |

Keepers count as owned, so the badges reflect keeper losses on pick 1. Long-press
or hover a chip for the exact count ("6 tier 1 forwards left").

With a full pool nothing starts red — the deepest a tier ever opens is 6 at
tier 1 forwards, so red only appears once a run is genuinely ending, which is
when it matters.

The badge is a thick coloured ring over a constant dark fill, with a dark halo
outside it. A solid fill, or a bare ring, collides with the chip's own position
colour when the two match — a green ring vanishes on a selected F chip, amber on
a selected G — losing the signal. Framed by dark on both sides it reads in every
chip state.

### Off-board picks

Someone will take a player who is not in the 403. The **+** next to the team on
the clock opens a short form — position, name, projected points, defaulting to
45 — and drafts them immediately.

A hand-entered player is stored in the draft state, never in
`data/players.json`, and is registered only in the id lookup rather than the
rankings array, so it can never appear on the board — it has no tier, VORP or
ADP to be ranked by. It shows on the team's roster marked `+`, and counts
towards that team's effective total like any other player.

Typing a name that *is* in the rankings drafts the ranked player instead of
creating a second copy of them; if that player is already owned, it says so and
does nothing. Undoing the pick removes the hand-entered player rather than
leaving it orphaned, and every reset scope clears them.

### Search

Name search deliberately **overrides** the position filter and shows drafted
players too — it is a "jump to this player" action. Accents and punctuation are
folded, so `stutzle` finds Stützle and `oreilly` finds O'Reilly.

### No pull-to-refresh

A draft is a lot of up-and-down scrolling, and an accidental refresh mid-draft
is pure annoyance. `overscroll-behavior` handles Chrome and Safari 16+, but the
guarantee is structural: the shell is exactly viewport height with
`overflow: hidden`, and scrolling happens inside the active `.view`. The
document itself never scrolls, so a downward drag at the top has nothing to
pull on, in any browser. Each tab scrolls independently and keeps its own
position.

Nothing would be lost to a refresh anyway — state is in `localStorage` — but
scroll position and momentum would be.

## Mock draft mode

**Setup → Mock draft → Mock draft** switches the whole app onto a practice
draft. Everything works exactly as it does live, except the other 13 teams draft
themselves on a timer.

A mock **cannot touch the live draft**, by construction and not by care:

- The two drafts are separate records in `localStorage` —
  `hockeydraft26.state.v1` and `hockeydraft26.mock.v1`. Every read and write
  goes through the key for the mode that is active, so there is no code path
  from a mock to the live record at all.
- Starting a mock **copies** the teams, the draft slot and all 42 keepers out of
  the live draft. Nothing is written back. Re-entering 42 keepers for a practice
  run would be tedious, and a mock missing them would be wrong — 42 players
  would be available who are not.
- Mock mode is unmissable: an amber **MOCK** badge beside the pick number and an
  amber rule under the whole top bar, deliberately unlike the purple "your turn"
  treatment.

The active mode is remembered, so a reload mid-mock returns to the mock.

### The clock

The strip above the board is the whole control set:

| | |
|---|---|
| **Start / Pause / Resume** | Runs the other teams on the timer |
| **Step** | Exactly one bot pick, then stop |
| **Skip to me** | Runs straight through to your next turn with no waiting |
| **Speed** | 0.5s to 5.0s per pick, default 2.0s, adjustable mid-draft |

**When you are on the clock the timer stops.** It restarts by itself the moment
you draft — no button. The purple "You're up!" header is the same one the live
draft uses. An undo pauses the clock, on the assumption that undoing means you
want a moment.

Three things it deliberately will not do:

- **Draft over a press.** A bot pick rebuilds the rows, which would cancel a
  hold in progress, so a tick that lands during a press is skipped and the
  countdown restarts when your finger lifts.
- **Bank up picks.** The clock is driven by elapsed time and consulted every
  100ms, so at most one pick happens per tick however long the gap.
- **Run in your pocket.** It pauses when the tab is hidden and resumes when you
  come back, so locking the phone does not cost you forty picks.

### How the bots pick

For the team on the clock, over every available ranked player at a position
that team can still fill (`js/bot.js`):

| Term | Effect |
|---|---|
| **ADP** | The base. A player with no ADP is treated as late (360), not missing |
| **Need** | Unfilled *counting* slots (12F/4D/2G) weigh far more than bench slots — a team at 0/2 G reaches for a goalie |
| **Scarcity** | The best tier still open at the position: ≤3 left pulls picks forward hard, ≤6 mildly |
| **Value** | VORP relative to the best on the board, so it is not purely public consensus |

These combine into an *effective draft position* — lower is better — and the
pick is drawn **weighted-randomly from the best five** rather than always taking
the top one. That is what makes running a second mock worth the time: with the
same keepers, two runs from different seeds differ in roughly nine picks out of
ten.

Bots respect the roster limits, so nobody ends up with twenty forwards; every
team finishes 15F/6D/3G exactly. They draft only from the ranked pool —
off-board picks stay a manual affair.

### The transcript

**Copy transcript** is the primary action; a blob download in a standalone iOS
PWA is unreliable, and the point is to paste it into Claude anyway. **Save
.txt** is there when a file is wanted.

It is plain text and self-describing — the header states the scoring, the roster
rule, the keeper rule and which team is yours, so it can be critiqued with no
other context. It contains the keepers by team, all 294 picks numbered `#1` to
`#294` with the bot's stated reason for each (`need 0/2 G · 3 left in G tier 4 ·
ADP 66`), your own picks marked `[your pick]`, your final roster split into
counting and bench, and the final standings by effective total.

It works mid-draft too, so a partial run can be handed over for a read on the
first few rounds.

**New mock** starts over with the keepers copied fresh from the live draft.

## State and offline

### Resetting between simulated drafts

**Setup → Reset…** opens a modal with three scopes:

Reset, and Backup below it, act on **whichever draft is active**. Resetting or
importing inside a mock never reaches the live draft, and vice versa.

| Scope | Clears | Keeps |
|---|---|---|
| Clear picks only | Picks | Keepers, team names, stays on the board |
| Cancel the current draft | Picks, returns to setup | Keepers, team names |
| Clear everything | Picks, keepers, team names → defaults | Nothing but the player pool |

"Clear everything" takes two taps to confirm; the other two act immediately so
re-running a sim stays fast. **No scope ever touches `data/players.json`** —
names, tiers, VORP and projected points are read-only to the app.

Everything (team names, keepers, picks, progress) is written to `localStorage`
on every change, so a refresh or a phone lock loses nothing. A service worker
precaches the whole app including the player data, so once the page has loaded
one time it runs with no connection at all. **Load it once on wifi before the
draft.** Setup → Backup exports/imports the state as JSON if you want a copy.

### Updating an installed copy

The service worker is cache-first so the draft works offline, which means an
installed copy keeps serving its cached build. **Setup → App → Check for
update** fetches `sw.js`, compares its `CACHE_VERSION` to the running
`APP_VERSION`, and only then clears the caches, unregisters the worker and
reloads. Draft state is in `localStorage` and is never touched.

It refuses to clear anything unless the network actually answered — the offline
check is a fast path, but the real guard is that the teardown only runs inside
a resolved `fetch`. Tapping it offline, or with the server down, leaves the
cached copy exactly as it was.

`sw.js` is deliberately excluded from the worker's own fetch handling. The
cache-first branch matches with `ignoreSearch`, so a cached response to the
first cache-busted probe would be served to every later one, freezing the
reported version and making the update check work exactly once.

Keep `APP_VERSION` and `CACHE_VERSION` in step — the unit suite fails if they
drift, since a mismatch either hides a real update or claims one forever.

## Data

`data/players.json` — 403 rated players (239 F / 100 D / 64 G):

```json
{ "id": "connor-mcdavid", "name": "Connor McDavid", "position": "F",
  "team": "EDM", "tier": 1, "vorp": 95.69, "points": 130.69, "adp": 1.6 }
```

Draft state is not stored in this file; the app owns it separately. To refresh
projections, replace the file keeping the same `id` values — any saved keeper or
pick whose id disappears is dropped on load rather than corrupting the draft.

## Deploying

**One-time setup:** repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**. The workflow token is not allowed to enable Pages itself, so
the first deploy fails with *"Get Pages site failed"* until this is set. After
that, every push to `main` publishes via `.github/workflows/pages.yml` — re-run
the failed workflow once to publish immediately.

Live at `https://kenpeterson2112.github.io/hockeydraft26/`. All asset paths are
relative, so it works from the project-page subpath.

Bump `CACHE_VERSION` in `sw.js` whenever you change assets, or clients keep
serving the cached copy.

## Local development

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

A server is required — `file://` cannot fetch the player JSON or register the
service worker.

## Layout

```
index.html          shell: header, tabs, board / teams / setup views
css/app.css         mobile-first dark theme
js/draft.js         league rules, snake math, scoring, persistence  (no DOM)
js/bot.js           how an auto-drafted team picks                  (no DOM)
js/mock.js          the mock clock: run, pause, step, skip          (no DOM)
js/ui.js            DOM helpers, toast, bottom sheet
js/app.js           controller: state, board derivation, rendering, events
data/players.json   403-player pool
sw.js               offline precache
```
