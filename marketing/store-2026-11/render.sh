#!/bin/sh
# Renders each *.html here to out/<name>.png at the size in its name, plus the
# App Store 6.3" copies (2622x1206 / 1206x2622). Needs Google Chrome.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p out
for f in *.html; do
  n="${f%.html}"; size="${n##*-}"; w="${size%x*}"; h="${size#*x}"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=4000 \
    --window-size="$w,$h" --screenshot="out/$n.png" "file://$PWD/$f" >/dev/null 2>&1
  case "$size" in
    2868x1320) sips -z 1206 2622 "out/$n.png" --out "out/${n%-*}-2622x1206.png" >/dev/null ;;
    1320x2868) sips -z 2622 1206 "out/$n.png" --out "out/${n%-*}-1206x2622.png" >/dev/null ;;
  esac
done
ls out
