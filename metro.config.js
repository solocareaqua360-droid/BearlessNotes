const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The document quick look runs two browser libraries (mammoth for .docx,
// SheetJS for .xlsx) INSIDE a WebView, where they have the real browser
// APIs they were written against - not in Hermes, where they do not. They
// ship as plain files the app reads and injects, so they need an extension
// Metro treats as an asset rather than as source to compile.
config.resolver.assetExts.push('jslib');

module.exports = config;
