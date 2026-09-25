import { OfflineManager, type OfflinePackDownloadState } from '@maplibre/maplibre-react-native';
import { OSM_RASTER_STYLE } from './geoMapStyle';

// Named, separately-managed offline regions - not the library's own
// background "ambient cache" (a plain rolling cache of whatever tiles
// were recently drawn, clearable only as a whole, never per-region). The
// user's own explicit ask: a list of pieces they chose, each with its
// own name and weight, deletable one at a time.
export type OfflineRegion = {
  id: string;
  name: string;
  bytes: number;
  tileCount: number;
};

export type OfflineDetail = 'standard' | 'high';

// Zoom range each detail level downloads. Not scientifically tuned -
// standard reaches a normal street view, high goes closer, both stop
// well short of the building-level zoom a live connection would still
// load on demand. `minZoom` matters much less for size than `maxZoom`
// does - every level up roughly quadruples the tile count for the same
// area - so this is the one number worth revisiting once a real
// download's actual size has been seen.
const DETAIL_ZOOM: Record<OfflineDetail, { minZoom: number; maxZoom: number }> = {
  standard: { minZoom: 11, maxZoom: 16 },
  high: { minZoom: 11, maxZoom: 18 },
};

// Since OfflineManager's own mapStyle option is a URL/StyleSpecification
// pair like the live map already uses, `.toJSON()`-serialising the same
// OSM_RASTER_STYLE the map and every thumbnail already draw from would
// be enough - but its `sources`/`tileSize` shape doesn't need any
// change to pass straight through, so JSON.stringify keys never drift
// out of step with whatever mapStyle actually is.
const MAP_STYLE_JSON = JSON.stringify(OSM_RASTER_STYLE);

// Downloads the given bounds at one detail level, reporting progress as
// 0-1. Resolves once complete (state === "complete"); rejects on the
// library's own error event.
export function downloadRegion(
  name: string,
  bounds: [number, number, number, number],
  detail: OfflineDetail,
  onProgress: (fraction: number) => void
): Promise<void> {
  const { minZoom, maxZoom } = DETAIL_ZOOM[detail];
  return new Promise((resolve, reject) => {
    OfflineManager.createPack(
      { mapStyle: MAP_STYLE_JSON, bounds, minZoom, maxZoom, metadata: { name } },
      (_pack, status) => {
        onProgress(status.percentage / 100);
        if (status.state === ('complete' as OfflinePackDownloadState)) resolve();
      },
      (_pack, error) => reject(new Error(error.message))
    ).catch(reject);
  });
}

export async function listRegions(): Promise<OfflineRegion[]> {
  const packs = await OfflineManager.getPacks();
  const withStatus = await Promise.all(
    packs.map(async (pack) => {
      const status = await pack.status();
      const meta = pack.metadata as { name?: string };
      return {
        id: pack.id,
        name: meta.name || 'Без назви',
        bytes: status.completedResourceSize,
        tileCount: status.completedTileCount,
      };
    })
  );
  return withStatus;
}

export async function deleteRegion(id: string): Promise<void> {
  await OfflineManager.deletePack(id);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
