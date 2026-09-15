const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The document quick look runs two browser libraries (mammoth for .docx,
// SheetJS for .xlsx) INSIDE a WebView, where they have the real browser
// APIs they were written against - not in Hermes, where they do not. They
// ship as plain files the app reads and injects, so they need an extension
// Metro treats as an asset rather than as source to compile.
config.resolver.assetExts.push('jslib');
// The Ukrainian language model for the text recogniser, shipped rather
// than downloaded: 3.8MB once, against needing the network the first time
// anyone points the camera at a page.
config.resolver.assetExts.push('bin');

module.exports = config;
