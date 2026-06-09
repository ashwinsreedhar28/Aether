/**
 * The math_sheet generator — a LaTeX "formula reference" demo View.
 *
 * A pure `build(params) -> View[]` that emits ONE `latex` View whose inline
 * source is a small, self-contained LaTeX document. The shared latex renderer
 * (renderers/latex.tsx) parses `data.content` (the host resolves
 * `source.value` into it) and renders the math with KaTeX. Everything here
 * stays inside the renderer's supported subset: \title/\author/\date +
 * \maketitle, \section, paragraph text, inline $...$, and \begin{equation}
 * blocks containing KaTeX-renderable math (\frac, \sqrt, \pm, \int, \sum,
 * \pmatrix, Greek, e^{i\pi}, ...).
 *
 * The document is assembled from a FIXED list of lines joined with "\n", so the
 * emitted string is byte-identical to the Python mirror
 * (python/generators/math_sheet.py) for the same params — that string identity
 * is what the parity tests pin down. Calling with no params yields the default
 * formula reference (quadratic formula, Gaussian integral, Basel sum, a 2x2
 * determinant, Euler's identity).
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface MathSheetParams {
  id?: string;
  title?: string;
  /** Full LaTeX document source. When present it is emitted verbatim. */
  latex?: string;
}

const DEFAULT_TITLE = 'Formula Reference';

/**
 * Build the default formula-reference document. Assembled from a fixed line
 * list joined with "\n" so it matches the Python mirror's `_default_doc`
 * byte-for-byte. Only the `\title{...}` line varies (with `title`).
 */
function defaultDoc(title: string): string {
  const lines = [
    '\\documentclass{article}',
    '\\title{' + title + '}',
    '\\author{viewer-core}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\section{Algebra}',
    'The roots of $ax^2 + bx + c = 0$ are given by the quadratic formula:',
    '\\begin{equation}',
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    '\\end{equation}',
    '',
    '\\section{Analysis}',
    'The Gaussian integral over the real line:',
    '\\begin{equation}',
    '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
    '\\end{equation}',
    "Euler's solution to the Basel problem:",
    '\\begin{equation}',
    '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
    '\\end{equation}',
    '',
    '\\section{Linear Algebra}',
    'The determinant of a $2 \\times 2$ matrix:',
    '\\begin{equation}',
    '\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc',
    '\\end{equation}',
    '',
    '\\section{Identities}',
    "Euler's identity unites five fundamental constants:",
    '\\begin{equation}',
    'e^{i\\pi} + 1 = 0',
    '\\end{equation}',
    '\\end{document}',
  ];
  return lines.join('\n');
}

/** Pure build: params -> exactly one latex View. */
export function build(params: MathSheetParams = {}): View[] {
  const title = params.title ?? DEFAULT_TITLE;
  const content = params.latex ?? defaultDoc(title);
  const view: View = {
    id: params.id ?? 'math',
    type: 'latex',
    title,
    source: { kind: 'inline', value: content },
    layout: { w: 0.9, h: 1.2, hint: 'tall' },
  };
  return [view];
}

export const mathSheetGenerator: GeneratorEntry<MathSheetParams> = {
  slug: 'math_sheet',
  describe: 'Emit a latex View rendering a math formula reference (defaults to a demo sheet).',
  generate: build,
};

/** Register the math_sheet generator with the shared registry. */
export function registerMathSheetGenerator(): void {
  registerGenerator(mathSheetGenerator as GeneratorEntry);
}
