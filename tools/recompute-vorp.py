#!/usr/bin/env python3
"""recompute-vorp.py — rebuild VORP from projected points and a per-position
replacement baseline.

    vorp = points - BASELINE[position]

The baseline is the points a replacement-level player at that position is
expected to score — what is actually sitting on the wire. A LOWER baseline
means a shallower pool behind that position, which makes every starter there
worth more, so VORP goes up.

Usage:
    python3 tools/recompute-vorp.py --dry-run   report, write nothing
    python3 tools/recompute-vorp.py             rewrite data/players.json

Only `vorp` is ever touched, and that is enforced rather than asserted: the
script diffs every other field before writing and refuses if any moved.

Written in Python rather than Node for one specific reason. data/players.json
is minified with no trailing newline and carries values like "adp":19.0.
JSON.stringify collapses that to 19 — semantically identical, cosmetically a
rewrite of ~88 bytes of a field this script has no business touching. Python's
json with separators=(',', ':') and ensure_ascii=False round-trips the file
byte-for-byte, accented names included.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, 'data', 'players.json')
DRY = '--dry-run' in sys.argv

# Points a replacement-level player at this position is expected to score.
# Change these and re-run; nothing else in the app needs to know.
BASELINE = {'F': 43.0, 'D': 29.0, 'G': 38.0}

# Exactly the original file's encoding. Any deviation rewrites bytes we do not
# own, so these two arguments are load-bearing, not style.
DUMP = dict(separators=(',', ':'), ensure_ascii=False)


def main():
    with open(FILE, encoding='utf-8') as fh:
        raw = fh.read()
    players = json.loads(raw)

    if json.dumps(players, **DUMP) != raw:
        sys.exit('refusing to write: re-encoding this file is not byte-stable, '
                 'so a write would change more than vorp')

    before = [dict(p) for p in players]

    implied = {}
    for p in players:
        implied.setdefault(p['position'], set()).add(round(p['points'] - p['vorp'], 2))

    for p in players:
        if p['position'] not in BASELINE:
            sys.exit('unknown position %r on %s' % (p['position'], p['id']))
        if not isinstance(p['points'], (int, float)):
            sys.exit('%s has no usable points' % p['id'])
        p['vorp'] = round(p['points'] - BASELINE[p['position']], 2)

    # Nothing but vorp may move. Ids especially: they are the join key for every
    # saved keeper, pick and note, and a change would silently drop them on load.
    if [p['id'] for p in before] != [p['id'] for p in players]:
        sys.exit('refusing to write: id set or order changed')
    for old, new in zip(before, players):
        for k in old:
            if k != 'vorp' and old[k] != new[k]:
                sys.exit('refusing to write: %s changed on %s' % (k, old['id']))
        if sorted(old) != sorted(new):
            sys.exit('refusing to write: schema changed on %s' % old['id'])

    print('replacement baseline (points subtracted), old -> new:')
    for pos in ('F', 'D', 'G'):
        was = sorted(implied.get(pos, []))
        if len(was) == 1:
            shift = BASELINE[pos] - was[0]
            print('  %s: %5.1f -> %5.1f   every %s vorp shifts %+.1f'
                  % (pos, was[0], BASELINE[pos], pos, -shift))
        else:
            print('  %s: %d different values -> %5.1f' % (pos, len(was), BASELINE[pos]))

    changed = sum(1 for o, n in zip(before, players) if o['vorp'] != n['vorp'])
    print('\n%d of %d vorp values changed; every other field byte-identical.'
          % (changed, len(players)))
    print('%d now below replacement (the bot floors those at zero value).'
          % sum(1 for p in players if p['vorp'] < 0))

    if DRY:
        print('\n--dry-run: nothing written.')
        return

    with open(FILE, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(players, **DUMP))
    print('\nWrote %s' % FILE)
    print('Now bump APP_VERSION and CACHE_VERSION together, or installed copies keep')
    print('serving the old numbers and the update check correctly reports "up to date".')


if __name__ == '__main__':
    main()
