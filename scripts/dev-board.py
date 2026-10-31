#!/usr/bin/env python3
"""Records for the user's base «розробка» (the dev board), without importing by hand.

Writes ~/Library/Application Support/mindEva/state/dev-board.json - the file the Mac app reads every few seconds and puts into the base
as the user (src/utils/devBoardBridge.web.ts). Nothing is written anywhere else; the app must be open to apply it.

  python3 scripts/dev-board.py add "Назва" --type баг --status вхідне --platform Mac --desc "..."
  python3 scripts/dev-board.py set "Назва або key" --status далі
  python3 scripts/dev-board.py done "Назва або key" [--desc "..."]
  python3 scripts/dev-board.py delete KEY            (only a row this bridge made)
  python3 scripts/dev-board.py list

Types: функція, баг, питання, борг, ідея. Statuses: вхідне, далі, на паузі, зроблено, відкладено. Platforms: Android, Mac, Обидві.
"""
import argparse, json, os, re, sys, tempfile, time
from datetime import date

PATH = os.path.expanduser('~/Library/Application Support/mindEva/state/dev-board.json')


def load():
    try:
        with open(PATH, encoding='utf-8') as f:
            return json.load(f).get('records', [])
    except (FileNotFoundError, ValueError):
        return []


def save(records):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(PATH), suffix='.part')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump({'records': records}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PATH)


def slug(text):
    s = re.sub(r'[^0-9a-zA-Zа-яіїєґА-ЯІЇЄҐ]+', '-', text.strip().lower()).strip('-')
    return s[:60] or str(int(time.time()))


def find(records, ref):
    for r in records:
        if r.get('key') == ref or r.get('title', '').strip().lower() == ref.strip().lower():
            return r
    return None


def today():
    return date.today().strftime('%d.%m.%Y')


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('add', 'set', 'done', 'delete'):
        s = sub.add_parser(name)
        s.add_argument('ref')
        for opt in ('type', 'status', 'platform', 'date', 'desc', 'key'):
            s.add_argument('--' + opt)
    sub.add_parser('list')
    a = p.parse_args()
    records = load()
    if a.cmd == 'list':
        for r in records:
            print(r.get('key'), '|', r.get('title'), '|', r.get('type'), '|', r.get('status'), '|', r.get('platform'), '|', r.get('date'))
        return
    existing = find(records, a.ref)
    fields = {k: v for k, v in {'type': a.type, 'status': a.status, 'platform': a.platform, 'date': a.date, 'description': a.desc}.items() if v}
    if a.cmd == 'delete':
        if not existing:
            sys.exit('no such record')
        existing.clear()
        existing.update({'key': a.ref if not existing.get('key') else a.ref, 'delete': True, 'at': time.time()})
    elif a.cmd == 'add':
        record = existing if existing else {'title': a.ref, 'key': a.key or slug(a.ref)}
        record.setdefault('status', 'вхідне')
        record.update(fields)
        record['at'] = time.time()
        if not existing:
            records.append(record)
    else:  # set / done
        if a.cmd == 'done':
            fields.setdefault('status', 'зроблено')
            fields.setdefault('date', today())
        # Not known to the bridge yet: it is an existing row of the base, found by its title.
        record = existing if existing else {'title': a.ref, 'key': a.key or slug(a.ref)}
        record.update(fields)
        record['at'] = time.time()
        if not existing:
            records.append(record)
    save(records)
    print('ok', len(records), 'records ->', PATH)


main()
