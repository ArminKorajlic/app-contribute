#!/usr/bin/env python3
"""Print the chat card for prepared contributions. No writes.

The card is the chat's live view of its contributions. On a Möbius that runs
it (`rows-v2`), the card shows what the ledger says now: the records it names,
followed to their current version and kept only when they belong to the chat
the card is shown in, each as its title over its project and lines changed,
with a pill once something happens. Its one action, Contribute (Contribute all
for several), becomes Confirm over exactly the records that are ready at that
tap; nothing is sent before that Confirm. Only the newest card of a chat is
live: an earlier one folds to "Continued below". Every card has the same
block intent, so the chat host can tell which card is the newest.

The items printed here are a static fallback for a host that cannot run the
card. They name where to look; they never decide what is sent.
The card has no inline app view (`"expand": false`).
"""
import argparse
import json
import os
import re
from pathlib import Path

from agent_snapshot import find_ledger
from pr_block import bounded, utf16_length

RECORD_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}')
# The whole stripped `git diff --shortstat` line, as the app parses it
# (inline-session.js changeSize). Anything else has no readable size.
STAT = re.compile(r'(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?')
# A staged screenshot entry, as the app counts them (domain.js planScreenshots).
SCREENSHOT_NAME = re.compile(r'[a-z0-9][a-z0-9-]{0,60}\.png')
SHA256 = re.compile(r'[0-9a-f]{64}')
# The chat host shows at most 12 rows, and one action covers at most 12.
MAX_ITEMS = 12
# One intent for every card, so the chat host can tell the newest card in a
# chat; one action, whose records the app decides at the owner's tap.
CHAT_INTENT = 'chat:contributions'
CHAT_ACTION = 'chat-contribute:all'
JSON_LIMIT = 16384


def read_record(record_id, ledger):
  if not RECORD_ID.fullmatch(record_id or ''):
    raise ValueError('Use the prepared record id from Contribute.')
  for name in (f'{record_id}.json', f'{record_id}.record.json'):
    path = Path(ledger) / name
    if path.is_file():
      record = json.loads(path.read_text(encoding='utf-8'))
      if isinstance(record, dict) and record.get('id') == record_id:
        return record
  raise ValueError(f'No contribution {record_id} in the Contribute ledger.')


def stack_of(record):
  stack = (record.get('plan') or {}).get('stack')
  return (stack.get('id'), (record.get('plan') or {}).get('repo') or record.get('repo')) if isinstance(stack, dict) and stack.get('id') else None


def with_complete_stacks(records, ledger):
  """Every prepared layer of each listed record's stack, in layer order where
  that stack first appears. Contribute sends a stack's ready phase as one, and
  the card's one action covers only what it lists, so a card naming one layer
  must list the whole phase (otherwise Contribute refuses it in chat)."""
  layers = {}
  for path in sorted(Path(ledger).glob('*.json')):
    try:
      other = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
      continue
    if isinstance(other, dict) and other.get('status') == 'prepared' and stack_of(other) and RECORD_ID.fullmatch(str(other.get('id') or '')):
      layers.setdefault(stack_of(other), {})[other['id']] = other
  listed, seen = [], set()
  for record in records:
    group = layers.get(stack_of(record), {}) if stack_of(record) else {}
    members = sorted(group.values(), key=lambda layer: ((layer.get('plan') or {}).get('stack') or {}).get('position') or 0) if record['id'] in group else [record]
    for member in members:
      if member['id'] not in seen:
        seen.add(member['id'])
        listed.append(member)
  return listed


def change_size(plan):
  stat = STAT.fullmatch(str(plan.get('diff_stat') or '').strip())
  if not stat:
    return ''
  files = int(stat[1])
  return f'{files} {"file" if files == 1 else "files"} · +{stat[2] or 0} −{stat[3] or 0}'


def screenshot_count(plan):
  shots = plan.get('screenshots')
  return sum(1 for shot in shots if isinstance(shot, dict) and SCREENSHOT_NAME.fullmatch(str(shot.get('name') or ''))
    and SHA256.fullmatch(str(shot.get('sha256') or ''))) if isinstance(shots, list) else 0


def change_text(plan):
  """The Change fact, with the screenshots the PR will publish, exactly as
  Confirm's row shows it (inline-session.js confirmationItem)."""
  size, count = change_size(plan), screenshot_count(plan)
  shots = f'{count} {"screenshot" if count == 1 else "screenshots"}' if count else ''
  return ' · '.join(part for part in (size, shots) if part) or 'Size not recorded'


def prepared_item(record):
  plan = record.get('plan') if isinstance(record.get('plan'), dict) else {}
  if record.get('status') != 'prepared' or plan.get('action') not in ('pr', 'pr_update'):
    raise ValueError('Only a prepared pull request or pull-request update has a Send card.')
  return {'title': bounded(plan.get('title') or record.get('title') or 'Prepared contribution'),
    'intent': f'review:{record["id"]}',
    'facts': [{'label': 'Project', 'value': bounded(plan.get('repo') or record.get('repo') or 'Unknown')},
      {'label': 'Change', 'value': change_text(plan)}]}


def all_clear(record):
  """Reviewed all clear for its exact current head; Contribute re-checks on tap."""
  plan = record.get('plan') or {}
  review = record.get('quality_review') if isinstance(record.get('quality_review'), dict) else {}
  return review.get('state') == 'all_clear' and bool(plan.get('head_sha')) and review.get('reviewed_head_sha') == plan.get('head_sha')


def in_chat(record, chat_id):
  """The chat created the record or reconciled it (contributing/ledger.md)."""
  ids = record.get('chat_ids') if isinstance(record.get('chat_ids'), list) else []
  return bool(chat_id) and (record.get('chat_id') == chat_id or chat_id in ids)


def chat_records(chat_id, ledger):
  """Every prepared pull request of this chat that is all clear for its
  current head, oldest first. The newest card in a chat is its only live one,
  so it names all of the chat's ready work, not only what this turn prepared.
  Unreviewed work is never pulled in, so it cannot hold the card."""
  found = []
  for path in sorted(Path(ledger).glob('*.json')):
    try:
      record = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
      continue
    if (isinstance(record, dict) and record.get('status') == 'prepared' and in_chat(record, chat_id)
        and RECORD_ID.fullmatch(str(record.get('id') or '')) and path.name == f'{record["id"]}.json'
        and (record.get('plan') or {}).get('action') in ('pr', 'pr_update') and all_clear(record)):
      found.append(record)
  return sorted(found, key=lambda record: str(record.get('created_at') or ''))


def card_block(records, ledger=None, chat_id=None):
  records = list({record['id']: record for record in records}.values())
  waiting = [record['id'] for record in records if not all_clear(record)]
  if waiting:
    raise ValueError(f'{", ".join(waiting)} is not all clear for its current version. Review it before printing its card.')
  if chat_id:
    # A card shown in this chat shows only this chat's records.
    stray = [record['id'] for record in records if not in_chat(record, chat_id)]
    if stray:
      raise ValueError(f'{", ".join(stray)} is not from this chat. Restage it from this chat first, so its record names this chat.')
    if ledger is not None:
      records = list({record['id']: record for record in [*records, *chat_records(chat_id, ledger)]}.values())
  if ledger is not None:
    records = with_complete_stacks(records, ledger)
  if not records:
    raise ValueError('A card names at least one prepared record.')
  if len(records) > MAX_ITEMS:
    raise ValueError(f'A card shows at most {MAX_ITEMS} contributions; these are {len(records)}. '
      'Only the newest card in a chat is live, so send these in two rounds: print a card for some, and the next one after they are sent.')
  items = [prepared_item(record) for record in records]
  block = {'app': 'contribute', 'intent': CHAT_INTENT,
    'title': '1 contribution' if len(records) == 1 else f'{len(records)} contributions',
    'inline': True, 'interaction': 'inline', 'expand': False,
    # Project and size read on their own, so fallback rows show values only.
    'item_facts': 'values', 'items': items,
    'action': {'label': 'Contribute' if len(records) == 1 else 'Contribute all', 'intent': CHAT_ACTION}}
  if utf16_length(json.dumps(block, ensure_ascii=False)) > JSON_LIMIT:
    raise ValueError('This card is too large for chat. Print fewer contributions per card.')
  return block


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('record_ids', nargs='+')
  parser.add_argument('--ledger-dir', type=Path)
  parser.add_argument('--chat-id', default=os.environ.get('CHAT_ID', ''),
    help='The chat this card is printed in (default: $CHAT_ID). Its other prepared contributions join the card.')
  args = parser.parse_args()
  ledger = args.ledger_dir or find_ledger()
  block = card_block([read_record(record_id, ledger) for record_id in args.record_ids], ledger, args.chat_id or None)
  print('```mobius-app\n' + json.dumps(block, ensure_ascii=False) + '\n```')


if __name__ == '__main__':
  main()
