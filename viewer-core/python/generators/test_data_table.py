"""data_table generator coverage + cross-language parity (Python side).

The EXPECTED_CSV constant below is byte-identical to the one pinned in the vitest
suite (src/generators/data_table.test.ts). Both sides assert their generator's
`source.value` equals this exact string, so the two generators cannot drift: a
shape change on either side turns that side's run red.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `data_table`

from viewer_core import assert_view  # noqa: E402
from data_table import (  # noqa: E402
    DEFAULT_ROWS,
    data_table_build,
    data_table_generator,
    register_data_table_generator,
)

# Byte-exact mirror of the TS EXPECTED_CSV. The parity contract lives here.
EXPECTED_CSV = (
    "Date,Focus,Exercises,Sets,Volume (lbs)\n"
    "5 Oct 2025,Back & Biceps,7,24,17190\n"
    "7 Oct 2025,Full Body,5,16,16156\n"
    "8 Oct 2025,Chest & Triceps,6,22,9350\n"
    "12 Oct 2025,Back & Biceps,5,18,14020\n"
    "22 Oct 2025,Back & Biceps,5,18,16380\n"
    "23 Oct 2025,Chest & Triceps,4,16,13670\n"
    "26 Oct 2025,Back & Biceps,3,11,9750\n"
    "28 Oct 2025,Legs,5,15,19000\n"
    "30 Oct 2025,Chest & Triceps,5,19,11900\n"
    "2 Nov 2025,Back & Biceps,4,16,14680"
)


def test_default_emits_one_valid_table_view():
    views = data_table_build()
    assert len(views) == 1
    view = views[0]
    assert_view(view)
    assert view["type"] == "table"
    assert view["id"] == "table"
    assert view["title"] == "Training Log"
    assert view["source"]["kind"] == "inline"
    assert view["source"]["mediaType"] == "text/csv"


def test_default_content_is_byte_exact_csv():
    view = data_table_build()[0]
    assert view["source"]["value"] == EXPECTED_CSV


def test_default_csv_shape_is_populated():
    rows = data_table_build()[0]["source"]["value"].split("\n")
    assert len(rows) == len(DEFAULT_ROWS) + 1  # header + body
    header = rows[0].split(",")
    assert header == ["Date", "Focus", "Exercises", "Sets", "Volume (lbs)"]
    for line in rows[1:]:
        assert len(line.split(",")) == 5


def test_custom_csv_is_used_verbatim():
    csv = "a,b\n1,2"
    view = data_table_build({"csv": csv, "title": "Custom"})[0]
    assert view["source"]["value"] == csv
    assert view["title"] == "Custom"


def test_csv_with_comma_is_quoted():
    csv = data_table_build({"csv": 'name,note\nAcme,"a, b"'})[0]["source"]["value"]
    assert '"a, b"' in csv


def test_generator_entry_shape():
    assert data_table_generator["slug"] == "data_table"
    assert callable(data_table_generator["generate"])


def test_register_uses_supplied_registry():
    captured = {}
    register_data_table_generator(lambda entry: captured.update(entry))
    assert captured["slug"] == "data_table"


def test_id_and_title_overridable():
    view = data_table_build({"id": "log1", "title": "Q4"})[0]
    assert view["id"] == "log1"
    assert view["title"] == "Q4"
