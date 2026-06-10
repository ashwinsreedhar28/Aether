"""metric_tiles generator (Python side) + cross-language parity pin.

The default dashboard HTML is deterministic, so its byte-exact SHA-256 is a
stable contract. The vitest suite (src/generators/metric_tiles.test.ts) asserts
the SAME hash against the TS `build`. One constant, two readers: if either side's
HTML drifts by a single byte, that side turns red.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators` / `metric_tiles`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import get_generator, run_generator  # noqa: E402
from metric_tiles import (  # noqa: E402
    metric_tiles_build,
    metric_tiles_generator,
    register_metric_tiles_generator,
)

# Byte-exact SHA-256 of the default dashboard's source.value. Must equal the TS pin.
DEFAULT_SHA = "96d5f123acecbb056c6a8deb61f95768c3dda7ad1dea89284037f65242f826c2"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def test_emits_one_valid_html_view():
    views = run_generator(metric_tiles_build, {})
    assert len(views) == 1
    v = views[0]
    assert_view(v)
    assert v["type"] == "html"
    assert v["id"] == "metrics"
    assert v["title"] == "Product Metrics"
    assert v["source"]["kind"] == "inline"
    assert v["layout"] == {"w": 1.2, "h": 0.8, "hint": "wide"}


def test_default_dashboard_matches_ts_mirror_sha():
    html = metric_tiles_build()[0]["source"]["value"]
    assert _sha256(html) == DEFAULT_SHA


def test_default_dashboard_is_a_real_self_contained_panel():
    html = metric_tiles_build()[0]["source"]["value"]
    assert html.startswith("<!DOCTYPE html>")
    assert html.endswith("</html>")
    assert "<title>Product Metrics</title>" in html
    assert "8 live metrics" in html  # eight default tiles
    assert "Monthly Revenue" in html
    assert "$1.24M" in html
    assert "tile__delta--up" in html  # positive trend styling
    assert "tile__delta--down" in html  # negative trend styling
    # Fully self-contained: no external resources or scripts.
    assert "<script" not in html
    assert "http://" not in html
    assert "https://" not in html


def test_classifies_deltas_and_escapes_content():
    v = metric_tiles_build(
        {
            "title": 'Ops & "Live"',
            "tiles": [
                {"label": "Errors", "value": "0.04%", "delta": "↓ 0.02%"},
                {"label": "Latency", "value": "142 ms", "delta": "→ flat"},
                {"label": "No delta", "value": "7"},
            ],
        }
    )[0]
    html = v["source"]["value"]
    assert "<title>Ops &amp; &quot;Live&quot;</title>" in html  # escaped
    assert "tile__delta--down" in html
    assert "tile__delta--flat" in html
    assert "3 live metrics" in html
    # The third tile has no delta -> no delta div for it.
    assert html.count("tile__delta ") == 2


def test_honors_custom_id_title():
    v = metric_tiles_build(
        {"id": "kpis", "title": "Q3 KPIs", "tiles": [{"label": "A", "value": "1"}]}
    )[0]
    assert v["id"] == "kpis"
    assert v["title"] == "Q3 KPIs"
    assert '<h1 class="dash__title">Q3 KPIs</h1>' in v["source"]["value"]


def test_registers_under_its_slug():
    register_metric_tiles_generator()
    assert get_generator("metric_tiles")["slug"] == "metric_tiles"
    assert metric_tiles_generator["slug"] == "metric_tiles"
