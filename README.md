# Draft Day 26

Mobile-first, installable PWA for a 14-team fantasy hockey keeper snake draft.
Static site, no build step, works fully offline once loaded.

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
2. **Setup → Keepers.** Pick a team chip, search a player, tap to assign. Three
   slots per team, 42 total. The counter tracks progress.
3. **Start draft.** The board takes over.
4. **Board.**
   - **Press and hold a row for 2 seconds** to draft that player to whoever is
     on the clock. A popup appears above your finger reading *"<player> drafted
     by <team>"* with a progress bar filling left to right; the pick commits
     when the bar completes. Sliding your finger more than 12px cancels it, so
     scrolling never drafts anyone by accident.
   - **Tap a row** to open the sheet and assign the pick to a different team.
   - **Undo** is in the header and on every toast.

   The hold duration is `HOLD_MS` in `js/app.js` if 2s feels long once you have
   drafted a few.
5. **Teams.** Live effective total, raw total, and positional counts per team.
   Tap a card to expand the roster — benched (non-counting) players are dimmed.

### Sorting

There is no sort control — the **Tier / VORP / Pts column headers are the sort
buttons**. Tapping one sorts by that column most-desirable-first (tier 1→8,
VORP and points high→low); tapping the active column again reverses it. An
arrow marks the active column and direction.

The **#** column is the *canonical board rank* — tier, then VORP, then points —
not the row's position in the current view. Under an alternate sort the numbers
are therefore non-contiguous (1, 4, 5, 19…), which is deliberate: it tells you
where a player sits on the real board while you are looking at a VORP- or
points-ordered view.

### The "next pick" divider

The dashed purple line marks where the board is projected to stand when Ken is
next up. It counts forward N picks — N being the picks between now and his next
turn — against the **full combined board**, not the filtered view, because
opponents can take any position. Change the position filter and the line stays
anchored to real board depth. When Ken is on the clock it shows the wheel to his
*following* pick, which is the decision that actually matters.

The divider counts against the canonical board rank, so it survives a change of
sort column. It **hides entirely when a column is reversed** into a
worst-first order, where "everyone above this line is gone" would be false.

### Tier badges on the position filters

Each of the F / D / G filter chips carries a coloured circular badge showing the
**lowest-numbered tier that still has at least one unowned player at that
position** — scarcity at a glance, independent of whether the chip is toggled on.
Keepers count as owned, so the badges already reflect keeper losses on pick 1.

The digit carries the meaning; colour reinforces it, running cool at tier 1 to
hot as the position thins out (mint → green → lime → yellow → amber → orange →
red). Luminance falls along the ramp too, so the steps stay distinguishable
without relying on hue discrimination. The badge keeps a solid dark ring because
an active chip is filled with its position colour and some badge colours collide
with it exactly — tier 5 amber is the same value as the goalie chip.

D and G move fastest early: only 4 tier-1 D and 4 tier-1 G exist in the pool.

### Search

Name search deliberately **overrides** the position filter and shows drafted
players too — it is a "jump to this player" action. Accents and punctuation are
folded, so `stutzle` finds Stützle and `oreilly` finds O'Reilly.

## State and offline

### Resetting between simulated drafts

**Setup → Reset…** opens a modal with three scopes:

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

## Data

`data/players.json` — 403 rated players (239 F / 100 D / 64 G):

```json
{ "id": "connor-mcdavid", "name": "Connor McDavid", "position": "F",
  "team": "EDM", "tier": 1, "vorp": 95.69, "points": 130.69 }
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
js/ui.js            DOM helpers, toast, bottom sheet
js/app.js           controller: state, board derivation, rendering, events
data/players.json   403-player pool
sw.js               offline precache
```
