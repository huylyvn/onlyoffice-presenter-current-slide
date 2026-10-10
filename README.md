# ONLYOFFICE Desktop Editors — Presenter View starts on the current slide

A local, source-built patch for **ONLYOFFICE Desktop Editors 9.4.0** (build 129) that makes
**"Presenter View" open on the slide that is currently selected**, instead of always resetting
to slide 1.

Verified in the real GUI (screenshots + DOM text) and by focused regression tests that
**fail on the unpatched source**.

> Status: **WORKING LOCAL BUILD** — built from source, deployed into a runnable 9.4.0 tree, and
> exercised against a 12-slide deck. See [`PRESENTER-VIEW-FIX-HANDOFF.md`](./PRESENTER-VIEW-FIX-HANDOFF.md)
> for the full write-up (root cause, validation matrix, maintenance).

---

## The bug

Launching **Presenter View** while slide 5 was selected opened the presenter window on **slide 1**.
The fix spans two upstream repositories — changing either one alone is insufficient.

| # | Repo | Change | File(s) |
|---|------|--------|---------|
| 1 | [ONLYOFFICE/web-apps](https://github.com/ONLYOFFICE/web-apps) | The Presenter View menu item hardcoded `onPreview(0, true, false)`; now passes the current page with `isCurrent=true` so it reuses the existing "from current slide" path. | `apps/presentationeditor/main/app/controller/Toolbar.js`, `.../Statusbar.js` |
| 2 | [ONLYOFFICE/sdkjs](https://github.com/ONLYOFFICE/sdkjs) | The reporter window (a separate `asc_docs_api` in `reporter` mode) initialised its own demonstration at hardcoded slide `0` and then echoed `go_to_slide 0` back to the main window. The requested start index now rides the existing `file:open` payload and is used for the reporter's first run; the bogus fall-through is removed. | `slide/Drawing/HtmlPage.js`, `slide/api.js` |

Patches are in [`patches/`](./patches), each based on upstream `release/v9.4.0`:

- `0001-web-apps-launch-presenter-from-current-slide.patch` (+2/−2)
- `0002-sdkjs-init-reporter-from-active-slide.patch` (+7/−5)

Both correspond to the forks `huylyvn/web-apps` and `huylyvn/sdkjs`, branch
`fix/presenter-view-current-slide`.

---

## Repository layout

```
patches/                      # the two upstream patches (apply with `git apply`)
scripts/rebuild.sh            # rebuild the patched JS layer from source (+ --deploy)
scripts/launch.sh             # launch the runnable tree with remote debugging enabled
validation/                   # source-level regression harnesses + captured results
  presenter_regression_test.js
  sdkjs_reporter_regression_test.js
  results/*.json
  GUI-VALIDATION-REPORT.md
docs/evidence/                # GUI screenshots proving the fix
PRESENTER-VIEW-FIX-HANDOFF.md # authoritative engineering handoff
```

---

## Build from source

### 1. Get the upstream sources at `release/v9.4.0`

```bash
git clone -b release/v9.4.0 https://github.com/ONLYOFFICE/web-apps.git
git clone -b release/v9.4.0 https://github.com/ONLYOFFICE/sdkjs.git .wt/sdkjs-presenter
```

### 2. Apply the patches

```bash
git -C web-apps apply /path/to/patches/0001-web-apps-launch-presenter-from-current-slide.patch
git -C .wt/sdkjs-presenter apply /path/to/patches/0002-sdkjs-init-reporter-from-active-slide.patch
```

Or fetch the ready-made branches:

```bash
git -C web-apps fetch https://github.com/huylyvn/web-apps.git fix/presenter-view-current-slide
git -C web-apps checkout FETCH_HEAD
git -C .wt/sdkjs-presenter fetch https://github.com/huylyvn/sdkjs.git fix/presenter-view-current-slide
git -C .wt/sdkjs-presenter checkout FETCH_HEAD
```

### 3. Rebuild the JS layer

`scripts/rebuild.sh` expects this layout relative to the repository root:

```
<root>/web-apps/                       # patched web-apps checkout
<root>/.wt/sdkjs-presenter/            # patched sdkjs checkout
<root>/presenter-desktop/              # runnable 9.4.0 payload (see below)
```

`presenter-desktop/` is the shipped 9.4.0 desktop payload (from the official package / snap
rev 1220). Copy it in, then:

```bash
scripts/rebuild.sh --deploy            # rebuild app.js + sdk-all*.js and deploy into presenter-desktop/
```

Environment overrides: `WEBAPPS`, `SDKJS_SRC`, `APP_DIR`, `OUT`, `PRODUCT_VERSION`, `BUILD_NUMBER`.
`rebuild.sh` runs `npm install` in `web-apps/build` on first use, uses `r.js` + `terser` for
`app.js`, and `python3 build/build.py --product slide --desktop` for `sdk-all.js`.

---

## Run

```bash
scripts/launch.sh [deck.pptx] [port]   # default port 9333, CDP enabled
```

Launch options can be revisited. The app is single-instance — close any running
`DesktopEditors` first. Launching only writes into the local `presenter-desktop/` directory:
no installation and no system change, so your installed package stays a pristine fallback.
Rollback = delete `presenter-desktop/` and the build outputs.

---

## Validation

Source-level regression harnesses (they pass on patched source, fail on unpatched):

```bash
node validation/presenter_regression_test.js
node validation/sdkjs_reporter_regression_test.js
```

GUI matrix (real UI, CDP-driven), all PASS on the built version:

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Presenter View from slide 5 | 5 | 5 |
| 2 | Presenter View from slide 1 | 1 | 1 |
| 3 | Start from Beginning from slide 5 | 1 | 1 |
| 4 | Start from Current Slide from slide 5 | 5 | 5 |
| 5 | Presenter View from final slide (12) | 12 | 12 |
| 6 | Presenter next/prev buttons | 6,7,6 | 6,7,6 |

Screenshots are in [`docs/evidence/`](./docs/evidence); machine-readable results in
[`validation/results/`](./validation/results).

---

## Notes

- This repository contains **only the patches, scripts and documentation** — not the ~400 MB
  desktop payload or any ONLYOFFICE builds.
- Upstream code is licensed **AGPLv3** (see [`LICENSE`](./LICENSE)); the patches are derivative
  works of it and carry the same license.
- The standalone `sdk-all.js` produced by `rebuild.sh` is the un-minified upstream concatenation
  (~28 MB, loads fine, ~3× the shipped file).
