import type { StyleSpecification } from '@maplibre/maplibre-react-native';

// OpenStreetMap's own public tile server - free, no key. Shared between
// the live map (GeoMapView) and a point's own static snapshot
// (GeoThumbnail), so a card's little picture and the real map underneath
// it are drawn from the exact same style rather than two that could
// drift apart. Meant for light, occasional use rather than a busy
// production app; a dedicated tile provider is later work.
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
