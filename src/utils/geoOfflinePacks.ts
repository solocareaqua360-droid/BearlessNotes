import { OfflineManager, type OfflinePackDownloadState } from '@maplibre/maplibre-react-native';
import { MAP_STYLE_URL } from './geoMapStyle';

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

// Zoom range each detail level downloads. The style's vector tiles stop
// at z14 and the map overzooms them for any closer view, so z14 is
// already everything: house numbers, shops, every street name. Standard
// stops one level short (z13 - streets and buildings, fewer names and
// places) at roughly a quarter of the tiles. Anything above 14 would
// download nothing more; the engine clamps to the tileset's own maxzoom.
const DETAIL_ZOOM: Record<OfflineDetail, { minZoom: number; maxZoom: number }> = {
  standard: { minZoom: 11, maxZoom: 13 },
  high: { minZoom: 11, maxZoom: 14 },
};

export function zoomRangeFor(detail: OfflineDetail): { minZoom: number; maxZoom: number } {
  return DETAIL_ZOOM[detail];
}

// Tile coordinates at a zoom level, the standard Slippy Map / Web
// Mercator formulas every raster tile server (this one included) uses -
// pure arithmetic, no request, so the size can be shown BEFORE the user
// commits to a download, not just after it finishes.
function tileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}
function tileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

// Measured 2026-09-25 over central Zaporizhzhia: vector tiles averaged
// 28-49 KB per level (10 KB at the quiet edges, 75 KB at the densest).
// A city-biased middle - the sheet says "орієнтовно" for this reason.
const AVG_TILE_BYTES = 35 * 1024;

// Every region also pulls the label fonts - the style's three Noto Sans
// faces, non-CJK ranges only (the Android definition leaves
// includeIdeographs off): measured at ~3.3 MB per face. Stored once and
// shared by every region after the first, but each region's own size
// still counts them, so they belong in the estimate too.
export const FONT_BYTES = 10 * 1024 * 1024;

export function estimateRegionSize(
  bounds: [number, number, number, number],
  detail: OfflineDetail
): { tileCount: number; bytes: number } {
  const [west, south, east, north] = bounds;
  const { minZoom, maxZoom } = DETAIL_ZOOM[detail];
  let tileCount = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    // North is the smaller tile-Y (tile rows count down from the top).
    const minX = tileX(west, z);
    const maxX = tileX(east, z);
    const minY = tileY(north, z);
    const maxY = tileY(south, z);
    tileCount += Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1);
  }
  return { tileCount, bytes: tileCount * AVG_TILE_BYTES + FONT_BYTES };
}

// Downloads the given bounds at one detail level, reporting progress as
// 0-1. Resolves once complete (state === "complete"); rejects on the
// library's own error event.
//
// The push channel alone is not enough to trust: the Android side of
// @maplibre/maplibre-react-native drops its own very first status event
// outright (`val prev = prevStatus ?: return false` in
// MLRNOfflineModule.kt's shouldSendUpdate - confirmed by reading that
// file directly, not guessed). A region small enough to finish inside
// that one dropped tick - anything from a few dozen tiles, i.e. a
// small hand-drawn area - then never reports anything again, complete
// included, even though the tiles are already on disk: the sheet sat
// at 0% forever. A poll of the pack's own status alongside the push
// listener is the backstop - the same `state`/`percentage` shape
// either way, just fetched on demand instead of waited for.
const POLL_INTERVAL_MS = 1500;

// Distinguishes a deliberate cancel from a real failure, so the sheet
// can skip the "не вдалося завантажити" toast for it.
export class DownloadCancelled extends Error {}

export function downloadRegion(
  name: string,
  bounds: [number, number, number, number],
  detail: OfflineDetail,
  onProgress: (fraction: number) => void
): { promise: Promise<void>; cancel: () => void } {
  const { minZoom, maxZoom } = DETAIL_ZOOM[detail];
  let settled = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let createdPackId: string | null = null;
  let rejectFn: ((e: Error) => void) | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    rejectFn = reject;

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      fn();
    }

    // Must be a real https URL: MapLibre's offline engine fetches the
    // style through its network file source only (offline_download.cpp),
    // so inline style JSON and file:// both stall at 0% with an error
    // emitted before JS is even subscribed to hear it.
    OfflineManager.createPack(
      { mapStyle: MAP_STYLE_URL, bounds, minZoom, maxZoom, metadata: { name } },
      (_pack, status) => {
        onProgress(status.percentage / 100);
        if (status.state === ('complete' as OfflinePackDownloadState)) settle(resolve);
      },
      (_pack, error) => settle(() => reject(new Error(error.message)))
    )
      .then((pack) => {
        createdPackId = pack.id;
        pollTimer = setInterval(() => {
          if (settled) return;
          pack
            .status()
            .then((status) => {
              onProgress(status.percentage / 100);
              if (status.state === ('complete' as OfflinePackDownloadState)) settle(resolve);
            })
            .catch(() => {
              // A transient read failure isn't a download failure - the
              // push listener or the next poll tick still has a chance.
            });
        }, POLL_INTERVAL_MS);
      })
      .catch((e) => settle(() => reject(e)));
  });

  // The only way out used to be force-closing the app - there was no
  // cancel button at all. Deletes whatever partial pack exists so it
  // doesn't linger as an orphaned zero-byte region in the list.
  function cancel() {
    if (settled) return;
    settled = true;
    if (pollTimer) clearInterval(pollTimer);
    if (createdPackId) {
      OfflineManager.deletePack(createdPackId).catch(() => {});
    }
    rejectFn?.(new DownloadCancelled());
  }

  return { promise, cancel };
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
