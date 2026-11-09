# Contributing: the Möbius adapter

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The generic review-checkout recipe
is in [branch.md](branch.md); this file supplies the
Möbius facts and recipes it refers to.

Use this adapter for the Möbius platform (`/data/platform`, including the
shell) and for installed apps shown in Contribute Projects.

## The five facts

- **Working source:** the live platform checkout `/data/platform`, or the
  installed app's source directory `/data/apps/<slug>`.
- **Shared source:** the platform's configured canonical branch, or the
  installed app's release marker (the per-app-git `upstream` branch inside
  `/data/apps/<slug>`).
- **Publication:** **Send PR** through Contribute
  ([publish.md](publish.md)) to `mobius-os/mobius` or
  the app's canonical repository.
- **Local update path:** accepted platform work returns through the reviewed
  Möbius update flow; eligible tracked apps return through App Store's
  reviewed **Update all**. Overlaps use the existing resolver instead of a
  reset, and platform activation keeps its separately confirmed restart gate.
- **Private material:** private/local-only apps and genuine local overlays are
  preserved.

**Align this Möbius with upstream** is this adapter's name for **align my
projects with upstream** in [cycle.md](cycle.md).

## Source roots

Contributable source is exactly: app source (`/data/apps/<slug>/` — the code,
not the data), the platform (`/data/platform/`), and the shell. Numeric
`/data/apps/<id>/` directories are runtime data and never contributable.

To see everything local in an installed app, diff against its release marker:
`git -C /data/apps/<slug> diff upstream...HEAD`. A scratch clone under
`$TMPDIR` has no `upstream` branch; diff it against the fetched
`origin/<default branch>`.

## Review checkout recipes

**An app with a real origin** (most catalog apps —
`git -C /data/apps/<slug> remote get-url origin` succeeds): the accepted base
is the merge-base with the release marker, and the attributable change is
everything on `main` since then.

```bash
SOURCE=/data/apps/<slug>
BASE_SHA="$(git -C "$SOURCE" merge-base main upstream)"
LOCAL_DIFF=/tmp/<record-id>.local.diff
git -C "$SOURCE" -c core.quotePath=false diff --no-ext-diff --no-color \
  --binary --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..main" > "$LOCAL_DIFF"
```

Then follow *The durable review checkout* in
[branch.md](branch.md) with branch
`fix/<slug>-<short>`. The live app stays on `main`, so watcher edits and store
updates cannot land on the review branch.

**An app with no origin** (installed from a manifest): derive the repo from
`manifest_url` (`.../<org>/<repo>/<ref>/mobius.json` → `github.com/<org>/<repo>`).
The clone is not a linked worktree of the installed app, so pass the app's
live source path as `source_repo_path` to the stage call (staging reads its
current commit itself). Clone into
`/data/contrib/<record-id>/worktree` with
`--separate-git-dir=/data/contrib/<record-id>/git` (named `git`, never `.git`),
`checkout -b fix/…`, copy the changed source over (re-read against the source
roots), and commit with the co-author trailer. The reviewed commit identities
may differ from the installed ones; the submit path handles that safely. Use
the worktree as `repo_path`.

**Platform/shell**, only when `/data/platform` has a real origin: fetch the
canonical branch, use `SOURCE=/data/platform` and the fetched tip as
`BASE_SHA`, and follow the same durable-checkout recipe with the reviewed
source diff as `LOCAL_DIFF`. Record `repo: "mobius-os/mobius"` and
`source_repo_path: "/data/platform"`; `/data/platform` itself stays on its
current live branch. Without an origin, platform contributions are unavailable
— say so; app contributions still work.

## Checks

Run the cheapest focused checks that cover the changed files. For platform
checks, use `scripts/wt-pytest.sh` and `scripts/wt-npm.sh` from the staged
checkout. The Python wrapper uses the shared test runtime, and the npm wrapper
temporarily borrows the primary checkout's dependency tree only when
`package-lock.json` matches exactly. Do not run a direct `npm ci` or create a
checkout-local `.venv` when either wrapper can supply the exact environment.

For `mobius-os/mobius` PRs, upstream CI (`.github/workflows/test.yml`) runs
the required `privacy`, `backend` (pytest), and `frontend-unit` (`npm test`
plus the packager and browser-harness unit tests) jobs. Its sharded Playwright
`e2e` job runs on manual dispatch and merge-group runs, not on every PR.
Diagnose failures as in [ci.md](ci.md).

**Playwright:** do not run it locally by default. The Möbius app container has
no Docker, so diagnose browser failures from the hosted CI report. On a
Docker-capable contributor host, reproduce a CI failure by first committing the
exact revision, then using the disposable runner with the narrowest spec or
grep possible:

```bash
scripts/playwright-local.sh --allow-local-e2e <spec or --grep arguments>
```

The runner makes a standalone temporary clone, then builds a separate backend,
database, credentials, ports, and browser session from that same commit. It
uses one worker and tears everything down. It refuses tracked uncommitted edits
instead of testing them against an older runtime. Never point Playwright,
`auth.setup.mjs`, or a preview proxy at the live backend — localhost alone does
not prove isolation.

## Labels

For Möbius repositories, `plan.labels` is exactly one of `bug`,
`enhancement`, `documentation`, or `maintenance`, plus at most one of
`area: ui`, `area: backend`, `area: apps`, or `area: infrastructure`. A visual
defect is `bug` + `area: ui`; a new interface is `enhancement` + `area: ui`.

Choose the area by where the changed behavior lives, not by the PR's subject:
`area: ui` for the shell and frontend, `area: backend` for server behavior,
`area: apps` for a mini-app's source, and `area: infrastructure` for CI, the
image, build and test tooling. A PR that changes only tests or CI is
`maintenance` + `area: infrastructure`, whatever code those tests cover. A
dependency update is `maintenance` with the area of its lockfile. A revert is
`bug` when it backs out a regression and `maintenance` otherwise. Its area is
that of the code it removes. When a change spans layers, pick the one a
reviewer must understand to judge it; if none clearly leads, omit the area
rather than guess.

## Screenshots

An `area: ui` PR or an app PR that changes what people see carries the
before/after screenshots described in [prepare.md](prepare.md), at a desktop
width and at 390 px wide so reviewers see both layouts. A change with no
visible effect, such as a dependency update or a refactor, needs neither
screenshots nor a reason for their absence.

The Möbius `screenshot` tool captures only at the owner's current viewport,
so use the authenticated capture helper from the visual-testing skill, which
takes the viewport from the environment:

```bash
VIEWPORT_WIDTH=1280 VIEWPORT_HEIGHT=800 \
  bash "$SCRIPTS_DIR/agent-screenshot.sh" <route> "$TMPDIR/after-desktop.png"
VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 \
  bash "$SCRIPTS_DIR/agent-screenshot.sh" <route> "$TMPDIR/after-phone.png"
```

Crop a copy to the change if needed and attach that screenshot when you stage
([ledger.md](ledger.md)).

## A new app: check the catalog first

Before building a new app, check whether the App Store catalog already has it;
installing beats rebuilding. An empty or short catalog result is normal.

```bash
curl -s https://raw.githubusercontent.com/mobius-os/app-store/main/catalog.json | python3 -m json.tool
```

Publishing a local app into its own `mobius-os/app-<id>` repository and the
post-merge `connect_app` handoff are maintainer work:
[maintainer.md](maintainer.md).
