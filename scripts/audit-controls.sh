#!/bin/sh
# Every control in the app, by KIND, in one list.
#
# Why this exists, in the user's words: "у тебе ніби хаос в пам'яті і ти
# не бачиш всі кнопки одразу, а замість цього я їх за тебе шукаю". They
# were right - the buttons were converted in the order they happened to
# be noticed, so half of them stayed in the old style and the icons ended
# up white in one place and black in another. A screenshot should not be
# how we find the next one.
#
# The app has FOUR kinds of control, and they are not interchangeable:
#
#   1. ON GLASS   - a glyph standing on a GlassDrop: the rail capsules,
#                   the top capsules, the navigation island, the search
#                   field, the "+" . These must use <GlassIcon>, never a
#                   colour of their own: on glass the ink is a mid grey
#                   that the theme decides (theme.glass.ink), which is
#                   what Apple's own glass bar does - neither white nor
#                   black.
#   2. ON A SCRIM - a control over a photograph or a video (the crop and
#                   draw toggles, the viewer's actions). White ON PURPOSE
#                   and in every theme: what is behind it is a picture,
#                   not the theme.
#   3. ON A CARD  - the "..." on a record's card, coloured by that card's
#                   own palette (colorForDocument).
#   4. IN A SHEET - rows inside «Аркуш» / «Меню» / «Питання». They follow
#                   the sheet's ink, and are the next slice's own work.
#
# Run it from the repo root:  sh scripts/audit-controls.sh
#
# Nothing here is a test that passes or fails - it is the inventory, so
# that "have I got them all?" is answered by reading rather than by
# remembering. Kept in scripts/ because package.json's own scripts are
# hashed into the runtime version (see CLAUDE.md) and adding one there
# would cut the phone off from updates.

cd "$(dirname "$0")/.." || exit 1

echo "==================================================================="
echo " 1. GLASS SURFACES - every GlassDrop in the app"
echo "==================================================================="
grep -rn "<GlassDrop" src/ | sed 's/:.*<GlassDrop/  <GlassDrop/'

echo
echo "==================================================================="
echo " 2. STILL HAND-BUILT GLASS - a capsule that has not moved onto the"
echo "    drop yet. Everything listed here still draws its own blur,"
echo "    fill and border, and will not follow the theme."
echo "==================================================================="
grep -rn "backgroundColor: GLASS_ISLAND" src/ | grep -v "constants/glass.ts"

echo
echo "==================================================================="
echo " 3. ICONS ON GLASS - should all be <GlassIcon>"
echo "==================================================================="
grep -rn "<GlassIcon" src/ | wc -l | sed 's/^/  on the theme: /'

echo
echo "==================================================================="
echo " 4. ICON COLOURS WRITTEN BY HAND - each one is either kind 2/3/4"
echo "    (fine) or a kind-1 control that was missed (not fine). Check"
echo "    against the kinds above before touching any of them: many are"
echo "    CORRECT, and sweeping them blind is how a white glyph ends up"
echo "    on a white card."
echo "==================================================================="
grep -rn 'color="#fff"' src/ | sed 's/^/  /'
echo "  ---"
grep -rn "color={GLASS_TEXT}" src/ | sed 's/^/  /'

echo
echo "==================================================================="
echo " 5. FLOATING CONTROLS BY SCREEN - where the rail actually stands"
echo "==================================================================="
grep -rn "<RailCapsule" src/ | sed 's/:.*<RailCapsule/  <RailCapsule/'
