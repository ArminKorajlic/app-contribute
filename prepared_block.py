#!/usr/bin/env python3
"""Print the chat card for one or more prepared contributions. No writes.

The card lists each contribution as one item that opens its exact entry in
Contribute, with two snapshot facts from this read: the project and the change
size. It has one action, Contribute (or Contribute all), covering exactly the
records its items name. When the owner taps it, Contribute re-reads those
records, checks they are reviewed and current, and shows the exact changes on
the same button as Confirm. Nothing is sent before that Confirm. Independent
contributions are sent in parallel; the layers of one stack are sent in order.
The card has no inline app view (`"expand": false`).
"""
import argparse
import json
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
VERDICTS = {'all_clear': 'All clear', 'changes_needed': 'Changes needed', 'reviewing': 'Reviewing'}
# The chat host shows at most 12 items, and one action covers at most 12.
MAX_ITEMS = 12
JSON_LIMIT = 16384


def batch_handle(ids):
  """FNV-1a 64 over the sorted ids; chat-blocks.js computes the same handle."""
  value = '\n'.join(['contribute-batch-v1', *sorted(set(ids))])
  digest = 0xcbf29ce484222325
  units = value.encode('utf-16-le')
  for index in range(0, len(units), 2):
    digest ^= units[index] | units[index + 1] << 8
    digest = digest * 0x100000001b3 & 0xFFFFFFFFFFFFFFFF
  return f'{digest:016x}'


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


def verdict(record):
  plan = record.get('plan') or {}
  review = record.get('quality_review') if isinstance(record.get('quality_review'), dict) else {}
  state = review.get('state')
  # A verdict for an older head does not cover this one.
  return None if state == 'all_clear' and review.get('reviewed_head_sha') != plan.get('head_sha') else state


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
  Confirm shows it (inline-session.js confirmationItem)."""
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


def sendable(record):
  """Reviewed all clear for its current version; Contribute re-checks on tap."""
  return verdict(record) == 'all_clear'


def group_intent(records):
  """The entry the card opens: the one record, the stack every record is a
  layer of (a layer's entry opens its whole stack), or the review queue."""
  stacks = {((record.get('plan') or {}).get('stack') or {}).get('id') or None for record in records}
  return f'review:{records[0]["id"]}' if len(records) == 1 or stacks != {None} and len(stacks) == 1 else 'reviews:queue'


def card_block(records, ledger=None):
  records = list({record['id']: record for record in records}.values())
  if ledger is not None:
    records = with_complete_stacks(records, ledger)
  if not records:
    raise ValueError('A card names at least one prepared record.')
  items = [prepared_item(record) for record in records]
  shown, hidden = records[:MAX_ITEMS], len(records) - MAX_ITEMS
  block = {'app': 'contribute', 'intent': group_intent(records),
    'title': '1 contribution ready' if len(records) == 1 else f'{len(records)} contributions ready',
    'inline': True, 'interaction': 'inline', 'expand': False, 'items': items[:MAX_ITEMS]}
  if hidden > 0:
    # One action cannot cover records the card does not list, so an
    # overflowing card only opens Contribute.
    block['facts'] = [{'label': 'Not shown', 'value': f'and {hidden} more in Contribute'}]
  elif not all(sendable(record) for record in shown):
    waiting = sum(not sendable(record) for record in shown)
    block['facts'] = [{'label': 'Review', 'value': f'{waiting} of {len(shown)} not all clear for this version. Open Contribute.'}]
  else:
    ids = [record['id'] for record in shown]
    block['action'] = ({'label': 'Contribute', 'intent': f'chat-send:{ids[0]}'} if len(ids) == 1
      else {'label': 'Contribute all', 'intent': f'chat-send-batch:{batch_handle(ids)}'})
  if utf16_length(json.dumps(block, ensure_ascii=False)) > JSON_LIMIT:
    raise ValueError('This card is too large for chat. Open Contribute to send these.')
  return block


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('record_ids', nargs='+')
  parser.add_argument('--ledger-dir', type=Path)
  args = parser.parse_args()
  ledger = args.ledger_dir or find_ledger()
  block = card_block([read_record(record_id, ledger) for record_id in args.record_ids], ledger)
  print('```mobius-app\n' + json.dumps(block, ensure_ascii=False) + '\n```')


if __name__ == '__main__':
  main()
