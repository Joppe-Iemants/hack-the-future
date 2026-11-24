"""Download a regular grid of Copernicus terrain elevations for the local map."""
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from importlib import import_module

source = import_module("prepare-map")
step, x0, y0, width, height = 225, -2025, -1800, 19, 22
locations = [
    (source.LAT + (y0 + row*step)/source.SY, source.LON + (x0 + col*step)/source.SX)
    for row in range(height) for col in range(width)
]
samples = []
for offset in range(0, len(locations), 70):
    group = locations[offset:offset+70]
    query = urlencode({key: ",".join(f"{point[index]:.5f}" for point in group)
                       for index, key in enumerate(("latitude", "longitude"))})
    data = json.loads(source.download("https://api.open-meteo.com/v1/elevation?" + query))
    samples.extend(data["elevation"])
    time.sleep(.8)
assert len(samples) == width * height
(Path(__file__).parent / "dist" / "height.json").write_text(json.dumps(
    dict(step=step, x0=x0, y0=y0, width=width, height=height, samples=samples),
    separators=(",", ":")), encoding="utf-8")
