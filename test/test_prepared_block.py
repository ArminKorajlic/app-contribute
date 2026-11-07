import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('prepared_block', ROOT / 'prepared_block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HEAD = 'a' * 40


def record(record_id, **extra):
  plan = {'action': 'pr', 'repo': 'owner/repo', 'title': f'Change {record_id}', 'branch': f'fix/{record_id}',
    'head_sha': HEAD, 'diff_stat': '2 files changed, 4 insertions(+), 1 deletion(-)', **extra.pop('plan', {})}
  return {'id': record_id, 'type': 'pr', 'status': 'prepared', 'repo': 'owner/repo', 'plan': plan,
    'quality_review': {'state': 'all_clear', 'reviewed_head_sha': HEAD}, **extra}


class PreparedBlockTests(unittest.TestCase):
  def setUp(self):
    self.ledger = tempfile.TemporaryDirectory()
    self.addCleanup(self.ledger.cleanup)

  def save(self, *records):
    for item in records:
      (Path(self.ledger.name) / f'{item["id"]}.json').write_text(json.dumps(item))
    return [module.read_record(item['id'], self.ledger.name) for item in records]

  def card(self, *records):
    return module.card_block(self.save(*records), self.ledger.name)

  def test_every_card_has_the_chat_intent_one_action_and_fallback_items(self):
    block = self.card(record('one'))
    self.assertEqual(block['intent'], 'chat:contributions', 'one intent, so the host can tell the newest card')
    self.assertEqual((block['inline'], block['interaction'], block['expand']), (True, 'inline', False))
    self.assertEqual(block['item_facts'], 'values')
    self.assertEqual(block['title'], '1 contribution')
    self.assertEqual(block['items'], [{'title': 'Change one', 'intent': 'review:one',
      'facts': [{'label': 'Project', 'value': 'owner/repo'}, {'label': 'Change', 'value': '2 files · +4 −1'}]}])
    self.assertEqual(block['action'], {'label': 'Contribute', 'intent': 'chat-send:one'},
      'the earlier card\'s action, so a host without rows-v2 runs it as before')
    self.assertNotIn('facts', block)

  def test_many_contributions_share_the_one_fixed_action(self):
    long_ids = [f'record-{"x" * 110}-{n}' for n in range(3)]
    block = self.card(*(record(item) for item in long_ids))
    self.assertEqual(block['intent'], 'chat:contributions')
    self.assertEqual(block['title'], '3 contributions')
    self.assertEqual([item['intent'] for item in block['items']], [f'review:{item}' for item in long_ids])
    for item in block['items']:
      self.assertEqual(set(item), {'title', 'intent', 'facts'}, 'no per-item action')
    self.assertEqual(block['action'], {'label': 'Contribute all', 'intent': f'chat-send-batch:{module.batch_handle(long_ids)}'},
      'one action over every item, matching them as before')
    self.assertLessEqual(len(block['action']['intent']), 32)

  def test_a_card_for_one_stack_layer_lists_every_prepared_layer_in_order(self):
    stack = lambda position, sid='s1': {'stack': {'id': sid, 'name': 'Stack', 'position': position, 'total': 3}}
    published = record('first', status='open', plan=stack(1))
    self.save(published, record('third', plan=stack(3)), record('other-stack', plan=stack(1, 's2')))
    block = self.card(record('alone'), record('second', plan=stack(2)))
    self.assertEqual([item['intent'] for item in block['items']], ['review:alone', 'review:second', 'review:third'],
      'the whole ready phase, not the published layer or another stack')

  def test_a_named_record_that_is_not_all_clear_for_its_head_is_refused(self):
    stale = record('one', quality_review={'state': 'all_clear', 'reviewed_head_sha': 'b' * 40})
    for bad in (stale, record('two', quality_review={}), record('three', quality_review={'state': 'changes_needed', 'reviewed_head_sha': HEAD})):
      with self.assertRaisesRegex(ValueError, 'not all clear for its current version'):
        self.card(bad)

  def test_a_stack_is_printed_only_when_every_layer_is_ready_and_from_this_chat(self):
    stack = lambda position: {'stack': {'id': 's1', 'name': 'Stack', 'position': position, 'total': 2}}
    self.save(record('top', plan=stack(2), quality_review={}))
    with self.assertRaisesRegex(ValueError, 'top is not all clear'):
      self.card(record('base', plan=stack(1)))
    self.save(record('top', plan=stack(2), chat_id='chat-2'))
    with self.assertRaisesRegex(ValueError, 'top is not from this chat'):
      module.card_block(self.save(record('base', plan=stack(1), chat_id='chat-1')), self.ledger.name, 'chat-1')
    self.save(record('top', plan=stack(2), chat_id='chat-1'))
    block = module.card_block(self.save(record('base', plan=stack(1), chat_id='chat-1')), self.ledger.name, 'chat-1')
    self.assertEqual([item['intent'] for item in block['items']], ['review:base', 'review:top'])
    # Another ready record of the chat whose stack is not ready stays out.
    self.save(record('lonely', chat_id='chat-1', plan={'stack': {'id': 's9', 'name': 'S', 'position': 1, 'total': 2}}),
      record('lonely-top', chat_id='chat-1', quality_review={}, plan={'stack': {'id': 's9', 'name': 'S', 'position': 2, 'total': 2}}))
    joined = module.card_block(self.save(record('solo', chat_id='chat-1')), self.ledger.name, 'chat-1')
    self.assertNotIn('review:lonely', [item['intent'] for item in joined['items']])

  def test_more_than_twelve_are_refused_and_sent_in_rounds(self):
    with self.assertRaisesRegex(ValueError, '15 contributions ready; a card shows at most 12. Ask the owner to send some from Contribute first'):
      self.card(*(record(f'r{n:02}') for n in range(15)))
    self.assertEqual(len(self.card(*(record(f'r{n:02}') for n in range(12)))['items']), 12)

  def test_a_chat_card_adds_the_chats_other_prepared_work_and_refuses_another_chats(self):
    chat, other = 'chat-1', 'chat-2'
    earlier = record('earlier', chat_id=chat, created_at='2026-11-01T00:00:00Z')
    reconciled = record('reconciled', chat_id=other, chat_ids=[other, chat], created_at='2026-11-02T00:00:00Z')
    elsewhere = record('elsewhere', chat_id=other, created_at='2026-11-03T00:00:00Z')
    sent = record('sent', chat_id=chat, status='open')
    unreviewed = record('unreviewed', chat_id=chat, quality_review={}, created_at='2026-11-01T01:00:00Z')
    changes = record('changes', chat_id=chat, quality_review={'state': 'changes_needed', 'reviewed_head_sha': HEAD})
    restaged = record('restaged', chat_id=chat, plan={'head_sha': 'c' * 40})
    self.save(earlier, reconciled, elsewhere, sent, unreviewed, changes, restaged)
    named = self.save(record('today', chat_id=chat))
    block = module.card_block(named, self.ledger.name, chat)
    self.assertEqual([item['intent'] for item in block['items']], ['review:today', 'review:earlier', 'review:reconciled'],
      'the newest card names all of the chat\'s ready work; unreviewed, changes-needed and restaged work is not pulled in')
    self.assertEqual(block['title'], '3 contributions')
    with self.assertRaisesRegex(ValueError, 'elsewhere is not from this chat'):
      module.card_block(self.save(elsewhere), self.ledger.name, chat)
    self.assertEqual(len(module.card_block(named, self.ledger.name)['items']), 1, 'without a chat id only the named records')

  def test_the_helper_needs_the_chat_it_prints_in(self):
    import io, os
    from contextlib import redirect_stderr
    self.save(record('mine', chat_id='chat-9'))
    previous = os.environ.pop('CHAT_ID', None)
    try:
      sys.argv = ['prepared_block.py', 'mine', '--ledger-dir', self.ledger.name]
      with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
        module.main()
    finally:
      if previous is not None: os.environ['CHAT_ID'] = previous

  def test_the_chat_id_defaults_to_the_agents_chat(self):
    import io, os
    from contextlib import redirect_stdout
    self.save(record('mine', chat_id='chat-9'), record('also-mine', chat_id='chat-9'))
    out = io.StringIO()
    previous = os.environ.get('CHAT_ID')
    os.environ['CHAT_ID'] = 'chat-9'
    try:
      sys.argv = ['prepared_block.py', 'mine', '--ledger-dir', self.ledger.name]
      with redirect_stdout(out):
        module.main()
    finally:
      if previous is None: os.environ.pop('CHAT_ID', None)
      else: os.environ['CHAT_ID'] = previous
    printed = json.loads(out.getvalue().split('\n')[1])
    self.assertEqual([item['intent'] for item in printed['items']], ['review:mine', 'review:also-mine'])
    self.assertTrue(out.getvalue().startswith('```mobius-app\n') and out.getvalue().endswith('\n```\n'))

  def test_change_size_is_the_whole_shortstat_line(self):
    for stat, size in [(' 1 file changed, 2 insertions(+)\n', '1 file · +2 −0'), ('2 files changed, 7 deletions(-)', '2 files · +0 −7'),
        ('1 file changed', '1 file · +0 −0')]:
      self.assertEqual(module.change_size({'diff_stat': stat}), size)
    for stat in ['1 file changed, lots of deletions', 'about 1 file changed', '1 file changed, 2 insertions(+) and more', '']:
      self.assertEqual(module.change_size({'diff_stat': stat}), '', stat)
    block = self.card(record('one', plan={'diff_stat': 'about 1 file changed'}))
    self.assertEqual(block['items'][0]['facts'][1], {'label': 'Change', 'value': 'Size not recorded'})

  def test_change_names_the_screenshots_the_pr_will_publish(self):
    shot = lambda name: {'name': name, 'sha256': 'e' * 64, 'size': 1200, 'alt': name}
    two = self.card(record('one', plan={'screenshots': [shot('before.png'), shot('after.png'), {'name': '../x.png', 'sha256': 'e' * 64}]}))
    self.assertEqual(two['items'][0]['facts'][1], {'label': 'Change', 'value': '2 files · +4 −1 · 2 screenshots'})
    one = self.card(record('one', plan={'screenshots': [shot('a.png'), {'name': 'b.png', 'sha256': 'short'}]}))
    self.assertEqual(one['items'][0]['facts'][1]['value'], '2 files · +4 −1 · 1 screenshot')
    self.assertEqual(module.change_text({'diff_stat': '', 'screenshots': [shot('a.png')]}), '1 screenshot')

  def test_handle_matches_the_app(self):
    # chat-blocks.js: batchHandle(['b', 'a']) === '968bcf1a16b2b0ee'
    self.assertEqual(module.batch_handle(['b', 'a']), '968bcf1a16b2b0ee')
    self.assertEqual(module.batch_handle(['a', 'b', 'a']), module.batch_handle(['b', 'a']))

  def test_only_prepared_pull_requests_and_repeated_ids_once(self):
    with self.assertRaises(ValueError):
      self.card(record('open', status='open'))
    with self.assertRaises(ValueError):
      module.read_record('../escape', self.ledger.name)
    one = self.save(record('one'))[0]
    self.assertEqual(len(module.card_block([one, one])['items']), 1)

  def test_text_stays_within_the_host_limits_in_utf16_units(self):
    titles = ['x' * 300, '\U0001F600' * 130]
    block = self.card(*(record(f'r{n}', plan={'title': title, 'repo': 'o/' + 'r' * 300}) for n, title in enumerate(titles)))
    for item in block['items']:
      self.assertLessEqual(module.utf16_length(item['title']), 240)
      self.assertLessEqual(len(item['facts']), 4)
      for fact in item['facts']:
        self.assertLessEqual(module.utf16_length(fact['value']), 240)
    longest = self.card(*(record(f'{"y" * 120}-{n:02}', plan={'title': '\U0001F600' * 200}) for n in range(12)))
    self.assertLessEqual(module.utf16_length(json.dumps(longest, ensure_ascii=False)), 16384)


if __name__ == '__main__':
  unittest.main()
