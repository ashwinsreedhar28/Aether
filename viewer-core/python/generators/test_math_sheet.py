"""math_sheet generator coverage + cross-language parity anchor (Python side).

EXPECTED_VALUE below is the byte-exact default ``source.value`` string. The
vitest suite (src/generators/math_sheet.test.ts) pins the SAME literal. Both
generators assemble the document from a fixed line list joined with "\\n", so
if either side drifts, its equality assertion turns red.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators` / `math_sheet`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import (  # noqa: E402
    get_generator,
    list_generators,
    run_generator,
)
from math_sheet import (  # noqa: E402
    math_sheet_build,
    math_sheet_generator,
    register_math_sheet_generator,
)

EXPECTED_VALUE = "\\documentclass{article}\n\\title{Formula Reference}\n\\author{viewer-core}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\n\\section{Algebra}\nThe roots of $ax^2 + bx + c = 0$ are given by the quadratic formula:\n\\begin{equation}\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n\\end{equation}\n\n\\section{Analysis}\nThe Gaussian integral over the real line:\n\\begin{equation}\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n\\end{equation}\nEuler's solution to the Basel problem:\n\\begin{equation}\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n\\end{equation}\n\n\\section{Linear Algebra}\nThe determinant of a $2 \\times 2$ matrix:\n\\begin{equation}\n\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc\n\\end{equation}\n\n\\section{Identities}\nEuler's identity unites five fundamental constants:\n\\begin{equation}\ne^{i\\pi} + 1 = 0\n\\end{equation}\n\\end{document}"


def test_default_build_emits_one_well_formed_latex_view():
    views = math_sheet_build()
    assert len(views) == 1
    v = views[0]
    assert v["id"] == "math"
    assert v["type"] == "latex"
    assert v["title"] == "Formula Reference"
    assert v["source"] == {"kind": "inline", "value": EXPECTED_VALUE}
    assert v["layout"] == {"w": 0.9, "h": 1.2, "hint": "tall"}


def test_default_document_is_the_parity_anchor():
    value = math_sheet_build()[0]["source"]["value"]
    assert value == EXPECTED_VALUE
    # five sections of real formulas, not lorem ipsum
    assert "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" in value  # quadratic
    assert "\\int_{-\\infty}^{\\infty} e^{-x^2}" in value  # Gaussian integral
    assert "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}" in value  # Basel sum
    assert "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" in value  # matrix
    assert "e^{i\\pi} + 1 = 0" in value  # Euler's identity
    assert value.count("\\section{") == 4
    assert value.count("\\begin{equation}") == 5


def test_title_and_verbatim_latex_overrides():
    t = math_sheet_build({"id": "m2", "title": "Cheat Sheet"})[0]
    assert t["id"] == "m2"
    assert t["title"] == "Cheat Sheet"
    assert "\\title{Cheat Sheet}" in t["source"]["value"]

    custom = "\\documentclass{article}\\begin{document}$E=mc^2$\\end{document}"
    c = math_sheet_build({"latex": custom})[0]
    assert c["source"]["value"] == custom


def test_emitted_view_is_valid():
    views = run_generator(math_sheet_build, {})
    assert_view(views[0])
    assert views[0]["type"] == "latex"


def test_run_generator_accepts_entry_dict():
    views = run_generator(math_sheet_generator, {})
    assert views[0]["type"] == "latex"


def test_registers_under_math_sheet_slug():
    register_math_sheet_generator()
    assert get_generator("math_sheet")["slug"] == "math_sheet"
    assert "math_sheet" in [g["slug"] for g in list_generators()]


def test_run_generator_rejects_non_list():
    with pytest.raises(ValueError, match="must return a list"):
        run_generator(lambda _p: {"not": "a list"}, {})
