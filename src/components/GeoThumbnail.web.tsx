import type { ImageStyle, StyleProp } from 'react-native';

// MapLibre's static-image call is part of the native module - no browser
// build (see GeoMapView.web). A missing thumbnail here just means the
// card falls back to its plain category icon, same as a point with no
// picture ever had before this existed.
export default function GeoThumbnail(_props: {
  lat: number;
  lng: number;
  width: number;
  height: number;
  style?: StyleProp<ImageStyle>;
}) {
  return null;
}
