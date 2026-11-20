// OpenFreeMap's "Liberty" style - free, no key, no request limits, built
// from the same OpenStreetMap data. Shared by the live map (GeoMapView),
// both pickers, a point's static snapshot (GeoThumbnail) and the offline
// downloader, so everything draws from one style.
//
// Replaced tile.openstreetmap.org (2026-09-25) for two reasons found
// while chasing offline downloads stuck at 0%: OSM's tile usage policy
// explicitly bans offline/prefetch features (and blocks without notice,
// which would have taken the live map down too), and MapLibre's offline
// engine fetches the style only over the network, so it needs a real
// https URL rather than an inline style object - which a hosted style
// like this one is. The data here refreshes weekly rather than within
// minutes; see the memory project_offline_maps_blocked.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
