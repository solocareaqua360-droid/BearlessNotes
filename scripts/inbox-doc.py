#!/usr/bin/env python3
"""Hand a document (a .md file) to mindEva: it becomes a NOTE in a folder named after the app, made by the signed-in Mac app as the user.

Writes ~/Library/Application Support/mindEva/state/inbox-docs.json - the file the Mac app reads every few seconds
(src/utils/inboxDocsBridge.web.ts). The app must be open to apply it. A document is made once per key (default: app + file name + content
hash), so sending the same file again does nothing; a changed file is a new note.

  python3 scripts/inbox-doc.py add noiseEva /path/to/research.md [--title "Назва нотатки"] [--key custom-key]
  python3 scripts/inbox-doc.py list
"""
import argparse, hashlib, json, os, sys, tempfile, time

PATH = os.path.expanduser('~/Library/Application Support/mindEva/state/inbox-docs.json')


def load():
    try:
        with open(PATH, encoding='utf-8') as f:
            return json.load(f).get('docs', [])
    except (FileNotFoundError, ValueError):
        return []


def save(docs):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(PATH))
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump({'docs': docs}, f, ensure_ascii=False)
    os.replace(tmp, PATH)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('add'); a.add_argument('app'); a.add_argument('file'); a.add_argument('--title'); a.add_argument('--key')
    sub.add_parser('list')
    args = ap.parse_args()
    docs = load()
    if args.cmd == 'list':
        for d in docs:
            print(f"{d['key']}  [{d['app']}]  {d.get('title') or ''}  ({len(d['text'])} зн.)")
        return
    text = open(os.path.expanduser(args.file), encoding='utf-8').read()
    key = args.key or f"{args.app}:{os.path.basename(args.file)}:{hashlib.sha1(text.encode()).hexdigest()[:10]}"
    if any(d['key'] == key for d in docs):
        print('already queued:', key); return
    docs.append({'key': key, 'app': args.app, 'title': args.title, 'text': text, 'at': int(time.time())})
    save(docs)
    print(f"ok: {args.app} <- {os.path.basename(args.file)} ({len(text)} зн.) -> {PATH}")


main()
