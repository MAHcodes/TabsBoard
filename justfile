dist := "dist"

default:
    @just --list

# Build the Chrome (MV3) extension into dist/chrome
chrome:
    node scripts/build.js chrome

# Build the Firefox (MV2) extension into dist/firefox
firefox:
    node scripts/build.js firefox

# Pack the Firefox build into a versioned .xpi
pack-firefox: firefox
    rm -f "TabsBoard-$(node -p "require('./{{dist}}/firefox/manifest.json').version")-fx.xpi"
    cd {{dist}}/firefox && zip -r -X "../../TabsBoard-$(node -p "require('./manifest.json').version")-fx.xpi" . -x '.*'

# Build both browser targets
build: chrome firefox

# Everything CI runs except the browser tests: version/SDK sync, lint, unit tests
check:
    npm run check

# Browser (Playwright) tests; needs `pip install -r tests/e2e/requirements.txt && playwright install chromium`
e2e:
    npm run test:e2e

# Lint the Firefox build with Mozilla's web-ext
lint-ext:
    npm run lint:ext

# Fix version / SDK-copy drift (see scripts/sync.js)
sync:
    npm run sync

# Remove generated builds and the packed .xpi
clean:
    rm -rf {{dist}}
    rm -f TabsBoard-*-fx.xpi
