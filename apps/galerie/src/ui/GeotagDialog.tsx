// GeotagDialog — Lightroom's Map module, minus the map (local-first: no tile
// server, no geocoder). Two tools that don't need a map to be useful:
//
//   Tracklog: Load Tracklog (GPX) ▸ Auto-Tag Selected Photos, matching each
//   photo's capture time against the track (± a clock-drift offset).
//
//   Saved Locations: named geofences; the Private ones drive the export-side
//   location strip (MetadataScope.privateLocations, see exportMetadata.ts) —
//   a tagged photo inside one gets its place fields stripped on export
//   regardless of the "Remove Location Info" export option.

import { Button, Checkbox, Dialog, Input, NumberField, Select } from "@monet-ui/monet-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useState } from "react";

import type { PhotoRow } from "../catalog/types";
import {
  listSavedLocations,
  MAX_GPX_BYTES,
  parseGpxBounded,
  parseTrackOffset,
  saveSavedLocations,
  summarizeAutoTag,
  UNITS,
  type RadiusUnit,
  type SavedLocation,
  type TrackPoint,
} from "../lib/geotag";
import { store } from "../state/store";

const UNIT_OPTIONS = UNITS.map((u) => ({ value: u, label: u }));

export function GeotagDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [offsetText, setOffsetText] = useState("00:00");
  const [locations, setLocations] = useState<SavedLocation[]>(() => listSavedLocations());
  const [busy, setBusy] = useState(false);

  const offsetSeconds = parseTrackOffset(offsetText);

  const loadTracklog = () =>
    void (async () => {
      const path = await open({
        title: "Load Tracklog",
        multiple: false,
        filters: [{ name: "GPX Tracklog", extensions: ["gpx"] }],
      });
      if (typeof path !== "string") return;
      const text = await readTextFile(path);
      const points = parseGpxBounded(text);
      if (points == null) {
        store.notify(`Tracklog too large — over ${Math.round(MAX_GPX_BYTES / 1_000_000)} MB, not loaded`);
        return;
      }
      if (points.length === 0) {
        store.notify("No usable track points — GPX needs <trkpt lat lon> with a <time>");
        return;
      }
      setTrack(points);
      setTrackName(path.split("/").pop()?.split("\\").pop() ?? path);
      store.notify(`Loaded ${points.length} track point${points.length === 1 ? "" : "s"}`);
    })().catch((e) => store.notify(`Load Tracklog failed: ${String(e)}`));

  const autoTag = () =>
    void (async () => {
      if (offsetSeconds == null || track.length === 0 || photos.length === 0) return;
      const { tagged, noCaptureTime, outOfRange } = summarizeAutoTag(photos, track, offsetSeconds);
      if (tagged.length === 0) {
        store.notify(`No photos matched the track — ${noCaptureTime} no capture time, ${outOfRange} outside range`);
        return;
      }
      setBusy(true);
      const written = await store.runJob("Auto-Tagging Photos", tagged.length, async (job) => {
        let ok = 0;
        for (const m of tagged) {
          if (job.cancelled()) break;
          await store.setGps(m.id, m.lat, m.lon);
          // setGps swallows a write failure into state.error rather than
          // rejecting — confirm the buffered row actually moved before
          // counting it as tagged.
          if (store.getState().photos.find((p) => p.id === m.id)?.gpsLat === m.lat) ok++;
          job.tick();
        }
        return ok;
      });
      setBusy(false);
      const bits: string[] = [];
      if (noCaptureTime) bits.push(`${noCaptureTime} no capture time`);
      if (outOfRange) bits.push(`${outOfRange} outside track`);
      if (tagged.length - written > 0) bits.push(`${tagged.length - written} write failed`);
      store.notify(
        `Tagged ${written} of ${photos.length} photo${photos.length === 1 ? "" : "s"}` +
          (bits.length ? ` — ${bits.join(", ")}` : ""),
      );
    })();

  const persistLocations = (next: SavedLocation[]) => {
    setLocations(next);
    saveSavedLocations(next);
  };
  const addLocation = () =>
    persistLocations([
      ...locations,
      { id: crypto.randomUUID(), name: "New Location", lat: 0, lon: 0, radius: 1, unit: "km" as RadiusUnit, isPrivate: true },
    ]);
  const patchLocation = (id: string, patch: Partial<SavedLocation>) =>
    persistLocations(locations.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLocation = (id: string) => persistLocations(locations.filter((l) => l.id !== id));

  return (
    <Dialog
      open
      onClose={onClose}
      title="Geotag Photos"
      width={640}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="gal-export-body">
        <div style={{ fontWeight: 600, color: "var(--text-1)" }}>Tracklog</div>
        <div className="gal-export-inline">
          <Button variant="ghost" size="sm" onClick={loadTracklog}>
            Load Tracklog…
          </Button>
          <span className="gal-import-count">
            {trackName ? `${trackName} — ${track.length} points` : "No tracklog loaded"}
          </span>
        </div>
        <div className="gal-export-inline">
          <span>Track offset (camera vs. logger clock)</span>
          <Input
            style={{ width: 90 }}
            value={offsetText}
            invalid={offsetSeconds == null}
            placeholder="±HH:mm"
            aria-label="Track offset"
            onChange={(e) => setOffsetText(e.target.value)}
          />
        </div>
        <div className="gal-export-inline">
          <span className="gal-modal-msg">
            {photos.length === 0
              ? "Select photos to auto-tag."
              : `${photos.length} photo${photos.length === 1 ? "" : "s"} selected.`}
          </span>
          <Button
            variant="primary"
            disabled={busy || track.length === 0 || photos.length === 0 || offsetSeconds == null}
            onClick={autoTag}
          >
            Auto-Tag Selected Photos
          </Button>
        </div>

        <div style={{ fontWeight: 600, color: "var(--text-1)", marginTop: 8 }}>Saved Locations</div>
        <div className="gal-modal-msg">
          Private locations strip IPTC place fields from photos inside them on export.
        </div>
        {locations.map((loc) => (
          <div key={loc.id} className="gal-export-inline">
            <Input
              value={loc.name}
              placeholder="Name"
              aria-label="Location name"
              onChange={(e) => patchLocation(loc.id, { name: e.target.value })}
            />
            <NumberField
              value={loc.lat}
              min={-90}
              max={90}
              step={0.0001}
              precision={4}
              aria-label="Latitude"
              onChange={(v) => patchLocation(loc.id, { lat: v })}
            />
            <NumberField
              value={loc.lon}
              min={-180}
              max={180}
              step={0.0001}
              precision={4}
              aria-label="Longitude"
              onChange={(v) => patchLocation(loc.id, { lon: v })}
            />
            <NumberField
              value={loc.radius}
              min={0.1}
              step={0.1}
              precision={1}
              aria-label="Radius"
              onChange={(v) => patchLocation(loc.id, { radius: v })}
            />
            <Select
              value={loc.unit}
              options={UNIT_OPTIONS}
              onChange={(v) => patchLocation(loc.id, { unit: v as RadiusUnit })}
            />
            <Checkbox checked={loc.isPrivate} onChange={(isPrivate) => patchLocation(loc.id, { isPrivate })}>
              Private
            </Checkbox>
            <Button variant="ghost" size="sm" aria-label={`Remove ${loc.name}`} onClick={() => removeLocation(loc.id)}>
              ×
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addLocation}>
          Add Location
        </Button>
      </div>
    </Dialog>
  );
}
