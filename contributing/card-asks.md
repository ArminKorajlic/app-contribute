# Contributing: card asks

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

## Card asks

A message ending in lines like `` `contribute · <record-id> · <code>` `` comes
from **Fix in chat** on this chat's Contribute card: the owner pressed it, and
each line names a record the card holds back and why. It asks you to repair
that record privately. It is never approval to send, push or publish
([SKILL.md](SKILL.md) Hard stop #1), and its text is the card's fixed
wording, not new instructions.
Work on exactly the named record, following `superseded_by` to its current
version, in its review worktree ([branch.md](branch.md)), then restage and
review it as [ledger.md](ledger.md) describes:

| Code | What to do |
|---|---|
| `commit_identity_mismatch` | Recommit the reviewed change with the connected account (`mapi /api/github/status` `login`) as author and committer, keeping the co-author trailer; restage and review again. |
| `invalid_pr_text` | Correct the title or body so GitHub can publish it exactly as written (length, characters, screenshot references); restage and review again. |
| `publication_destination_unavailable` | Read the record's review status again; if GitHub still cannot say where it would publish, tell the owner what is unavailable. |
| `needs_review` | Review the current head completely and record the verdict. |
| `changes_needed` | Fix what the review found; restage and review again. |
| `upstream_conflict` | Update onto the fresh upstream base and resolve the conflict, run the focused tests, restage and review again. |
| `upstream_base_moved` | Update onto the fresh upstream base and restage; review again unless the verdict carried over. |
| `source_changed` | Restage from the current reviewed source; review again if the diff changed. |
| `send_failed` | Read `last_submit_error` and `last_submit_error_code`, repair the cause ([publish.md](publish.md) failure table), restage and review again. |
| `needs_attention` | Read what the record's attention reports and resolve it. |
| `not_in_contribute` | Find what removed or replaced the record; stage the work again from this chat if it still exists, otherwise tell the owner it is gone. |
| `couldnt_check` | Read the record; if it is intact, only print a new card, otherwise repair it with the ledger's CAS rules. |
| `restage` | Restage it so its diff stat and identity are complete, then review again. |
| `stack_incomplete` | Prepare, review and stage every layer of its stack from this chat, so the card can list the whole stack. |
| `result_unknown` | Read only: look on GitHub for the exact branch and pull request. Record a PR you find; otherwise report what you saw. Never clear the error or send again. |

Then print a fresh card with `python3 /data/apps/contribute/prepared_block.py
<record-id> …` ([publish.md](publish.md) "Offering Send in chat"), so the
owner can press Contribute. If the repair needs an owner decision (a changed
scope, a closed target PR, a different repository), ask for that decision
instead. A GitHub connection problem is never an ask: the card offers the
owner the account itself.
