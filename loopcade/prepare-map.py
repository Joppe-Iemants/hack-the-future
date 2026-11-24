"""Prepare a compact local walking map from an OpenStreetMap extract of Ghent."""
import json
import math
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

OUTPUT = Path(__file__).parent / "dist"
LON, LAT = 3.72, 51.05
SX, SY = 111320 * math.cos(math.radians(LAT)), 111320
points, ways = {}, {}


def download(url):
    return subprocess.check_output([
        "curl.exe", "-fsSL", "--retry", "2", "--max-time", "150",
        "-A", "Loopcade-Ghent-prototype/1.0", url,
    ])


def load_tile(west, south, east, north, depth=0):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={west:.5f},{south:.5f},{east:.5f},{north:.5f}"
    print(f"Reading {west:.3f}, {south:.3f} ...", flush=True)
    try:
        tree = ET.fromstring(download(url))
    except subprocess.CalledProcessError:
        if depth >= 2:
            raise
        if (east-west)*SX > (north-south)*SY:
            middle = (east + west) / 2
            load_tile(west, south, middle, north, depth+1)
            load_tile(middle, south, east, north, depth+1)
        else:
            middle = (north + south) / 2
            load_tile(west, south, east, middle, depth+1)
            load_tile(west, middle, east, north, depth+1)
        return
    for node in tree.iterfind("node"):
        points[node.get("id")] = [
            round((float(node.get("lon")) - LON) * SX),
            round((float(node.get("lat")) - LAT) * SY),
        ]
    for way in tree.iterfind("way"):
        tags = {v.get("k"): v.get("v") for v in way.iterfind("tag")}
        if any(k in tags for k in ("highway", "waterway", "natural", "leisure", "landuse", "building", "railway")):
            ways[way.get("id")] = ([v.get("ref") for v in way.iterfind("nd")], tags)
    time.sleep(0.4)


def classify(t):
    h = t.get("highway", "")
    if h:
        if h in ("construction", "proposed", "platform", "elevator", "corridor", "raceway"):
            return None
        pedestrian = h in ("footway", "path", "pedestrian", "steps", "living_street", "residential", "service", "unclassified", "tertiary", "secondary", "primary", "track")
        if h in ("cycleway", "bridleway") or t.get("motorroad") == "yes":
            pedestrian = t.get("foot") in ("yes", "designated", "permissive")
        access = t.get("foot", t.get("access", "yes"))
        pedestrian = pedestrian and access not in ("private", "no", "customers", "military", "permit", "delivery", "destination")
        pedestrian = pedestrian and t.get("area") != "yes" and t.get("indoor") != "yes" and t.get("sidewalk") not in ("no", "separate") and not t.get("foot:conditional")
        typ = "a" if h in ("primary", "secondary", "tertiary", "trunk", "motorway") else "p" if h in ("footway", "path", "steps", "cycleway", "track", "service") else "s"
        return typ, int(pedestrian)
    if t.get("natural") == "water" or t.get("waterway") == "riverbank":
        return "w", 0
    if t.get("waterway") in ("river", "stream", "canal", "ditch"):
        return "r", 0
    if t.get("leisure") in ("park", "garden", "pitch") or t.get("landuse") in ("forest", "grass", "meadow", "recreation_ground") or t.get("natural") in ("wood", "grassland"):
        return "g", 0
    if t.get("building") and t.get("building") != "no":
        return "b", 0
    if t.get("railway") in ("rail", "tram"):
        return "t", 0
    return None


def build():
    for west in [3.693, 3.711, 3.729]:
        for south in [51.034, 51.048, 51.062]:
            load_tile(west, south, west + .018, south + .014)
    indices, coords, features = {}, [], []
    for refs, tags in ways.values():
        kind = classify(tags)
        if not kind or len(refs) < 2 or not all(ref in points for ref in refs):
            continue
        ids = []
        for ref in refs:
            if ref not in indices:
                indices[ref] = len(coords)
                coords.append(points[ref])
            ids.append(indices[ref])
        features.append([*kind, tags.get("name", "") if kind[0] in "aspgrw" else "", ids])
    data = dict(origin=[LON, LAT], scale=[SX, SY], points=coords, ways=features)
    (OUTPUT / "gent.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Saved {len(features)} map features and {len(coords)} coordinates", flush=True)


if __name__ == "__main__":
    build()
