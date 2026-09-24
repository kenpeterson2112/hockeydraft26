# Draft Day 26

Mobile-first, installable PWA for a 14-team fantasy hockey keeper snake draft.
Static site, no build step, works fully offline once loaded.

Live @ https://kenpeterson2112.github.io/hockeydraft26/

## League rules encoded in the app

| | |
|---|---|
| Teams | 14 by default, editable 2–20 |
| Ken's slot | 12th |
| Keepers | 3 per team (42 total), pre-owned, **cost no pick** — the real 2026 list is built in |
| Traded picks | 8, from four off-season trades — built in |
| Drafted rounds | 21 (24 roster spots − 3 keepers) |
| Total live picks | 294 |
| Roster | 15 F / 6 D / 3 G = 24 |
| Counting | best **12 F** + best **4 D** + best **2 G** = 18 score, 6 sit |
| Skater scoring | 1 pt per goal, 1 per assist |
| Goalie scoring | 2 pts per win, +3 per shutout |

Player projections already reflect that scoring — the app treats `points` as the
season total and never recomputes it from categories.

## The 2026 league is built in

`js/league.js` holds the real draft order, all 42 declared keepers and the eight
traded picks, and every fresh draft — live or mock — is seeded from it. Open the
app and there is nothing to type: **Setup** leads with a *Start a draft* card
reading `14 teams · Ken picks 12th · 42/42 keepers · 8 traded picks`.

| Pick | Now held by | Originally |
|---|---|---|
| 2.10 (#24) | Cory | Matthew |
| 6.09 (#79) | Eric | Hunter |
| 9.03 (#115) | Matthew | Cory |
| 9.11 (#123) | Cory | Ryan |
| 14.14 (#196) | Hunter | Eric |
| 15.10 (#206) | Cory | Nick |
| 17.03 (#227) | Nick | Cory |
| 18.12 (#250) | Ryan | Cory |

Every team still holds 21 picks, and none of Ken's moved. A traded pick overrides
the snake in `Draft.ownerSlotForPick`, which the clock, "your pick N away" and
the dividers all go through, so the board is right about who is on the clock at
2.10. The top bar says so: **Cory `via Matthew`**. The list sits under the draft
order in Setup, the mock transcript tags each traded pick, and a mock copies the
trades along with the keepers.

Traded picks are pick *numbers* in a 14-wide snake, so dropping or adding a team
clears them (with a toast saying so) rather than leaving them pointing at the
wrong picks.

Keepers are still editable in Setup. A save from an older build that has **no
picks** in it is an untouched setup, and is replaced by the built-in league on
load; one with picks is left exactly as it was. **Reset → Clear everything**
now resets *to* the 2026 league, not to blanks.

## Starting a draft

**Setup opens with two big buttons**: *Start live draft* in blue and *Start a
mock draft* in amber, the same colours each mode wears everywhere else. Each one
says where its draft stands (`Pick 3.04 · 31 of 294 made`), and whichever mode
is on screen is tagged **Active**. Until a draft is running the same two buttons
also sit on top of the board, under **No draft running**, so the board is never
mistaken for a draft in progress.

- **Start live draft** switches to the live draft and opens the board. You
  enter every pick yourself.
- **Start a mock draft** resumes a mock in progress. Otherwise it starts a fresh
  one from the live league **and starts the clock**. Starting is what you just
  asked for, so there is no second Start button to find.
- **New mock**, **Copy transcript** and **Save .txt** appear under the buttons
  while in mock mode.

## Using it on draft day

1. **Setup → Draft order.** The 14 names are pre-filled in order (Eric … Rick,
   Ken 12th). Edit any name; the radio marks which team is yours.
   **If someone pulls out**, tap the **×** on their row. The slots below close
   up, their keepers go back in the pool, and your own slot follows you rather
   than pointing at whoever inherited the number. **Add team** puts one back.
   The totals move with it — 13 teams is 273 picks and 39 keepers.

   You cannot drop your own team (move your slot first), and the whole control
   locks once a pick exists: every pick was made under a snake order that
   renumbering would invalidate, so 2.03 would quietly become a different pick.
   Reset → *Cancel the current draft* reopens it.

2. **Setup → Keepers.** Already filled from the league file; check it once.
   To change one, pick a team chip, search a player, tap to assign. The
   search box clears and keeps focus after each pick, so 42 keepers can be typed
   straight through. Three slots per team; the counter tracks progress.
3. **Start live draft**, at the top of Setup. The board takes over.
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

### Position colour

The position has to be readable at a glance, not by reading the letter.
Each row carries three signals together. There is a 10px edge bar in the
position colour, and a flat tint across the whole row, so it still shows under
the number columns. The **F / D / G** letter itself is a solid badge. Forwards
are green, defence blue, goalies yellow. The goalie tint runs slightly lower and
is pushed towards yellow, because amber at the other two's strength turns olive
against the navy.

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

### The value heat map

Whichever of **ADP** and **VORP** is *not* the sort key is colour-ramped by
percentile among the players **still remaining**: green at the top, amber
around the 66th percentile, red at the 33rd and below.

That pairing is the point. Sorted by ADP, the VORP colour says what consensus
is missing — a red number beside an early ADP is the market overpaying, a green
number beside a late one is the bargain. Sorted by VORP, the ADP colour says
the same thing from the other side. Under the **#** or **Pts** sort neither is
the key, so both are coloured.

Three deliberate choices:

- **The ramp reads desirability, not magnitude.** Low ADP and high VORP are
  both good, so both columns are green at their best end.
- **The scale is the whole remaining pool, not the filtered view.** Filter to
  goalies and the best one does not jump to green — the question the colour
  answers is "is this good for what is still out there", and that does not
  change because a chip is selected. It does re-scale as picks land: the best
  player left is always green.
- **A missing ADP gets no colour at all**, the same rule the sort follows — an
  absent value is not a good one and it is not a bad one.

Drafted players are off the scale entirely, since the scale is defined over
what remains.

The colour is applied inline rather than through a class, which cannot collide
with the sorted-column rule below — and never has to, because the ramped column
is by definition not the sorted one.

### The queue

A shortlist you order yourself, ported from Yahoo's. Tap a player, then **Add
to queue**; the row then carries **★n** showing where he sits in it. The **★**
chip filters the board to your queue **in your order** — no column sorts it,
because the order is the whole point — and each row gets ▲▼ to move him.

It stays honest without you tending it: anyone drafted, by you or by a bot in a
mock, drops out automatically, and so does anyone you make a keeper. The sheet
will not offer to queue a player who is already owned.

Queueing is done from the player sheet rather than a button on the row. The row
is already a press target for hold-to-draft plus the notes **i**, and a third
target on it would be a mis-draft waiting to happen. The ▲▼ buttons that do sit
on a row are fenced off the same way the **i** is — `attachHold` bails on
anything inside them, so a long press on one drafts nobody.

### The "next pick" divider

Two things are shown, because they answer different questions.

**There are two rulers.** The solid one is your next pick; the fainter one below
is the pick after it. They answer different questions — the first is what you
can still get this turn, the second is what survives to the turn after, which
is what decides whether you can afford to wait. On the wheel those two come
close together; deep in a round they are far apart. The second is deliberately
subordinate: the pick in front of you is the decision being made now, and two
lines shouting equally would flatten that.

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

The four chips are a **radio group, not toggles**: All, forwards, defence,
goalies. Tapping one shows that position and nothing else, so "just the
defencemen" is one tap rather than three. There is no way to end up looking at
an empty board.

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

With the real keepers in, **all three start red**, and correctly so. The 42
keepers take four of the six tier 1 forwards and all four tier 1 defencemen, so
pick 1 opens on 2 tier 2 forwards, 1 tier 2 defenceman and 2 tier 1 goalies.
That is the board telling the truth about the top of this draft.

The badge is a thick coloured ring over a constant dark fill, with a dark halo
outside it. A solid fill, or a bare ring, collides with the chip's own position
colour when the two match — a green ring vanishes on a selected F chip, amber on
a selected G — losing the signal. Framed by dark on both sides it reads in every
chip state.

### Off-board picks

Someone will take a player who is not in the 407. The **+** next to the team on
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

### Player notes and the injury badge

An **i** beside a player's team opens a small popover with what you know about
him: age, height, shoots/catches, last season's line, and a two-or-three
sentence summary. Goalies show **W** and **SO** rather than a skater line, since
those are the only two numbers that score for them here. The injury badge (see
below) opens the same popover, with the injury sitting above the notes, so
either icon gets you the full picture on that player.

The **i** appears only on players you actually have notes for, so it doubles as
"I have research on this guy" and there are no dead taps. A covered player who
is already drafted or kept still carries his — reach him by search, which shows
owned players.

Both icons sit together at the very end of the row's sub-line, past the team
and (if he's owned or queued) that too — grouped, so there is one place on the
row that is always safe to tap regardless of how it is filled in. The row
itself is a press-to-draft target, so each icon is fenced off from it twice:
it stops its own pointer events, and `attachHold` bails on anything inside
`.p-infobtn`, the class both share. Hold either one for five seconds and
nothing is drafted — the popover opens instead, however long the press.
Neither mis-tap is destructive either — aiming at the row and hitting an icon
shows information; aiming at an icon and missing opens the team chooser.

The popover carries its own **Draft to *team* · pick** button, so checking on
a player never has to end in closing it and finding him again in what may
already be a different list underneath. **Choose another team** falls through
to the full sheet's team grid. Both are only offered while he is actually
available to draft; an owned player's popover is read-only. Opening it while a
mock is running pauses the clock — the same call `undoLastPick` makes — so the
button's team and pick number can never go stale while you're reading.

#### The notes never ship with the app

They live in `localStorage` on your device, imported via **Setup → Player
notes**, and `data/notes.json` is gitignored. This is deliberate: much of what
is worth writing down comes from sources like Dobber that are subscriptions
licensed to *you*, not to everyone who can open a public GitHub Pages site.
Keeping the file off the repo means you can research however you like without
republishing anyone's paid product.

No reset scope touches them, and an import reports both how many players
matched and how many unknown ids were dropped rather than failing quietly.

#### Building the file

```sh
cp tools/notes-source.example.json tools/notes-source.json   # write summaries here
node tools/build-notes.mjs                                   # → data/notes.json
node tools/build-notes.mjs --offline                         # summaries only
node tools/build-notes.mjs --limit 120                       # top 120 by ADP
```

It pulls age, height, shoots and last season's line from the NHL public API,
merges your summaries, and caches every response under `tools/.cache/` so
re-runs are free. Names that do not resolve to exactly one NHL player are
**printed for you to fix by hand rather than guessed** — a wrong match is worse
than a gap, and this pool has two Elias Petterssons. A summary written against
an id the pool does not carry is reported too, with the nearest match
suggested, since `tim-stutzle` vs `tim-st-tzle` is an easy slip.

Writing the summaries is the real work, and it is not code. Starting with
`--limit 120` covers everyone actually in play through the rounds that decide
your draft; the **i** simply does not appear for the rest.

### Search

Name search deliberately **overrides** the position filter and shows drafted
players too — it is a "jump to this player" action. Accents and punctuation are
folded, so `stutzle` finds Stützle and `oreilly` finds O'Reilly.

### The board chrome does not scroll

Everything above the list stays put while the list scrolls under it: the mock
clock, the search box, the position chips and the sort headers. Mid-draft you
should never have to scroll back up to change what you are looking at.

It is structural, like the pull-to-refresh suppression below — the board view is
a flex column with `overflow: hidden`, and only `.playerlist` scrolls.
`position: sticky` on each piece was not enough and was quietly wrong: with the
mock strip above it, `.controls` slid up by the strip's height before it caught,
so in mock mode the search box moved after all.

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

**Start a mock draft** (top of Setup, or on the board before anything is
running) switches the whole app onto a practice draft. Everything works exactly as it does live, except the other 13 teams draft
themselves on a timer.

A mock **cannot touch the live draft**, by construction and not by care:

- The two drafts are separate records in `localStorage` —
  `hockeydraft26.state.v1` and `hockeydraft26.mock.v1`. Every read and write
  goes through the key for the mode that is active, so there is no code path
  from a mock to the live record at all.
- Starting a mock **copies** the teams, the draft slot, all 42 keepers and the
  traded picks out of the live draft. Nothing is written back. Re-entering 42 keepers for a practice
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

### Seeing the pick

At two seconds a pick, a toast per pick would be unreadable, so the top bar
carries a **last-pick line** instead, which replaces itself rather than
stacking:

```
1.07  Marc → Tage Thompson                               F T4
```

It names the team that **made** the pick. That matters: the big name in the
clock line is whoever picks *next*, so putting the player beside it would read
as though that team took them.

The line appears with a brief flash and fades over exactly one pick interval —
tracking the speed slider — so it is spent as the next pick lands. With
**Drafted** ticked, the player's row flashes in place too; with it unticked the
row is simply off the board, which is the ordinary case and why the line carries
the signal. Undo, a mode switch, and every reset scope clear it, and it is held
outside the saved state so a reload never replays a stale flash.

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
draft.**

### Backup

**Setup → Backup → Export backup** writes **one dated file holding all three
things worth keeping**: the live draft, the mock draft, and every player note.
Restore puts all three back. The file is plain JSON — share it to Drive from
the download and the copy is off-device.

Earlier builds exported only the active draft, which meant the notes were not
backed up at all and hitting Export in mock mode quietly saved the practice
draft. A bare state file from one of those builds still restores, and restoring
one leaves your notes alone.

Nothing is written until the whole file has been validated, so a corrupt or
truncated backup cannot leave one draft restored and the other clobbered.

The app also asks the browser for **persistent storage** on load. Chrome's
default is "best-effort", which it may clear when the device runs low on space;
persistent storage is exempt, and Chrome grants it silently for an installed
PWA. It is strictly an upgrade — a refusal, or a browser without the API,
leaves behaviour exactly as it was. Export a backup anyway.

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

## Draft size

The team count is **not** a constant — it lives in each draft's own state, and
the live and mock drafts can differ. That matters more than it sounds:

- Every snake function takes the size explicitly — `slotForPick(n, teams)`,
  `pickLabel(n, teams)`. They used to read a module constant, which was fine
  while 14 was the only answer, but the app now holds two drafts at once and a
  shared mutable count would compute one draft's order at the other's width.
- `Draft.totalPicks(state)` and `Draft.totalKeepers(state)` derive from
  `state.teams.length`, so the stored size and the derived totals cannot drift
  apart.
- `load()` accepts any width between `minTeams` and `maxTeams`. It used to
  reject anything that was not exactly 14 **and silently replace it with a
  blank draft** — harmless while the number was fixed, a data-loss bug the
  moment it became editable.

## Data

### VORP and replacement baselines

`vorp` is not an independent projection — it is `points` minus a
**replacement baseline** for that position:

| Position | Baseline |
|---|---|
| F | 35.0 |
| D | 25.5 |
| G | 36.5 |

The baseline is what a replacement-level player at that position is expected to
score — what is actually sitting on the wire. A **lower** baseline means a
shallower pool behind the position, which makes every starter there worth more,
so VORP goes up.

`python3 tools/recompute-vorp.py` rebuilds every value from the baselines at the
top of that script; `--dry-run` reports without writing. It touches `vorp` and
nothing else, and enforces that rather than asserting it — it diffs every other
field and refuses to write if one moved. Ids especially: they are the join key
for every saved keeper, pick and note, so a change there would silently drop
them on the next load.

It is Python rather than Node for one specific reason. This file is minified
with no trailing newline and carries values like `"adp":19.0`;
`JSON.stringify` collapses that to `19` — the same number, but a rewrite of
bytes the script has no business touching. Python with
`separators=(',', ':')` and `ensure_ascii=False` round-trips the file
byte-for-byte, accented names included, and the script verifies that before it
writes anything.

Bump `APP_VERSION` and `CACHE_VERSION` after any change here, or installed
copies keep serving the old numbers and the update check correctly reports
"up to date".

`data/players.json` — 407 rated players (237 F / 106 D / 64 G):

```json
{ "id": "connor-mcdavid", "name": "Connor McDavid", "position": "F",
  "team": "EDM", "tier": 1, "vorp": 95.41, "points": 130.41, "adp": 1.5 }
```

Draft state is not stored in this file; the app owns it separately.

### Refreshing projections

```sh
pip install openpyxl
python3 tools/import-projections.py projections.xlsx --adp adp.xlsx --dry-run
python3 tools/import-projections.py projections.xlsx --adp adp.xlsx
```

Both workbooks are in the Fantasy folder on Drive. `projections.xlsx` has a
`skaters` sheet (NAME, POS, TEAM, ADP, …, G, A, PTS) and a `goalies` sheet
(NAME, POS, TEAM, AGE, ADP, W, SO). `adp.xlsx` has NAME, YAHOO ADP, FANTRAX ADP
and **AVG ADP**, and AVG ADP is the one used. Columns are found by header, so a
reordered sheet still reads.

| Field | From |
|---|---|
| `points` | Skaters: PTS. Goalies: 2 × W + 3 × SO, the league's scoring |
| `vorp` | points − the baselines above |
| `tier` | Fixed point bands per position, below |
| `adp` | AVG ADP from `adp.xlsx`; "—" becomes no ADP |

| Tier lower bound | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| F | 100 | 90 | 80 | 70 | 61 | 50 | 42 |
| D | 80 | 65 | 55.5 | 50 | 45.5 | 40 | 31 |
| G | 72 | 65 | 61 | 50 | 41 | 36 | 32 |

Anything below the last band is tier 8. The bands are the previous pool's cut
lines, so "tier 3" keeps its meaning across refreshes and the scarcity rings read
the same.

**Who is in the pool:** every goalie, every skater with an ADP in
`projections.xlsx`, and skaters without one who project at least 32 (F) or 22.5
(D). That is roughly the depth a 14-team draft reaches. Inclusion uses the
projections' ADP, not `adp.xlsx`, which lists nearly every NHL skater and would
pull in hundreds of fourth-liners.

**Ids never move.** They are the join key for every saved keeper, pick, queue
entry and note, so a player already in the pool keeps his id and only a new
player gets one. The script lists who arrived, who left and who changed team.
It refuses to write if any keeper in `js/league.js` would go missing.

**Errata** in the source are fixed in the script, not by hand afterwards. The
workbook lists the Canucks *forward* Elias Pettersson as a D (his line is 20 G
/ 41 A). The real defenceman is the row named "Elias Pettersson (D)".

**Why `--adp`.** The projections workbook's own ADP is Yahoo's alone, and it
stops around pick 153. That left 158 of the 407 with no ADP. The bots price a
missing ADP as pick 360, so 60-point forwards like Jared McCann sank below
30-point players who had one, and the ADP sort buried them. AVG ADP (Yahoo and
Fantrax averaged, Fantrax alone past Yahoo's range) runs to about 294 and
covers the whole pool. Across six seeded mocks it moved McCann from about pick
180 to 130 and Luke Evangelista from 185 to 140, and it left no player worth
more than 10 VORP undrafted.

The bots still follow the market where it disagrees with the projections. Bo
Horvat is projected for 41 games, but his ADP is 120, and he goes around 120.
That is by design: a mock is practice against people who draft by ADP.

## Injuries

```sh
python3 tools/fetch-injuries.py            # fetch ESPN, write data/injuries.json
python3 tools/fetch-injuries.py --dry-run  # report only
```

This pulls the report behind <https://www.espn.com/nhl/injuries> (the page is
rendered from ESPN's JSON feed, which is what the script reads). It keeps only
players in the pool and writes `data/injuries.json`, keyed by the same ids.
Commit and push it to publish, since the file ships with the app like
`players.json`, and installed copies pick it up through **Check for update**.

On the board, an injured player's row carries a solid badge beside his team:

| Badge | Meaning |
|---|---|
| **OUT** (red) | Out |
| **IR** (red) | Injured reserve |
| **LTIR** (red) | Long-term IR |
| **DTD** (amber) | Day-to-day |
| **SUSP** (grey) | Suspended |

The badge is its own tap target — see [Player notes and the injury
badge](#player-notes-and-the-injury-badge) — and opens a popover with the
injury, expected return, ESPN's one-line note and date, and a button to draft
him right from there. Setup → App says when the report was fetched, and the
mock transcript tags injured picks. The file is optional: if it is missing or
unreadable, the board loads without badges.

Matching is by accent-free name. Position then team decide between two players
with the same name. If no full name fits, the script tries last name + team +
position, and uses that only when exactly one player fits. ESPN writes
"Alexander Nikishin" where the projections say "Alex". An ambiguous name is
skipped and listed, never guessed, because a wrong match puts an injury on a
healthy player.

The bots do not avoid injured players. That is deliberate for now: whether a
two-week injury matters in a full-season league is a judgement, not a rule.

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
js/league.js        the real 2026 order, keepers and traded picks   (data)
js/draft.js         league rules, snake math, scoring, persistence  (no DOM)
js/bot.js           how an auto-drafted team picks                  (no DOM)
js/mock.js          the mock clock: run, pause, step, skip          (no DOM)
js/ui.js            DOM helpers, toast, bottom sheet
js/app.js           controller: state, board derivation, rendering, events
data/players.json   407-player pool
data/injuries.json  ESPN injury report for the pool
data/notes.json     scouting notes — gitignored, imported on device
tools/build-notes.mjs   builds notes.json from the NHL API + your summaries
tools/recompute-vorp.py rebuilds vorp from points and per-position baselines
tools/import-projections.py  rebuilds players.json from the projections workbook
tools/fetch-injuries.py      writes injuries.json from ESPN
sw.js               offline precache
```
