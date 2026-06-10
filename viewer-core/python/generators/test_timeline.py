"""timeline generator (Python side) + cross-language parity pin.

The default HTML document is deterministic, so its byte-exact SHA-256 is a stable
contract. The vitest suite (src/generators/timeline.test.ts) asserts the SAME
hash against the TS `build`. One constant, two readers: if either side's HTML
drifts by a single byte, that side turns red.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators` / `timeline`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import get_generator, run_generator  # noqa: E402
from timeline import (  # noqa: E402
    register_timeline_generator,
    timeline_build,
    timeline_generator,
)

# Byte-exact SHA-256 of the default timeline's source.value. Must equal the TS pin.
DEFAULT_SHA = "43f5123a5ee93b1a36dc0f9c288ff44cd05ea9c3a548374bd7ea67ca38dd530f"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def test_emits_one_valid_html_view():
    views = run_generator(timeline_build, {})
    assert len(views) == 1
    v = views[0]
    assert_view(v)
    assert v["type"] == "html"
    assert v["id"] == "timeline"
    assert v["title"] == "Viewer Ecosystem Roadmap"
    assert v["source"]["kind"] == "inline"
    assert v["layout"] == {"w": 0.9, "h": 1, "hint": "tall"}


def test_default_document_matches_ts_mirror_sha():
    html = timeline_build()[0]["source"]["value"]
    assert _sha256(html) == DEFAULT_SHA


def test_default_document_is_a_real_self_contained_timeline():
    html = timeline_build()[0]["source"]["value"]
    assert html.startswith("<!doctype html>")
    assert "<style>" in html  # inline CSS only
    assert "<script" not in html  # no external/inline scripts
    assert "http://" not in html
    assert "https://" not in html
    assert "background:#0d1117" in html  # dark theme
    assert "ol.timeline::before" in html  # the vertical line
    assert "li.event::before" in html  # the dots
    assert "View contract v1" in html  # a real event
    assert "Public demo gallery" in html  # the last event
    assert html.count('<li class="event">') == 7  # 7 events


def test_honors_custom_params_and_escapes_html():
    v = timeline_build(
        {
            "id": "hist",
            "title": "A & B <release>",
            "subtitle": 'sub "q"',
            "events": [{"date": "2026", "title": "Ship <v1>", "body": "a & b"}],
        }
    )[0]
    assert v["id"] == "hist"
    assert v["title"] == "A & B <release>"
    html = v["source"]["value"]
    assert '<h1 class="timeline-title">A &amp; B &lt;release&gt;</h1>' in html
    assert '<p class="timeline-sub">sub &quot;q&quot;</p>' in html
    assert '<div class="event-title">Ship &lt;v1&gt;</div>' in html
    assert '<p class="event-body">a &amp; b</p>' in html
    assert html.count('<li class="event">') == 1


def test_registers_under_its_slug():
    register_timeline_generator()
    assert get_generator("timeline")["slug"] == "timeline"
    assert timeline_generator["slug"] == "timeline"
