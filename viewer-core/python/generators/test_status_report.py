"""status_report generator (Python side) + cross-language parity pin.

The default markdown document is deterministic, so its byte-exact SHA-256 is a
stable contract. The vitest suite (src/generators/status_report.test.ts) asserts
the SAME hash against the TS `build`. One constant, two readers: if either side's
markdown drifts by a single byte, that side turns red.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators` / `status_report`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import get_generator, run_generator  # noqa: E402
from status_report import (  # noqa: E402
    register_status_report_generator,
    status_report_build,
    status_report_generator,
)

# Byte-exact SHA-256 of the default report's source.value. Must equal the TS pin.
DEFAULT_SHA = "d35b2a13faef2c8aa52eb48b319468aeecdd8efe24a283df2fbb217c9e6a1de2"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def test_emits_one_valid_markdown_view():
    views = run_generator(status_report_build, {})
    assert len(views) == 1
    v = views[0]
    assert_view(v)
    assert v["type"] == "markdown"
    assert v["id"] == "status"
    assert v["title"] == "Daily Ops Briefing"
    assert v["source"]["kind"] == "inline"
    assert v["layout"] == {"w": 0.8, "h": 1, "hint": "tall"}


def test_default_document_matches_ts_mirror_sha():
    md = status_report_build()[0]["source"]["value"]
    assert _sha256(md) == DEFAULT_SHA


def test_default_document_is_a_real_structured_report():
    md = status_report_build()[0]["source"]["value"]
    assert md.startswith("# Daily Ops Briefing")
    assert "| Metric | Today | 7-day avg | Trend |" in md  # a table
    assert "> All primary services green." in md  # a blockquote
    assert "**Checkout latency Sev-2 resolved**" in md  # bold
    assert "## Next 24 Hours" in md  # multiple sections
    assert "1. Promote the search rollout" in md  # numbered list


def test_honors_custom_params():
    v = status_report_build(
        {
            "id": "q3",
            "title": "Q3 Review",
            "subtitle": "Board edition",
            "summary": "Strong quarter.",
            "sections": [{"heading": "Revenue", "body": "- Up **12%** YoY."}],
        }
    )[0]
    assert v["id"] == "q3"
    assert v["title"] == "Q3 Review"
    assert v["source"]["value"] == (
        "# Q3 Review\n\n_Board edition_\n\n> Strong quarter.\n\n## Revenue\n\n- Up **12%** YoY."
    )


def test_registers_under_its_slug():
    register_status_report_generator()
    assert get_generator("status_report")["slug"] == "status_report"
    assert status_report_generator["slug"] == "status_report"
