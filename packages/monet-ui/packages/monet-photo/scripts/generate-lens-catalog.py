#!/usr/bin/env python3
"""Generate the offline, standard-model Lensfun catalog from a pinned archive."""
import hashlib
import io
import json
import math
from pathlib import Path
import sys
from urllib.request import urlopen
from zipfile import ZipFile
import xml.etree.ElementTree as ET

REVISION = "84401750ea96c67db927801cca9be28139db1a50"
ROOT = Path(__file__).resolve().parents[1]
SOURCE = f"https://github.com/lensfun/lensfun/tree/{REVISION}/data"


def number(value, default=None):
    if value is None:
        return default
    value = value.replace(":", "/")
    if "/" in value:
        a, b = value.split("/", 1)
        return float(a) / float(b)
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Non-finite calibration")
    return result


def text(element, name):
    return (element.findtext(name) or "").strip()


def names(element, name):
    return sorted({(e.text or "").strip() for e in element.findall(name)} - {""})


def samples(calibration, tag, models):
    result = []
    for element in calibration.findall(tag):
        model = element.get("model")
        if model not in models:
            continue
        values = {key: number(value) for key, value in element.attrib.items()
                  if key not in {"model", "real-focal"}}
        if values.get("focal", 0) <= 0:
            continue
        if tag == "vignetting" and (values.get("aperture", 0) <= 0 or values.get("distance", 0) <= 0):
            continue
        result.append({"model": model, **values})
    return result


def generate(archive):
    cameras, profiles, mounts, notes = [], {}, {}, {}
    with ZipFile(io.BytesIO(archive)) as source:
        for path in sorted(source.namelist()):
            if "/data/db/" not in path or not path.endswith(".xml"):
                continue
            tree = ET.fromstring(source.read(path), parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
            filename = path.rsplit("/", 1)[1]
            notes[filename] = [(e.text or "").strip() for e in tree.iter() if e.tag is ET.Comment]
            for mount in tree.findall("mount"):
                mounts.setdefault(text(mount, "name"), set()).update(names(mount, "compat"))
            for camera in tree.findall("camera"):
                crop = number(camera.findtext("cropfactor"))
                if crop and crop > 0:
                    cameras.append({"maker": text(camera, "maker"), "models": names(camera, "model"),
                                    "mount": text(camera, "mount"), "cropFactor": crop})
            for lens in tree.findall("lens"):
                if text(lens, "type") not in {"", "rectilinear"}:
                    continue
                maker, model = text(lens, "maker"), text(lens, "model")
                for calibration in lens.findall("calibration"):
                    crop = number(calibration.get("cropfactor"), number(lens.findtext("cropfactor"), 1))
                    aspect = number(calibration.get("aspect-ratio"), number(lens.findtext("aspect-ratio"), 1.5))
                    if crop <= 0 or aspect <= 0:
                        continue
                    aspect = max(aspect, 1 / aspect)
                    lens_mounts = names(lens, "mount")
                    key = json.dumps([maker, model, lens_mounts, crop, aspect], ensure_ascii=False)
                    ident = hashlib.sha256(key.encode()).hexdigest()[:32]
                    title = model if model.lower().startswith(maker.lower()) else f"{maker} {model}"
                    profile = profiles.setdefault(ident, {
                        "id": ident, "name": f"{title} ({', '.join(lens_mounts)}, {crop:g}×)",
                        "maker": maker, "model": model, "aliases": names(lens, "model"),
                        "mounts": lens_mounts, "cropFactor": crop, "aspectRatio": aspect,
                        "distortion": [], "tca": [], "vignetting": [], "sourceFiles": [],
                    })
                    profile["sourceFiles"].append(filename)
                    profile["distortion"] += samples(calibration, "distortion", {"none", "poly3", "poly5", "ptlens"})
                    profile["tca"] += samples(calibration, "tca", {"none", "linear", "poly3"})
                    profile["vignetting"] += samples(calibration, "vignetting", {"pa"})
        license_path = next(p for p in source.namelist() if p.endswith("data/COPYING.CC_BY-SA_3.0"))
        (ROOT / "data").mkdir(exist_ok=True)
        (ROOT / "data/LICENSE-LENSFUN").write_bytes(source.read(license_path))

    result = []
    for profile in profiles.values():
        for key in ["distortion", "tca", "vignetting"]:
            unique = {json.dumps(row, sort_keys=True): row for row in profile[key]}
            profile[key] = sorted(unique.values(), key=lambda row: (row["focal"], row.get("aperture", 0), row.get("distance", 0)))
        profile["sourceFiles"] = sorted(set(profile["sourceFiles"]))
        if any(profile[key] for key in ["distortion", "tca", "vignetting"]):
            result.append(profile)
    catalog = {"revision": REVISION, "source": SOURCE, "license": "CC-BY-SA-3.0",
               "cameras": cameras, "mounts": {k: sorted(v) for k, v in sorted(mounts.items())},
               "profiles": sorted(result, key=lambda row: (row["maker"], row["model"], row["id"]))}
    (ROOT / "src/lensProfiles.catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    (ROOT / "data/lensfun-attribution.json").write_text(json.dumps({"source": SOURCE, "sourceNotes": notes}, ensure_ascii=False, indent=2) + "\n")
    print(f"Lensfun {REVISION}: {len(cameras)} cameras, {len(result)} rectilinear profiles")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        archive = Path(sys.argv[1]).read_bytes()
    else:
        with urlopen(f"https://codeload.github.com/lensfun/lensfun/zip/{REVISION}", timeout=60) as response:
            archive = response.read(32 * 1024 * 1024 + 1)
        if len(archive) > 32 * 1024 * 1024:
            raise ValueError("Lensfun source archive exceeds the pinned-data budget")
    generate(archive)
