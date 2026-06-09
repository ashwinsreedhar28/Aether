"""image_gallery generator coverage + cross-language parity pin (Python side).

DEFAULT_SHA below is the byte-exact SHA-256 of the default gallery's source.value.
The vitest suite (src/generators/image_gallery.test.ts) pins the SAME hash. Both
generators must emit byte-identical HTML, so the TS and Python sides cannot drift.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `image_gallery` + `viewer_generators`

from viewer_core import assert_view  # noqa: E402
from image_gallery import (  # noqa: E402
    image_gallery_build,
    image_gallery_generator,
    register_image_gallery_generator,
)
from viewer_generators import get_generator, run_generator  # noqa: E402

# Byte-identical to src/generators/image_gallery.test.ts::DEFAULT_SHA.
DEFAULT_SHA = "755fd9bceaf9a3e1b263308ec40a58068664958ac52a206d0e3974f62ec7e91b"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def test_default_build_emits_one_valid_html_view():
    views = image_gallery_build()
    assert len(views) == 1
    v = views[0]
    assert_view(v)
    assert v["type"] == "html"
    assert v["id"] == "gallery"
    assert v["title"] == "Spatial Gallery"
    assert v["source"]["kind"] == "inline"
    assert v["layout"] == {"w": 1.4, "h": 1, "hint": "wide"}


def test_default_source_value_sha_matches_ts_pin():
    # Cross-language parity pin — same hash as the vitest suite.
    assert _sha256(image_gallery_build()[0]["source"]["value"]) == DEFAULT_SHA


def test_default_document_is_self_contained_dark_grid():
    html = image_gallery_build()[0]["source"]["value"]
    assert html.startswith("<!doctype html>")
    assert "background:#0b0d12" in html  # dark theme
    assert "grid-template-columns:repeat(auto-fill,minmax(260px,1fr))" in html
    assert "<linearGradient" in html
    assert "Nebula" in html
    assert "Crystalline lattice" in html
    # Fully self-contained: no external asset loads (the only http URI is the
    # SVG XML namespace, which is an identifier, not a network fetch).
    assert 'src="http' not in html
    assert 'href="http' not in html
    assert "url(http" not in html
    assert "https://" not in html


def test_default_has_six_inline_svg_tiles():
    html = image_gallery_build()[0]["source"]["value"]
    assert html.count('<figure class="card">') == 6
    assert html.count("<svg ") == 6


def test_honors_custom_images_and_escaping():
    view = image_gallery_build(
        {
            "id": "shots",
            "title": "Render <Farm>",
            "images": [
                {"src": "data:image/png;base64,AAAA", "caption": 'Frame "01"'},
                {"src": "data:image/png;base64,BBBB", "caption": "Frame 02 & 03"},
            ],
        }
    )[0]
    assert view["id"] == "shots"
    assert view["title"] == "Render <Farm>"
    html = view["source"]["value"]
    assert "<h1>Render &lt;Farm&gt;</h1>" in html
    assert '<img src="data:image/png;base64,AAAA"' in html
    assert "Frame &quot;01&quot;" in html
    assert "Frame 02 &amp; 03" in html
    assert "2 panels - self-contained, no external assets" in html
    assert "<svg " not in html  # no default tiles when images given


def test_honors_custom_subtitle():
    html = image_gallery_build({"subtitle": "Curated set"})[0]["source"]["value"]
    assert '<p class="sub">Curated set</p>' in html


def test_emitted_view_is_valid_via_runner():
    views = run_generator(image_gallery_build, {})
    assert_view(views[0])
    assert views[0]["type"] == "html"


def test_register_adds_entry_to_shared_registry():
    register_image_gallery_generator()
    assert get_generator("image_gallery")["slug"] == "image_gallery"
    assert image_gallery_generator["describe"].startswith("Emit an html View")
