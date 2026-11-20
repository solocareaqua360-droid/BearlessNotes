#!/bin/sh
# Lists where the laptop's interface draws a number of its own that is not in
# the scale (src/theme/desktopTheme.ts): corners, type sizes, and colours
# written as hex. A shell script, not an npm script - see CLAUDE.md.
#
# Usage:
#   sh scripts/audit-desktop-theme.sh           counts per file
#   sh scripts/audit-desktop-theme.sh radius    every off-scale corner
#   sh scripts/audit-desktop-theme.sh size      every off-scale font size
#   sh scripts/audit-desktop-theme.sh hex       every hex colour
cd "$(dirname "$0")/.."
# What the laptop draws: the shell and the screens it shows. The phone-only
# files share them, so this is a superset on purpose.
FILES=$(ls src/components/Desktop*.tsx src/components/desktop/*.tsx src/components/surfaces/*.tsx src/components/RenamePrompt.tsx src/components/ReferencePanel.tsx src/components/ReferenceBlockPreview.tsx App.web.tsx 2>/dev/null)
what="$1"
radius() { grep -HnE "borderRadius: *[0-9.]+" $FILES | grep -vE "borderRadius: *(8|14|20|24|999|[0-9.]+ *\*)\b" | grep -vE "borderRadius: *(size|width|height)" ; }
size() { grep -HnE "fontSize: *[0-9.]+" $FILES | grep -vE "fontSize: *(12|13\.5|15|17|22)\b"; }
hex() { grep -HnE "['\"]#[0-9A-Fa-f]{3,8}['\"]" $FILES; }
case "$what" in
  radius) radius ;;
  size) size ;;
  hex) hex ;;
  *)
    echo "off-scale corners:  $(radius | wc -l | tr -d ' ')"
    echo "off-scale sizes:    $(size | wc -l | tr -d ' ')"
    echo "hex colours:        $(hex | wc -l | tr -d ' ')"
    echo
    echo "per file (corners + sizes + hex):"
    (radius; size; hex) | cut -d: -f1 | sort | uniq -c | sort -rn | head -25
    ;;
esac
