# Presenter View current-slide fix — final handoff

Supersedes the stale `web-apps`-only ownership conclusion in
`ONLYOFFICE-PRESENTER-001-sol-handoff`. The GUI-tested conclusion is authoritative:
**the fix spans `web-apps` + `sdkjs`.**

---

## 1. Result

```
WORKING LOCAL BUILD
```

With slide 5 selected, **Presenter View opens on slide 5** ("Slide 5 of 12"), and
"Start from Beginning" still opens on slide 1. Proven in the real GUI (screenshots + DOM text)
and by focused regression tests that fail on the pre-fix source.

---

## 2. Root cause (two bugs, two repositories)

**Bug 1 — web-apps launch request (necessary).**
The Presenter View menu item (preview split-button, `value: 2`) hardcoded the start:

```js
case 2: this.onPreview(0, true, false);   // slidenum=0, isCurrent=false
```

`Viewport.onPreviewStart` ignores `slidenum` and chooses the sdkjs entry point from `isCurrent`
alone, so `isCurrent=false` forced `StartDemonstrationFromBeginning` → first slide.

**Bug 2 — sdkjs reporter initialization (the load-bearing part).**
Presenter View is a *separate* `asc_docs_api` opened in `using:'reporter'` mode. Its first
`GoToPage` (from `_openDocumentEndCallback` → `GoToPage(0)`) hit:

```js
if (this.m_oApi.isReporterMode) {
    if (!this.DemonstrationManager.Mode) {          // first run
        this.m_oApi.StartDemonstration("id_reporter_dem", 0);   // ← hardcoded 0
        ...
    }
}
// fall-through:
if (this.DemonstrationManager.Mode && !isReporterUpdateSlide)
    return this.m_oApi.DemonstrationGoToSlide(lPageNum);        // lPageNum === 0
```

`StartDemonstration` flips the reporter's `Mode` on, so the same call then fell through and emitted
`reporter_command: go_to_slide 0` **back to the main window**, resetting the audience to slide 1.
Observed sequence when launching from slide 5 (pre-fix): `[5,5,1,1]`; from slide 12: `[12,12,12,1,1,1]`.

**Interaction.** `web-apps` (patched) makes the main show start on slide 5
(`StartDemonstrationFromCurrentSlide` → `StartDemonstration(div, Get_CurPage(), reporterObject)`).
The reporter then initialises itself at 0 and echoes `go_to_slide 0`, dragging both windows to slide 1.
Fixing either half alone is insufficient.

---

## 3. Final patch

### web-apps — `fix(presentation): launch Presenter View from current slide`
Commit `61208ea6` on branch `fix/presenter-view-current-slide` (base `1993a6d8`, `release/v9.4.0`).

| File | Change |
|---|---|
| `apps/presentationeditor/main/app/controller/Toolbar.js` | `case 2: onPreview(this.api.getCurrentPage(), true, true)` |
| `apps/presentationeditor/main/app/controller/Statusbar.js` | same |

`isCurrent=true` routes through the existing "from current slide" mechanism. 2 files, +2/−2.

### sdkjs — `fix(presentation): initialize Presenter View reporter from active slide`
Commit `13d36a8` on branch `fix/presenter-view-current-slide` (base `d8e4124`, `release/v9.4.0`).

| File | Change |
|---|---|
| `slide/api.js` | `StartDemonstration` forwards `slidestart_num` to `DemonstrationReporterStart(startObject, startSlideNum)`; that method writes `startSlideIndex` into the existing `file:open` payload; `preloadReporter(data)` reads it into `this.reporterStartSlide`. |
| `slide/Drawing/HtmlPage.js` | Reporter first run: `StartDemonstration("id_reporter_dem", this.m_oApi.reporterStartSlide || 0)` and `return;` after the first-run branch, so the fall-through no longer emits a bogus `go_to_slide`. |

2 files, +7/−5. No new mechanism: the requested start index rides the payload that already carries the
report-to-open descriptor. `Start from Beginning` never opens a reporter window, so it is untouched.

Chosen over pushing `main_command: go_to_slide` after `start_show` because it starts the reporter on the
correct slide directly (no slide-1 flash) and is a smaller, more local change.

---

## 4. Validation

### Automated (source-level, fail-on-prefix)
| Harness | Patched | Pre-fix |
|---|---|---|
| `validation/presenter_regression_test.js` (web-apps controllers) | ALL PASSED | 12 FAILED |
| `validation/sdkjs_reporter_regression_test.js` (real `GoToPage` reporter branch + api plumbing) | ALL PASSED | 6 FAILED |

The sdkjs harness reproduces the bug exactly on the pre-fix source:
`StartDemonstration("id_reporter_dem", 0)` + `DemonstrationGoToSlide(0)`.

### GUI matrix (real UI, CDP-driven, source-built JS)
Build: Desktop Editors **9.4.0 (build 129)** — native shell from snap rev 1220, **JS layer built from
source** (`presenter-build/app.js`, `sdk-all.js`, `sdk-all-min.js`). Deck: 12 labelled slides.

| # | Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 1 | editor, slide 5 selected | 5 | 5 | PASS | `01-editor-slide-5-selected.png` |
| 2 | **Presenter View from slide 5** | **5** | **5** | **PASS** | `02-presenter-view-starts-slide-5.png` ("Slide 5 of 12", SLIDE 5) |
| 3 | Presenter View from slide 1 | 1 | 1 | PASS | `03-presenter-view-slide-1.png` ("Slide 1 of 12") |
| 4 | Start from Beginning from slide 5 | 1 | 1 | PASS | `04-start-from-beginning-selected-5.png` (SLIDE 1); demo seq `…,1,1,1` |
| 5 | Start from Current Slide from slide 5 | 5 | 5 | PASS | `05-start-from-current-selected-5.png` (SLIDE 5); demo seq `5,5,5,5,5` |
| 6 | Presenter View from final slide (12) | 12 | 12 | PASS | `06-presenter-view-final-slide.png` ("Slide 12 of 12") |
| 7 | presenter next/prev (buttons) | 6,7,6 | 6,7,6 | PASS | `07-presenter-view-navigated.png`; reporter label tracks each step |
| 8 | exit + relaunch from 5 / 1 / 12 (one app session) | correct each time | correct | PASS | tests 2,3,6 ran sequentially |

Machine-readable: `presenter-validation/validation-results.json`, `rerun-results.json`,
`nav-results.json`. Audience demonstrations were captured via `asc_onDemonstrationSlideChanged`;
presenter state via the reporter's `getCurrentPage()` and its on-screen "Slide N of 12" label.
Screenshots were visually verified (vision) in addition to the numeric checks.

Tested SHAs: web-apps `61208ea6` · sdkjs `13d36a8` · built JS hashes in `presenter-build/SHAS.txt`.

### Known gaps (stated, not hidden)
- Reporter notes pane and timer were visually present (timer counting in every Presenter View shot) but
  notes text was not asserted per-slide.
- Multi-monitor fullscreen was not exercised (single display); the reporter window is created by the
  real desktop code either way.
- The `patched-desktop` tree was left untouched; validation ran from the independent
  `presenter-desktop` copy.

---

## 5. Runnable artifact

| Item | Path |
|---|---|
| Runnable app tree | `presenter-desktop/` (self-contained copy of the shipped 9.4.0 payload) |
| Source-built JS | `presenter-build/{app.js,sdk-all.js,sdk-all-min.js}` (+ `SHAS.txt`) |
| Rebuild | `presenter-build/rebuild.sh` (add `--deploy` to copy into `presenter-desktop/`) |
| Launch | `presenter-desktop/launch.sh [deck.pptx] [port]` |

Launch (single-instance app — close any running ONLYOFFICE first):

```bash
/home/huy/Projects/onlyoffice-presenter-current-slide/presenter-desktop/launch.sh
# or directly:
cd presenter-desktop && DISPLAY=:0 QT_QPA_PLATFORM=xcb \
  LD_LIBRARY_PATH="$PWD:$PWD/converter:$PWD/lib" \
  QT_QPA_PLATFORM_PLUGIN_PATH="$PWD/platforms" QT_PLUGIN_PATH="$PWD" \
  ./DesktopEditors --no-sandbox --remote-debugging-port=9333 deck-12.pptx
```

- **No installation and no system change.** Your installed snap
  (`onlyoffice-desktopeditors` 9.4.0, rev 1220) is untouched and remains your pristine fallback.
- **Rollback/uninstall:** delete `presenter-desktop/` and `presenter-build/`. Nothing else was modified.
- The 28 MB `sdk-all.js` is the upstream un-minified concatenation (`build.py` dropped minification);
  it loads fine but is ~3× the shipped file. Optional: run it through `terser` if startup feels slow.

---

## 6. Maintenance (rebase / rebuild)

Forks: **github.com/huylyvn/web-apps** and **github.com/huylyvn/sdkjs**, branch
`fix/presenter-view-current-slide`, each with exactly one commit on top of `release/v9.4.0`.

```bash
# rebase onto a newer release branch
git -C web-apps fetch origin && git -C web-apps rebase origin/release/v9.4.0
git -C .wt/sdkjs-presenter fetch origin && git -C .wt/sdkjs-presenter rebase origin/release/v9.4.0

# rebuild + redeploy the local JS (seconds)
presenter-build/rebuild.sh --deploy

# re-run the guards
node validation/presenter_regression_test.js
node validation/sdkjs_reporter_regression_test.js
```

`web-apps` is a normal checkout; `sdkjs` is checked out in the git worktree
`.wt/sdkjs-presenter` (branch `fix/presenter-view-current-slide`) so that a concurrent laser-pointer
workstream in the main `sdkjs/` checkout is not disturbed. Remove the worktree with
`git -C sdkjs worktree remove .wt/sdkjs-presenter` if no longer needed.

---

## 7. Upstream recommendation

```
SUBMIT PR NOW
```

One PR per repository, both based on `release/v9.4.0`:

- Both repos accept external PRs; external non-member PRs **have been merged** into a release branch
  (e.g. ONLYOFFICE/web-apps#3171, base `release/v9.0.0`).
- No CLA, DCO/sign-off, PR template or CONTRIBUTING gate is enforced on GitHub.
- **Issues are disabled** on `web-apps` and `sdkjs`, so "open an issue first" is not an option — put the
  bug report (steps, expected/actual, version/OS) in the PR body.
- Cite this as two dependent changes: the `web-apps` PR is necessary; the `sdkjs` PR is what actually
  satisfies the request.
- **Lower confidence on sdkjs:** recent merged sdkjs PRs are all from ONLYOFFICE accounts; an external
  sdkjs merge is plausible but unproven in the sample available. The `web-apps` half is the safer PR.
- Expect weeks of review latency; maintainers advance the submodule gitlinks themselves (no companion
  bump PR needed from you).

Priority was a working local build; this recommendation is the low-friction next step, not a prerequisite.
