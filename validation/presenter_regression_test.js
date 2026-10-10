'use strict';

// Focused regression test for the Presenter View launch path.
//
// web-apps has no practical automated harness for presentation-editor
// controllers (the only test/ unit-tests are browser mocha harnesses whose
// vendored asset paths are broken). This test therefore exercises the REAL
// patched source: it extracts the onPreview / onPreviewItemClick functions
// from the controller files and runs them with stubs, asserting the
// notification payload that Viewport.onPreviewStart consumes.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.CTRL_ROOT || '/home/huy/Projects/onlyoffice-presenter-current-slide/web-apps/apps/presentationeditor/main/app/controller';

function extractFunction(src, name) {
  const start = src.indexOf(name + ': function');
  if (start < 0) throw new Error('function not found: ' + name);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces for ' + name);
}

const _ = { isNumber: (v) => typeof v === 'number' && isFinite(v), isArray: Array.isArray };

function loadController(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const bodies = [
    extractFunction(src, 'onPreview'),
    extractFunction(src, 'onPreviewItemClick'),
    extractFunction(src, 'onPreviewBtnClick'),
  ].join(',\n');
  const factory = new Function('Common', '_', 'return {' + bodies + '};');
  return factory;
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`       expected ${e}`);
  console.log(`       actual   ${a}`);
}

function run(file) {
  console.log(`\n=== ${file} ===`);
  const factory = loadController(file);
  const makeCtx = (currentPage) => {
    const calls = [];
    const Common = { NotificationCenter: { trigger: (...a) => calls.push(a) } };
    const methods = factory(Common, _);
    const ctx = Object.assign({ api: { getCurrentPage: () => currentPage }, _state: { slideMasterMode: false } }, methods);
    return { ctx, calls };
  };

  // viewport.onPreviewStart: isCurrent ? StartDemonstrationFromCurrentSlide : StartDemonstrationFromBeginning
  const slideToStart = (args) => (args[4] === true ? 'FromCurrentSlide@' + args[1] : 'FromBeginning@0');

  // Presenter View (menu value 2) must start from the current slide.
  for (const current of [0, 4, 9]) {
    const { ctx, calls } = makeCtx(current);
    ctx.onPreviewItemClick(null, { value: 2 });
    check(`presenter view, current=${current} -> preview:start args`,
      calls[0], ['preview:start', current, true, false, true]);
    check(`presenter view, current=${current} -> start mode`,
      slideToStart(calls[0]), 'FromCurrentSlide@' + current);
  }

  // Start from beginning (menu value 0) must remain slide 0.
  {
    const { ctx, calls } = makeCtx(4);
    ctx.onPreviewItemClick(null, { value: 0 });
    check('from beginning, current=4 -> preview:start args',
      calls[0], ['preview:start', 0, false, false, false]);
    check('from beginning, current=4 -> start mode',
      slideToStart(calls[0]), 'FromBeginning@0');
  }

  // Start from current slide (menu value 1, non-presenter) must be unchanged.
  {
    const { ctx, calls } = makeCtx(4);
    ctx.onPreviewItemClick(null, { value: 1 });
    check('from current slide, current=4 -> preview:start args',
      calls[0], ['preview:start', 4, false, false, true]);
    check('from current slide, current=4 -> start mode',
      slideToStart(calls[0]), 'FromCurrentSlide@4');
  }

  // Split-button main click (play) must be unchanged: from current, non-presenter.
  {
    const { ctx, calls } = makeCtx(7);
    ctx.onPreviewBtnClick(null, null);
    check('preview button click, current=7 -> preview:start args',
      calls[0], ['preview:start', 7, false, false, true]);
  }
}

run('Toolbar.js');
run('Statusbar.js');

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
