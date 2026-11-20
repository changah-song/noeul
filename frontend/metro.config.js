// Sentry's version of Expo's default config: it tags each bundle with a debug
// id so crash stack traces can be matched to their source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

if (!config.resolver.assetExts.includes('db')) {
  config.resolver.assetExts.push('db');
}

if (!config.resolver.assetExts.includes('txt')) {
  config.resolver.assetExts.push('txt');
}

module.exports = config;
