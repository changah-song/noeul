#!/usr/bin/env bash
# Space-safe stand-in for expo-constants' get-app-config-ios.sh.
#
# The stock script runs `basename $PROJECT_DIR` unquoted, so when the repo
# lives under a path with a space (".../Personal Projects/...") it decides it
# isn't in the Pods project and silently skips writing app.config, leaving
# Constants.expoConfig empty in release builds. Its podspec also calls it
# through an unquoted path, which fails the archive outright.
# plugins/withIosPodFixes.js points the EXConstants build phase here instead.

set -eo pipefail

PKG_DIR="$PODS_ROOT/../../node_modules/expo-constants"
PROJECT_ROOT="$PODS_ROOT/../.."

if [ "$BUNDLE_FORMAT" == "deep" ]; then
  RESOURCE_DEST="$CONFIGURATION_BUILD_DIR/EXConstants.bundle/Contents/Resources"
  mkdir -p "$RESOURCE_DEST"
else
  RESOURCE_DEST="$CONFIGURATION_BUILD_DIR/EXConstants.bundle"
fi

cd "$PROJECT_ROOT"
"$PKG_DIR/scripts/with-node.sh" "$PKG_DIR/scripts/getAppConfig.js" "$PROJECT_ROOT" "$RESOURCE_DEST"
