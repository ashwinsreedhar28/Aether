/**
 * math_sheet generator coverage + cross-language parity anchor (TS side).
 *
 * EXPECTED_VALUE below is the byte-exact default `source.value` string. The
 * Python suite (python/generators/test_math_sheet.py) pins the SAME literal.
 * Both generators assemble the document from a fixed line list joined with
 * "\n", so if either side drifts, its `toEqual(EXPECTED_VALUE)` turns red.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LatexRenderer } from '../renderers/latex';
import type { ResolvedViewData } from '../schema/view';
import { build, mathSheetGenerator, registerMathSheetGenerator } from './math_sheet';
import {
  runGenerator,
  getGenerator,
  listGenerators,
  registerGenerator,
  _resetGenerators,
} from './runGenerator';

const EXPECTED_VALUE =
  '\\documentclass{article}\n\\title{Formula Reference}\n\\author{viewer-core}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\n\\section{Algebra}\nThe roots of $ax^2 + bx + c = 0$ are given by the quadratic formula:\n\\begin{equation}\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n\\end{equation}\n\n\\section{Analysis}\nThe Gaussian integral over the real line:\n\\begin{equation}\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n\\end{equation}\nEuler\'s solution to the Basel problem:\n\\begin{equation}\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n\\end{equation}\n\n\\section{Linear Algebra}\nThe determinant of a $2 \\times 2$ matrix:\n\\begin{equation}\n\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc\n\\end{equation}\n\n\\section{Identities}\nEuler\'s identity unites five fundamental constants:\n\\begin{equation}\ne^{i\\pi} + 1 = 0\n\\end{equation}\n\\end{document}';

describe('math_sheet generator', () => {
  it('default build emits exactly one well-formed latex View', () => {
    const views = build();
    expect(views).toHaveLength(1);
    const v = views[0];
    expect(v.id).toBe('math');
    expect(v.type).toBe('latex');
    expect(v.title).toBe('Formula Reference');
    expect(v.source).toEqual({ kind: 'inline', value: EXPECTED_VALUE });
    expect(v.layout).toEqual({ w: 0.9, h: 1.2, hint: 'tall' });
  });

  it('default document carries real, renderable math (the parity anchor)', () => {
    const value = build()[0].source.value;
    expect(value).toBe(EXPECTED_VALUE);
    // five sections of real formulas, not lorem ipsum
    expect(value).toContain('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'); // quadratic
    expect(value).toContain('\\int_{-\\infty}^{\\infty} e^{-x^2}'); // Gaussian integral
    expect(value).toContain('\\sum_{n=1}^{\\infty} \\frac{1}{n^2}'); // Basel sum
    expect(value).toContain('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'); // matrix
    expect(value).toContain('e^{i\\pi} + 1 = 0'); // Euler's identity
    expect((value.match(/\\section\{/g) ?? []).length).toBe(4);
    expect((value.match(/\\begin\{equation\}/g) ?? []).length).toBe(5);
  });

  it('honors title and verbatim latex overrides', () => {
    const t = build({ id: 'm2', title: 'Cheat Sheet' })[0];
    expect(t.id).toBe('m2');
    expect(t.title).toBe('Cheat Sheet');
    expect(t.source.value).toContain('\\title{Cheat Sheet}');

    const custom = '\\documentclass{article}\\begin{document}$E=mc^2$\\end{document}';
    const c = build({ latex: custom })[0];
    expect(c.source.value).toBe(custom);
  });

  it('emits a View that passes runGenerator validation', () => {
    const [view] = runGenerator(mathSheetGenerator, {});
    expect(view.type).toBe('latex');
  });

  it('registers under the math_sheet slug', () => {
    _resetGenerators();
    registerMathSheetGenerator();
    expect(getGenerator('math_sheet')?.describe).toMatch(/latex/i);
    expect(listGenerators().map((g) => g.slug)).toContain('math_sheet');
    // re-register via the bare entry too (mirrors kg coverage)
    registerGenerator(mathSheetGenerator);
    expect(getGenerator('math_sheet')?.slug).toBe('math_sheet');
  });

  it('renders through the shared latex renderer (KaTeX-backed math shows up)', () => {
    const [view] = runGenerator(build, {});
    const data: ResolvedViewData = { content: view.source.value, isUrl: false };
    const html = renderToStaticMarkup(<LatexRenderer view={view} data={data} />);
    expect(html).toContain('Formula Reference'); // \maketitle title
    expect(html).toContain('Algebra'); // section heading
    expect(html).toContain('katex'); // KaTeX emitted markup for the equations
    expect(html).not.toContain('Math Error');
  });
});
