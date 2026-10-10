#!/usr/bin/env bash
#
# Rebuild the patched ONLYOFFICE Desktop Editors JS layer from source and
# (optionally) deploy it into the runnable tree.
#
#   ./rebuild.sh            # rebuild presenter-build/{app.js,sdk-all*.js}
#   ./rebuild.sh --deploy   # rebuild and copy into presenter-desktop/
#
# Inputs (git):
#   web-apps  : branch fix/presenter-view-current-slide   (web-apps repo)
#   sdkjs     : branch fix/presenter-view-current-slide   (worktree .wt/sdkjs-presenter)
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBAPPS="$REPO/web-apps"
SDKJS="${SDKJS_SRC:-$REPO/.wt/sdkjs-presenter}"
OUT="$REPO/presenter-build"
APP="${APP_DIR:-$REPO/presenter-desktop}"
VERSION="${PRODUCT_VERSION:-9.4.0}"
BUILD="${BUILD_NUMBER:-129}"
DEPLOY=0
[ "${1:-}" = "--deploy" ] && DEPLOY=1

echo "== web-apps: $WEBAPPS"
[ -d "$WEBAPPS/build/node_modules" ] || ( cd "$WEBAPPS/build" && npm install --no-audit --no-fund )

cat > "$OUT/rjs.js" <<EOF
const REPO = '$WEBAPPS';
const cfg = require(REPO + '/build/presentationeditor.json');
const o = JSON.parse(JSON.stringify(cfg.main.js.requirejs.options));
delete o.appDir; delete o.dir; delete o.baseUrl;
o.baseUrl = '../apps/';
o.name = '../apps/presentationeditor/main/app.js';
o.out = '$OUT/app.raw.js';
o.optimize = 'none';
require(REPO + '/build/node_modules/requirejs').optimize(
  o, () => console.log('  r.js OK'), (e) => { console.error(String(e)); process.exit(1); });
EOF

( cd "$WEBAPPS/build" && node "$OUT/rjs.js" )
"$WEBAPPS/build/node_modules/.bin/terser" "$OUT/app.raw.js" -c -m --comments false -o "$OUT/app.min.js"
printf '/*!\n * Copyright (c) Ascensio System SIA 2009-%s. All rights reserved\n *\n * http://www.onlyoffice.com \n *\n * Version: %s (build:%s)\n */\n' "$(date +%Y)" "$VERSION" "$BUILD" > "$OUT/app.banner.js"
cat "$OUT/app.banner.js" "$OUT/app.min.js" > "$OUT/app.js"
node --check "$OUT/app.js"
echo "  app.js $(stat -c%s "$OUT/app.js") bytes"

echo "== sdkjs: $SDKJS"
( cd "$SDKJS" && PRODUCT_VERSION="$VERSION" BUILD_NUMBER="$BUILD" python3 build/build.py --product slide --desktop )
cp "$SDKJS/deploy/sdkjs/slide/sdk-all.js" "$SDKJS/deploy/sdkjs/slide/sdk-all-min.js" "$OUT/"
echo "  sdk-all.js $(stat -c%s "$OUT/sdk-all.js") bytes"

( cd "$OUT" && sha256sum app.js sdk-all.js sdk-all-min.js > SHAS.txt && cat SHAS.txt )

if [ "$DEPLOY" = "1" ]; then
  echo "== deploy -> $APP"
  MAIN="$APP/editors/web-apps/apps/presentationeditor/main"
  SDK="$APP/editors/sdkjs/slide"
  cp "$OUT/app.js" "$MAIN/app.js"
  cp "$OUT/sdk-all.js" "$OUT/sdk-all-min.js" "$SDK/"
  rm -f "$SDK/sdk-all.bin"        # stale V8 code cache; regenerated/ignored on next run
  echo "  deployed"
fi

rm -f "$OUT"/*.raw.js "$OUT"/*.min.js "$OUT"/*.banner.js
echo "== done"
