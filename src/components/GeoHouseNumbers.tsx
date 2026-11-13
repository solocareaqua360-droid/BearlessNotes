import { Layer } from '@maplibre/maplibre-react-native';

// OpenFreeMap's styles (Liberty, Bright, Positron alike) draw no house
// numbers, though the tiles carry them - OpenMapTiles' `housenumber`
// layer, z14, overzoomed beyond. Added on top of the hosted style here
// so the map shows them again as tile.openstreetmap.org did, from the
// same zoom (17) and in Liberty's own label look. Offline, only regions
// downloaded at "Висока" (z14) include this layer's data.
export default function GeoHouseNumbers() {
  return (
    <Layer
      id="bearless-housenumber"
      type="symbol"
      source="openmaptiles"
      source-layer="housenumber"
      minzoom={17}
      layout={{
        'text-field': ['get', 'housenumber'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      }}
      paint={{
        'text-color': '#666',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
        'text-halo-blur': 0.5,
      }}
    />
  );
}
