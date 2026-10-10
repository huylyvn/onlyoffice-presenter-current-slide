# GUI validation — Presenter View current-slide behaviour (patched Desktop Editors)

**Result: FAIL.** The web-apps menu patch makes the *audience* start on the selected slide, but the
**Presenter View window still opens on slide 1** and drags the show back to slide 1. The user-visible
bug is **not** fixed by the two-line menu patch alone.

## Build tested

| | |
|---|---|
| App | ONLYOFFICE Desktop Editors **9.4.0 (build 129)** |
| Source of binary | snap `onlyoffice-desktopeditors` rev 1220, `latest/stable`, unpacked to a writable tree |
| Tree | `/home/huy/Projects/onlyoffice-presenter-current-slide/patched-desktop/` |
| Patch applied | `editors/web-apps/apps/presentationeditor/main/app.js` — the minified equivalent of the source fix |
| `app.js` sha256 before | `433271581b013e8a86f504f1799d7ea2d82c36f47dc4ab9491424a6a98c41504` |
| `app.js` sha256 after | `8376dba4a24bcc5e47adb290692283e623538ee2dfcaf509df55af128771ab3b` |
| sdkjs | **unchanged** (`editors/sdkjs/slide/sdk-all-min.js`, build 129) |
| Launch | `.desktopeditors --no-sandbox --remote-debugging-port=9222 <deck>` (run from the copied tree) |
| Driving/screenshots | Chrome DevTools Protocol (CEF `Chrome/109.0.5414.120`, UA `AscDesktopEditor/9.4.0.129`) |

The app could not be run through the snap launcher because the snap is read-only and the patch had to be
deployed into it; the copied tree runs the same binary and the reporter window is still created by the
real desktop code (`CPresenterWindow`). The verified-live controller source in the running app was:

```
case 2:this.onPreview(this.api.getCurrentPage(),!0,!0)   // both Toolbar and Statusbar
```

## Test deck

`desolenator-12-labeled.pptx` — 12 slides, each a full-bleed white slide with a large red
**"SLIDE N"** label, built from the user's sample `desolenator.pptx` (which has only 5 slides) by
reusing its master/layout/theme. Generator: `generate_deck.py`.

## Test matrix (all run against the patched build)

Slide selection was done in the real thumbnail pane (click + arrow keys), and the launch was done by
opening the real preview split-button menu and clicking the real menu item.

| Test | Expected | Actual | Result |
|---|---|---|---|
| Presenter View from slide 1 | slide 1 | slide 1 | **PASS** |
| Presenter View from slide 5 | slide 5 | **slide 1** | **FAIL** |
| Presenter View from final slide (12) | slide 12 | **slide 1** | **FAIL** |
| Start From Beginning from slide 5 | slide 1 | slide 1 | **PASS** |
| Start From Current Slide from slide 5 | slide 5 | slide 5 | **PASS** |

Raw machine-readable results: `validation-results.json`.
Audience demonstration slide sequences (1-based), captured via `asc_onDemonstrationSlideChanged`:

```
A presenter-from-slide-1     selected=1   mainSeq=[1]                 reporter=1
B presenter-from-slide-5     selected=5   mainSeq=[5, 5, 1, 1]        reporter=1
C presenter-from-final(12)   selected=12  mainSeq=[12, 12, 12, 1, 1, 1] reporter=1
D from-beginning-from-slide-5 selected=5  mainSeq=[1, 1, 1, 1]
E from-current-from-slide-5  selected=5   mainSeq=[5, 5, 5, 5, 5]
```

Note the B/C sequences: the show **does** start on the selected slide (5 / 12) and is then pulled back
to 1. The three Presenter View screenshots (from slides 1, 5 and 12) are **byte-identical**
(md5 `fd7c62e684d2c0abeb1585f98db01e8f`) — Presenter View always opens on slide 1.

## Root cause

The **reporter window** (the window titled "Presenter View") initialises its own presenter state at
slide 0 and immediately drives the main demonstration to slide 0.

Evidence:

1. The demonstration starts correctly: log shows `StartDemonstrationFromCurrentSlide` → `kTc slidestart=4`
   → `asc_onDemonstrationSlideChanged=4`.
2. It is then reset to 0 **without any further `StartDemonstration*` call**:
   `asc_onDemonstrationSlideChanged=0`. Only a direct `DemonstrationManager.GoToSlide(0)` can do that,
   i.e. a `reporter_command: go_to_slide` from the reporter window.
3. Control experiment: non-reporter **"Show from Current Slide"** produces `[5, 5]` with **no reset**.
   So the reset is specific to the reporter window.
4. The reporter's own UI reports "Slide 1 of 12" on every launch, regardless of the selected slide.

In the source branch (`sdkjs` `release/v9.4.0`) the equivalent hard-coded start is visible at
`sdkjs/slide/Drawing/HtmlPage.js` `CEditorPage.prototype.GoToPage`, reporter first run:

```js
if (this.m_oApi.isReporterMode) {
    if (!this.DemonstrationManager.Mode) {
        this.m_oApi.StartDemonstration("id_reporter_dem", 0);   // <- reporter presenter state starts at 0
        this.m_oApi.sendEvent("asc_onDemonstrationFirstRun");
        this.m_oApi.sendFromReporter('{ "reporter_command" : "start_show" }');
    }
```

(The deployed build is minified/obfuscated and differs in naming from the branch; the behaviour is the
same. The reporter is a separate `asc_docs_api` that receives the document via a `file:open` message
whose payload — `reporterStartObject` — contains **no start-slide information**.)

## Proof of the fix direction

The reporter drives the main, so putting the reporter on the right slide fixes everything. Verified
live on the patched build: with Presenter View open (both at slide 1), calling

```
reporter: Asc.editor.DemonstrationGoToSlide(4)
```

produced `main slideChanged = 4` and `reporter = 4` — i.e. **both windows then show slide 5**.

Therefore the remaining fix is to have the reporter's initial presenter state match the requested start
slide instead of `0`, e.g.:

- carry the start index to the reporter (in the `file:open` / `reporterStartObject` payload, which is
  built from the `slidestart_num` already known to `StartDemonstration`), and use it in the reporter's
  first-run start; **or**
- after the main starts the demonstration on the requested slide, send the reporter a
  `main_command: go_to_slide <N>` so it syncs immediately.

Both are **sdkjs** changes. The web-apps menu patch remains necessary (it is what makes the main start
on the selected slide) but is not sufficient on its own.

## Evidence files

```
01-editor-slide-5-selected.png              editor, slide 5 selected in the thumbnail pane (before launch)
02-presenter-view-starts-slide-5.png        Presenter View after launching from slide 5 — shows SLIDE 1  (FAIL)
03-start-from-beginning-slide-1.png         "From Beginning" from slide 5 — audience shows SLIDE 1        (PASS)
04-start-from-current-slide-5.png           "From Current Slide" from slide 5 — audience shows SLIDE 5   (PASS)
05-presenter-view-final-slide.png           Presenter View after launching from slide 12 — shows SLIDE 1 (FAIL)
validation-results.json                      the matrix, machine-readable
ev-T*-*.png                                  raw per-test audience + presenter screenshots
launch-12slide.log                           app launch log (DevTools listening ...)
```

Screenshots were taken with CDP `Page.captureScreenshot` at the app's device pixel ratio (e.g.
2922x1571 for the editor), so the slide labels are legible.

## Not done

- **No screen recording.** Given the FAIL, a recording would only repeat the screenshots; CDP frame
  capture could be added if wanted.
- **No rebuilt build.** The patch was deployed into the shipped bundle (byte-verified), not compiled
  from source; a source rebuild is unnecessary to establish this behaviour.
