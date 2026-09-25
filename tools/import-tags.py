#!/usr/bin/env python3
"""import-tags.py — build data/tags.json from a tags CSV.

    python3 tools/import-tags.py [tools/tags-source.csv]

CSV columns: id, name, position, team, pp1, goalie_situation, breakout.
A tag column is on when its cell is non-blank (Y, solid, ...). Refuses to
write on an unknown id, a duplicate id, or an unknown column, so a bad file
never half-lands. Kept apart from players.json because import-projections.py
rebuilds that file from scratch.
"""
import csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'tags-source.csv')
TAGS = {'pp1': 'pp1', 'goalie_situation': 'goalie', 'breakout': 'breakout'}

pool = {p['id'] for p in json.load(open(os.path.join(ROOT, 'data', 'players.json'), encoding='utf-8'))}
out, seen, errors = {}, set(), []
with open(SRC, encoding='utf-8-sig', newline='') as fh:
    rows = csv.DictReader(fh)
    extra = set(rows.fieldnames) - set(TAGS) - {'id', 'name', 'position', 'team', 'reason'}
    if extra:
        sys.exit('unknown column(s): %s' % ', '.join(sorted(extra)))
    for r in rows:
        pid = (r['id'] or '').strip()
        if pid not in pool: errors.append('unknown id %r' % pid); continue
        if pid in seen: errors.append('duplicate id %r' % pid); continue
        seen.add(pid)
        tags = [key for col, key in TAGS.items() if (r.get(col) or '').strip()]
        if tags: out[pid] = tags
if errors:
    sys.exit('refusing to write:\n  ' + '\n  '.join(errors))

path = os.path.join(ROOT, 'data', 'tags.json')
with open(path, 'w', encoding='utf-8') as fh:
    json.dump({'v': 1, 'players': out}, fh, ensure_ascii=False, indent=1, sort_keys=True)
    fh.write('\n')
counts = {k: sum(k in t for t in out.values()) for k in TAGS.values()}
print('Wrote %s: %d tagged players %s' % (path, len(out), counts))
