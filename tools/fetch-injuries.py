#!/usr/bin/env python3
"""fetch-injuries.py — pull the NHL injury report from ESPN into data/injuries.json.

    python3 tools/fetch-injuries.py            fetch and write
    python3 tools/fetch-injuries.py --dry-run  fetch and report, write nothing

Reads the JSON feed behind https://www.espn.com/nhl/injuries (the page renders
from it) and keeps only players in data/players.json, keyed by the same ids
the rest of the app uses. The app loads the file on start and shows a status
badge on each injured player's row; commit and push it to publish.

Names are matched accent- and punctuation-free. When one name fits two pool
players (this pool has two Elias Petterssons) position decides, then team.
When no full name fits, last name + team + position is tried, and used only
if exactly one pool player fits: ESPN writes "Alexander Nikishin" where the
projections say "Alex".
Anyone on ESPN's list who is not in the pool is simply not drafted here, so
they are counted rather than listed; ambiguous matches are listed, because a
wrong match puts an injury on a healthy player.

Kept per player: status, injury type, expected return, ESPN's date, and its
one-line comment. The long-form write-up is left on ESPN.
"""

import datetime
import json
import os
import re
import sys
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAYERS = os.path.join(ROOT, 'data', 'players.json')
OUT = os.path.join(ROOT, 'data', 'injuries.json')

FEED = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'
PAGE = 'https://www.espn.com/nhl/injuries'


def fold(name):
    name = re.sub(r'\s*\((?:D|G)\)\s*$', '', name)  # "Elias Pettersson (D)"
    s = unicodedata.normalize('NFKD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', s.lower())


def pos_of(abbr):
    abbr = (abbr or '').upper()
    return abbr if abbr in ('D', 'G') else 'F'


# ESPN's own words vary by field; one short code per state is what fits a row.
def status_of(entry):
    kind = ((entry.get('type') or {}).get('abbreviation') or '').upper()
    fantasy = (((entry.get('details') or {}).get('fantasyStatus') or {})
               .get('abbreviation') or '').upper()
    if fantasy == 'IR-LT':
        return 'IR-LT'
    if kind == 'IR' or fantasy == 'IR':
        return 'IR'
    if kind == 'SUSP':
        return 'SUSP'
    if kind == 'DD' or fantasy == 'DAY-TO-DAY':
        return 'DTD'
    return 'O'


# Some entries carry only a status word as their comment; the badge already
# says that, so an empty note is more honest than a repeated one.
def note_of(entry):
    note = (entry.get('shortComment') or '').strip()
    return '' if note.lower().rstrip('.') in ('out', 'day-to-day', 'ir', 'suspended') else note


def fetch():
    # Python's own User-Agent. ESPN's edge answers a made-up one with a 403.
    with urllib.request.urlopen(FEED, timeout=30) as res:
        return json.load(res)


def main():
    with open(PLAYERS, encoding='utf-8') as fh:
        pool = json.load(fh)
    by_name, by_last = {}, {}
    for p in pool:
        by_name.setdefault(fold(p['name']), []).append(p)
        words = re.sub(r'\s*\((?:D|G)\)\s*$', '', p['name']).split()
        key = (fold(words[-1]), p['team'].replace('.', ''), p['position'])
        by_last.setdefault(key, []).append(p)

    data = fetch()
    entries = [i for team in data.get('injuries', []) for i in team.get('injuries', [])]

    out, outside, unsure = {}, 0, []
    for e in entries:
        a = e.get('athlete') or {}
        name = a.get('displayName') or ''
        cands = by_name.get(fold(name), [])
        if not cands:
            key = (fold(a.get('lastName') or name.split()[-1]),
                   ((a.get('team') or {}).get('abbreviation') or '').upper(),
                   pos_of((a.get('position') or {}).get('abbreviation')))
            loose = by_last.get(key, [])
            if len(loose) == 1:
                cands = loose
                print('matched %s -> %s (%s) by last name and team' % (
                    name, loose[0]['name'], key[1]))
        if len(cands) > 1:
            pos = pos_of((a.get('position') or {}).get('abbreviation'))
            cands = [p for p in cands if p['position'] == pos] or cands
        if len(cands) > 1:
            team = ((a.get('team') or {}).get('abbreviation') or '').upper()
            cands = [p for p in cands if p['team'].replace('.', '') == team] or cands
        if not cands:
            outside += 1
            continue
        if len(cands) > 1:
            unsure.append(name)
            continue
        details = e.get('details') or {}
        out[cands[0]['id']] = {
            'status': status_of(e),
            'injury': details.get('type') or '',
            'return': details.get('returnDate') or None,
            'updated': (e.get('date') or '')[:10] or None,
            'note': note_of(e),
        }

    counts = {}
    for v in out.values():
        counts[v['status']] = counts.get(v['status'], 0) + 1
    print('%d on ESPN\'s list · %d in the pool (%s) · %d not in the pool' % (
        len(entries), len(out),
        ', '.join('%d %s' % (n, s) for s, n in sorted(counts.items())), outside))
    if unsure:
        print('SKIPPED, ambiguous: %s' % ', '.join(unsure))
    for pid in sorted(out, key=lambda i: next(p['name'] for p in pool if p['id'] == i)):
        v = out[pid]
        print('  %-6s %-24s %s%s' % (v['status'], pid, v['injury'],
                                     ' · back ' + v['return'] if v['return'] else ''))

    if '--dry-run' in sys.argv:
        print('dry run — nothing written')
        return

    doc = {
        'source': 'ESPN',
        'url': PAGE,
        'fetched': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'players': {k: out[k] for k in sorted(out)},
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print('wrote', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
