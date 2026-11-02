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

  def test_single_card_is_one_item_opening_its_entry_with_one_action(self):
    block = self.card(record('one'))
    self.assertEqual(block['intent'], 'review:one')
    self.assertEqual((block['inline'], block['interaction'], block['expand']), (True, 'inline', False))
    self.assertEqual(block['items'], [{'title': 'Change one', 'intent': 'review:one',
      'facts': [{'label': 'Project', 'value': 'owner/repo'}, {'label': 'Change', 'value': '2 files · +4 −1'}]}])
    self.assertEqual(block['action'], {'label': 'Contribute', 'intent': 'chat-send:one'})
    self.assertNotIn('facts', block)

  def test_many_contributions_have_no_item_actions_and_one_action_over_every_item(self):
    long_ids = [f'record-{"x" * 110}-{n}' for n in range(3)]
    block = self.card(*(record(item) for item in long_ids))
    self.assertEqual(block['intent'], 'reviews:queue')
    self.assertEqual(block['title'], '3 contributions ready')
    self.assertEqual([item['intent'] for item in block['items']], [f'review:{item}' for item in long_ids])
    for item in block['items']:
      self.assertEqual(set(item), {'title', 'intent', 'facts'}, 'no per-item action')
      self.assertEqual([fact['label'] for fact in item['facts']], ['Project', 'Change'])
    self.assertEqual(block['action'], {'label': 'Contribute all', 'intent': f'chat-send-batch:{module.batch_handle(long_ids)}'})
    self.assertLessEqual(len(block['action']['intent']), 32)

  def test_layers_of_one_stack_open_that_stack(self):
    stack = lambda position: {'stack': {'id': 's1', 'name': 'Stack', 'position': position, 'total': 2}}
    block = self.card(record('base', plan=stack(1)), record('top', plan=stack(2)))
    self.assertEqual(block['intent'], 'review:base')
    other = self.card(record('base', plan=stack(1)), record('alone'))
    self.assertEqual(other['intent'], 'reviews:queue')

  def test_a_card_for_one_stack_layer_lists_every_prepared_layer_in_order(self):
    stack = lambda position, sid='s1': {'stack': {'id': sid, 'name': 'Stack', 'position': position, 'total': 3}}
    published = record('first', status='open', plan=stack(1))
    self.save(published, record('third', plan=stack(3)), record('other-stack', plan=stack(1, 's2')))
    block = self.card(record('alone'), record('second', plan=stack(2)))
    self.assertEqual([item['intent'] for item in block['items']], ['review:alone', 'review:second', 'review:third'],
      'the whole ready phase, not the published layer or another stack')
    self.assertEqual(block['action']['intent'], f'chat-send-batch:{module.batch_handle(["alone", "second", "third"])}')
    self.save(record('late', plan=stack(2, 's3'), quality_review={}))
    unreviewed = self.card(record('lonely', plan=stack(1, 's3')))
    self.assertEqual(len(unreviewed['items']), 2)
    self.assertNotIn('action', unreviewed, 'one unreviewed layer withholds the action for the phase')

  def test_a_card_that_is_not_all_clear_offers_no_send_and_says_why(self):
    stale = record('one', quality_review={'state': 'all_clear', 'reviewed_head_sha': 'b' * 40})
    single = self.card(stale)
    self.assertNotIn('action', single)
    mixed = self.card(record('a'), record('b', quality_review={}))
    self.assertNotIn('action', mixed)
    self.assertEqual(mixed['facts'], [{'label': 'Review', 'value': '1 of 2 not all clear for this version. Open Contribute.'}])

  def test_more_than_twelve_show_twelve_and_say_how_many_more(self):
    block = self.card(*(record(f'r{n:02}') for n in range(15)))
    self.assertEqual(len(block['items']), 12)
    self.assertEqual(block['title'], '15 contributions ready')
    self.assertEqual(block['facts'], [{'label': 'Not shown', 'value': 'and 3 more in Contribute'}])
    self.assertNotIn('action', block, 'one action never covers records the card does not list')
    self.assertEqual(len(self.card(*(record(f'r{n:02}') for n in range(12)))['items']), 12)

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
