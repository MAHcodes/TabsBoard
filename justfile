dist := "dist"

default:
    @just --list

# Build the Chrome (MV3) extension into dist/chrome
chrome:
    rm -rf {{dist}}/chrome
    mkdir -p {{dist}}/chrome
    cp -r src/. {{dist}}/chrome/
    rm {{dist}}/chrome/manifest.firefox.json {{dist}}/chrome/manifest.chrome.json {{dist}}/chrome/background/background.html
    cp src/manifest.chrome.json {{dist}}/chrome/manifest.json

# Build the Firefox (MV2) extension into dist/firefox
firefox:
    rm -rf {{dist}}/firefox
    mkdir -p {{dist}}/firefox
    cp -r src/. {{dist}}/firefox/
    rm {{dist}}/firefox/manifest.firefox.json {{dist}}/firefox/manifest.chrome.json
    cp src/manifest.firefox.json {{dist}}/firefox/manifest.json

# Pack the Firefox build into a versioned .xpi
pack-firefox: firefox
    rm -f "TabsBoard-$(node -p "require('./{{dist}}/firefox/manifest.json').version")-fx.xpi"
    cd {{dist}}/firefox && zip -r -X "../../TabsBoard-$(node -p "require('./manifest.json').version")-fx.xpi" . -x '.*'

# Build both browser targets
build: chrome firefox

# Remove generated builds and the packed .xpi
clean:
    rm -rf {{dist}}
    rm -f TabsBoard-*-fx.xpi
