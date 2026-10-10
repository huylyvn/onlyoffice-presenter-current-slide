'use strict';

// Focused regression test for the Presenter View reporter first-run path (sdkjs).
//
// The reporter window is a separate asc_docs_api that opens the same document in
// "reporter" mode. On its first GoToPage it used to start the demonstration at the
// hardcoded slide 0 and then fall through to DemonstrationGoToSlide(lPageNum = 0),
// which sent `reporter_command: go_to_slide 0` back to the main window and reset the
// whole show to slide 1.
//
// This test extracts the REAL CEditorPage.prototype.GoToPage body from
// slide/Drawing/HtmlPage.js and runs it with stubs, asserting:
//   - first run starts on the requested slide (api.reporterStartSlide), and
//   - first run does NOT emit a go_to_slide.
// It also statically checks the api.js plumbing that carries the start slide to the
// reporter (DemonstrationReporterStart -> file:open payload -> preloadReporter).
//
// Run against the patched source (PASS) and against a pre-fix snapshot (FAIL):
//   SDK_ROOT=<dir> node sdkjs_reporter_regression_test.js

const fs = require('fs');
const path = require('path');

const SDK_ROOT =
  process.env.SDK_ROOT ||
  '/home/huy/Projects/onlyoffice-presenter-current-slide/.wt/sdkjs-presenter';

const HTMLPAGE = path.join(SDK_ROOT, 'slide/Drawing/HtmlPage.js');
const API = path.join(SDK_ROOT, 'slide/api.js');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`       expected ${e}`);
    console.log(`       actual   ${a}`);
  }
}

function extractPrototypeFunction(src, name) {
  const marker = 'CEditorPage.prototype.' + name + ' = function';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('function not found: ' + name);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces for ' + name);
}

function loadGoToPage() {
  const src = fs.readFileSync(HTMLPAGE, 'utf8');
  const body = extractPrototypeFunction(src, 'GoToPage');
  const CEditorPage = function () {};
  const factory = new Function('CEditorPage', body + ';\nreturn CEditorPage.prototype.GoToPage;');
  return factory(CEditorPage);
}

function makeCtx(opts) {
  const calls = [];
  const ctx = {
    m_oApi: {
      isReporterMode: opts.reporter !== false,
      reporterStartSlide: opts.startSlide,
      StartDemonstration: function (id, n) {
        calls.push(['StartDemonstration', id, n]);
        // mirror the real Start(): it flips Mode on and records the slide
        ctx.DemonstrationManager.Mode = true;
        ctx.DemonstrationManager.SlideNum = n;
      },
      DemonstrationGoToSlide: function (n) { calls.push(['DemonstrationGoToSlide', n]); },
      sendEvent: function (n) { calls.push(['sendEvent', n]); },
      sendFromReporter: function (m) { calls.push(['sendFromReporter', m]); },
      isEyedropperStarted: function () { return false; },
    },
    DemonstrationManager: { Mode: false, SlideNum: -1 },
    m_oScrollVerApi: null,
    m_oDrawingDocument: {},
    m_oLogicDocument: {},
  };
  return { ctx, calls };
}

console.log('=== behavioural: CEditorPage.prototype.GoToPage (reporter path) ===');
const GoToPage = loadGoToPage();

// 1. Reporter first run must start on the requested slide and must not echo go_to_slide.
{
  const { ctx, calls } = makeCtx({ startSlide: 4 });
  GoToPage.call(ctx, 0, undefined, undefined, undefined, undefined);
  const start = calls.find((c) => c[0] === 'StartDemonstration');
  check('reporter first run starts on requested slide 4',
    start, ['StartDemonstration', 'id_reporter_dem', 4]);
  check('reporter first run does not emit go_to_slide',
    calls.filter((c) => c[0] === 'DemonstrationGoToSlide'), []);
  check('reporter first run signals start_show',
    calls.filter((c) => c[0] === 'sendFromReporter').length, 1);
}

// 2. Reporter launched "from beginning" (no requested slide) still starts at 0.
{
  const { ctx, calls } = makeCtx({ startSlide: undefined });
  GoToPage.call(ctx, 0);
  check('reporter first run without a requested slide defaults to 0',
    calls.find((c) => c[0] === 'StartDemonstration'),
    ['StartDemonstration', 'id_reporter_dem', 0]);
}

// 3. An already-running reporter still navigates on a normal GoToPage.
{
  const { ctx, calls } = makeCtx({ startSlide: 4 });
  ctx.DemonstrationManager.Mode = true; // already running
  GoToPage.call(ctx, 2);
  check('running reporter forwards navigation to the main show',
    calls.filter((c) => c[0] === 'DemonstrationGoToSlide' && c[1] === 2).length >= 1, true);
}

// 4. A reporter-driven update (isReporterUpdateSlide) must not echo back.
{
  const { ctx, calls } = makeCtx({ startSlide: 4 });
  ctx.DemonstrationManager.Mode = true;
  GoToPage.call(ctx, 2, false, false, false, true);
  check('reporter update slide does not echo go_to_slide',
    calls.filter((c) => c[0] === 'DemonstrationGoToSlide'), []);
}

// 5. Non-reporter editor is unaffected: no demonstration start.
{
  const { ctx, calls } = makeCtx({ reporter: false, startSlide: 4 });
  GoToPage.call(ctx, 3);
  check('non-reporter GoToPage does not start a demonstration',
    calls.filter((c) => c[0] === 'StartDemonstration'), []);
  check('non-reporter GoToPage does not emit go_to_slide',
    calls.filter((c) => c[0] === 'DemonstrationGoToSlide'), []);
}

console.log('\n=== static: start-slide plumbing in slide/api.js ===');
const apiSrc = fs.readFileSync(API, 'utf8');
check('StartDemonstration forwards slidestart_num to DemonstrationReporterStart',
  /DemonstrationReporterStart\(reporterStartObject,\s*slidestart_num\)/.test(apiSrc), true);
check('DemonstrationReporterStart stores startSlideIndex in the payload',
  /reporterStartObject\["startSlideIndex"\]/.test(apiSrc), true);
check('preloadReporter reads startSlideIndex into reporterStartSlide',
  /this\.reporterStartSlide\s*=\s*[\s\S]{0,80}startSlideIndex/.test(apiSrc), true);
check('reporter first-run no longer hardcodes slide 0',
  /StartDemonstration\("id_reporter_dem",\s*0\)/.test(loadGoToPageSrc()), false);

function loadGoToPageSrc() { return fs.readFileSync(HTMLPAGE, 'utf8'); }

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
