import { Checkbox, Input, NumberField, Select } from "@monet-ui/monet-react";
import { LENS_PROFILES, resolveLensProfile, type LensCorrectionSettings, type LensMetadata } from "@monet-ui/monet-photo";

/** Shared selection only: callers own preview, commit and cancellation. */
export function LensProfileControls({ value, metadata, onChange }: {
  value: LensCorrectionSettings;
  metadata: LensMetadata;
  onChange: (patch: Partial<LensCorrectionSettings>) => void;
}) {
  const explicit = value.profileId ?? LENS_PROFILES.find((p) => p.name === value.profileName)?.id;
  const selected = explicit ?? (value.profileName ? "missing" : "");
  const result = value.enableProfileCorrections ? resolveLensProfile(metadata, value) : null;
  const options = [{ value: "", label: "Automatic" }, ...LENS_PROFILES.map((p) => ({ value: p.id, label: p.name }))];
  if (selected && !options.some((p) => p.value === selected)) options.push({ value: selected, label: `${value.profileName || selected} (missing)` });
  const override = (key: "profileFocalLengthMm" | "profileAperture" | "profileCropFactor", label: string, hint: number | undefined, min: number, max: number) => (
    <label className="monet-row" style={{ gap: 8, alignItems: "center" }}>
      <span className="lbl" style={{ width: 120 }}>{label}</span>
      <Input type="number" aria-label={label} min={min} max={max} step="any" value={value[key] ?? ""}
        placeholder={hint === undefined ? "Automatic" : `Metadata: ${hint}`}
        onChange={(event) => onChange({ [key]: event.target.value === "" ? undefined : Number(event.target.value), profileCalibration: undefined })} />
    </label>
  );
  return <div style={{ display: "grid", gap: 10 }} data-mv-lens-profile-controls="">
    <Checkbox checked={value.enableProfileCorrections} onChange={(enabled) => onChange({ enableProfileCorrections: enabled })}>Enable Profile Corrections</Checkbox>
    <Select aria-label="Lens profile" value={selected} options={options} onChange={(id) => {
      const profile = LENS_PROFILES.find((p) => p.id === id);
      if (id && !profile) return;
      onChange({ profileId: profile?.id, profileName: profile?.name ?? null, profileCalibration: undefined });
    }} />
    {override("profileFocalLengthMm", "Focal length (mm)", metadata.focalLengthMm, 0.1, 100000)}
    {override("profileAperture", "Aperture (f-number)", metadata.aperture, 0.1, 1024)}
    {override("profileCropFactor", "Sensor crop factor", metadata.cropFactor ?? (metadata.focalLength35Mm && metadata.focalLengthMm ? metadata.focalLength35Mm / metadata.focalLengthMm : undefined), 0.1, 20)}
    {(["profileDistortionAmount", "profileVignettingAmount"] as const).map((key) => <label key={key} className="monet-row" style={{ gap: 8, alignItems: "center" }}>
      <span className="lbl" style={{ width: 120 }}>{key === "profileDistortionAmount" ? "Profile Distortion" : "Profile Vignetting"}</span>
      <NumberField aria-label={key === "profileDistortionAmount" ? "Profile distortion amount" : "Profile vignetting amount"}
        min={0} max={200} value={Math.round((value[key] ?? 1) * 100)} suffix="%"
        onChange={(amount) => onChange({ [key]: amount / 100 })} />
    </label>)}
    {result && <div role={result.status === "missing" ? "alert" : "status"} style={{ fontSize: 11, color: "var(--text-3)" }}>
      {result.status === "missing" ? result.message : `${result.profile.name}. ${result.warnings.join(" ")}`}
    </div>}
  </div>;
}
