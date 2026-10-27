#!/usr/bin/env bash
# Builds Nova Player and installs it on the TV, replacing the version already there.
# Your sign-in, My List, watch progress and sorted movies are kept.
# Usage: ./tv-update.sh <tv-ip> <certificate-profile>
set -euo pipefail

TV_IP="${1:?Usage: ./tv-update.sh <tv-ip> <certificate-profile>}"
PROFILE="${2:?Usage: ./tv-update.sh <tv-ip> <certificate-profile>}"
TIZEN="${TIZEN_STUDIO:-$HOME/tizen-studio}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

# Only the app itself goes on the TV, not the dev server or this script.
cp -r "$APP_DIR"/{config.xml,index.html,icon.png,css,js} "$BUILD"/

"$TIZEN/tools/sdb" connect "$TV_IP"
DEVICE="$("$TIZEN/tools/sdb" devices | awk -v ip="$TV_IP" 'index($1, ip) == 1 { print $3; exit }')"
[ -n "$DEVICE" ] || { echo "Could not connect to the TV at $TV_IP. Is Developer Mode on with this computer's IP?"; exit 1; }

"$TIZEN/tools/ide/bin/tizen" package -t wgt -s "$PROFILE" -- "$BUILD"
# The TV's installer fails on the space in "Nova Player.wgt", so rename it first.
mv "$(ls "$BUILD"/*.wgt | head -1)" "$BUILD/NovaPlayer.wgt"
"$TIZEN/tools/ide/bin/tizen" install -n NovaPlayer.wgt -t "$DEVICE" -- "$BUILD"
"$TIZEN/tools/ide/bin/tizen" run -p NovaPlay01.NovaPlayer -t "$DEVICE"
echo "Nova Player is updated and open on the TV."
