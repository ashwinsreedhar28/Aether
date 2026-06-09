"""math_sheet — Python mirror of @viewer/core's math_sheet generator.

Emits ONE `latex` View whose inline source is a small, self-contained LaTeX
document (a "formula reference"). The spatial server can run this server-side
and get a result IDENTICAL to what the TS generator emits.

The document is assembled from a FIXED list of lines joined with "\\n", so the
emitted string is byte-identical to the TS mirror (src/generators/math_sheet.ts)
for the same params. Keep the two in lockstep. Dependency-free besides the
sibling `viewer_generators` registry (imported lazily at registration time).
"""
from __future__ import annotations

DEFAULT_TITLE = "Formula Reference"


def _default_doc(title: str) -> str:
    """Default formula-reference document.

    Assembled from a fixed line list joined with "\\n" so it matches the TS
    `defaultDoc` byte-for-byte. Only the `\\title{...}` line varies (with title).
    """
    lines = [
        "\\documentclass{article}",
        "\\title{" + title + "}",
        "\\author{viewer-core}",
        "\\date{\\today}",
        "\\begin{document}",
        "\\maketitle",
        "",
        "\\section{Algebra}",
        "The roots of $ax^2 + bx + c = 0$ are given by the quadratic formula:",
        "\\begin{equation}",
        "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
        "\\end{equation}",
        "",
        "\\section{Analysis}",
        "The Gaussian integral over the real line:",
        "\\begin{equation}",
        "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
        "\\end{equation}",
        "Euler's solution to the Basel problem:",
        "\\begin{equation}",
        "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
        "\\end{equation}",
        "",
        "\\section{Linear Algebra}",
        "The determinant of a $2 \\times 2$ matrix:",
        "\\begin{equation}",
        "\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc",
        "\\end{equation}",
        "",
        "\\section{Identities}",
        "Euler's identity unites five fundamental constants:",
        "\\begin{equation}",
        "e^{i\\pi} + 1 = 0",
        "\\end{equation}",
        "\\end{document}",
    ]
    return "\n".join(lines)


def math_sheet_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one latex View (as a dict)."""
    params = params or {}
    title = params.get("title", DEFAULT_TITLE)
    content = params.get("latex")
    if content is None:
        content = _default_doc(title)
    return [
        {
            "id": params.get("id", "math"),
            "type": "latex",
            "title": title,
            "source": {"kind": "inline", "value": content},
            "layout": {"w": 0.9, "h": 1.2, "hint": "tall"},
        }
    ]


math_sheet_generator: dict = {
    "slug": "math_sheet",
    "describe": "Emit a latex View rendering a math formula reference (defaults to a demo sheet).",
    "generate": math_sheet_build,
}


def register_math_sheet_generator() -> None:
    """Register the math_sheet generator with the shared registry."""
    from viewer_generators import register_generator

    register_generator(math_sheet_generator)
