/**
 * LaTeX renderer — a lightweight LaTeX-subset to React renderer backed by KaTeX
 * for math. Supports preview / source / split modes.
 *
 * Pure: it parses `data.content` (the document source) and renders it. The
 * parser is dependency-free apart from KaTeX and was lifted verbatim from the
 * desktop latex-viewer (which had no file-IO coupling in its parser).
 */
import { useState, type ReactNode } from 'react';
import katex from 'katex';
import type { ViewRendererProps } from './registry';

type ViewMode = 'preview' | 'source' | 'split';

function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, trust: true });
  } catch {
    return `<span class="text-red-400">[Math Error: ${latex}]</span>`;
  }
}

function extractCommandContent(
  text: string,
  command: string
): { content: string; rest: string } | null {
  const regex = new RegExp(`\\\\${command}\\{`);
  const match = text.match(regex);
  if (!match) return null;
  const startIndex = match.index! + match[0].length;
  let braceCount = 1;
  let endIndex = startIndex;
  while (braceCount > 0 && endIndex < text.length) {
    if (text[endIndex] === '{') braceCount++;
    else if (text[endIndex] === '}') braceCount--;
    endIndex++;
  }
  return { content: text.slice(startIndex, endIndex - 1), rest: text.slice(endIndex) };
}

function parseInline(text: string): ReactNode[] {
  const elements: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const displayMathMatch =
      remaining.match(/^\$\$([\s\S]*?)\$\$/) || remaining.match(/^\\\[([\s\S]*?)\\\]/);
    if (displayMathMatch) {
      elements.push(
        <div
          key={key++}
          className="my-4 text-center"
          dangerouslySetInnerHTML={{ __html: renderMath(displayMathMatch[1], true) }}
        />
      );
      remaining = remaining.slice(displayMathMatch[0].length);
      continue;
    }

    const inlineMathMatch = remaining.match(/^\$([^$]+)\$/);
    if (inlineMathMatch) {
      elements.push(
        <span
          key={key++}
          dangerouslySetInnerHTML={{ __html: renderMath(inlineMathMatch[1], false) }}
        />
      );
      remaining = remaining.slice(inlineMathMatch[0].length);
      continue;
    }

    const boldResult = extractCommandContent(remaining, 'textbf');
    if (boldResult && remaining.startsWith('\\textbf{')) {
      elements.push(<strong key={key++}>{parseInline(boldResult.content)}</strong>);
      remaining = boldResult.rest;
      continue;
    }

    const italicResult =
      extractCommandContent(remaining, 'textit') || extractCommandContent(remaining, 'emph');
    if (italicResult && (remaining.startsWith('\\textit{') || remaining.startsWith('\\emph{'))) {
      elements.push(<em key={key++}>{parseInline(italicResult.content)}</em>);
      remaining = italicResult.rest;
      continue;
    }

    const underlineResult = extractCommandContent(remaining, 'underline');
    if (underlineResult && remaining.startsWith('\\underline{')) {
      elements.push(<u key={key++}>{parseInline(underlineResult.content)}</u>);
      remaining = underlineResult.rest;
      continue;
    }

    const codeResult = extractCommandContent(remaining, 'texttt');
    if (codeResult && remaining.startsWith('\\texttt{')) {
      elements.push(
        <code key={key++} className="px-1 py-0.5 bg-[rgba(0,0,0,0.3)] rounded text-sm font-mono">
          {codeResult.content}
        </code>
      );
      remaining = codeResult.rest;
      continue;
    }

    const hrefMatch = remaining.match(/^\\href\{([^}]*)\}\{([^}]*)\}/);
    if (hrefMatch) {
      elements.push(
        <a
          key={key++}
          href={hrefMatch[1]}
          className="text-blue-400 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {hrefMatch[2]}
        </a>
      );
      remaining = remaining.slice(hrefMatch[0].length);
      continue;
    }

    if (remaining.startsWith('\\\\')) {
      elements.push(<br key={key++} />);
      remaining = remaining.slice(2);
      continue;
    }
    if (remaining.startsWith('~')) {
      elements.push(<span key={key++}>&nbsp;</span>);
      remaining = remaining.slice(1);
      continue;
    }
    const escapes: Record<string, string> = {
      '\\%': '%',
      '\\&': '&',
      '\\#': '#',
      '\\$': '$',
      '\\{': '{',
      '\\}': '}',
    };
    const escapeKey = Object.keys(escapes).find((k) => remaining.startsWith(k));
    if (escapeKey) {
      elements.push(<span key={key++}>{escapes[escapeKey]}</span>);
      remaining = remaining.slice(2);
      continue;
    }

    const nextSpecial = remaining.search(
      /\$|\\textbf|\\textit|\\emph|\\underline|\\texttt|\\href|\\\\|~|\\%|\\&|\\#|\\\$|\\\{|\\\}/
    );
    if (nextSpecial === -1) {
      elements.push(<span key={key++}>{remaining}</span>);
      break;
    } else if (nextSpecial === 0) {
      elements.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      elements.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

function parseList(content: string, ordered: boolean): ReactNode {
  const items: string[] = [];
  const itemMatches = content.split(/\\item\s*/);
  for (let i = 1; i < itemMatches.length; i++) items.push(itemMatches[i].trim());
  const ListTag = ordered ? 'ol' : 'ul';
  const listClass = ordered
    ? 'list-decimal list-inside my-2 space-y-1 ml-4'
    : 'list-disc list-inside my-2 space-y-1 ml-4';
  return (
    <ListTag className={listClass}>
      {items.map((item, index) => (
        <li key={index}>{parseInline(item)}</li>
      ))}
    </ListTag>
  );
}

export function parseLatex(source: string): ReactNode {
  const elements: ReactNode[] = [];
  let key = 0;

  const docMatch = source.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  const content = docMatch ? docMatch[1] : source;

  const titleMatch = source.match(/\\title\{([^}]*)\}/);
  const authorMatch = source.match(/\\author\{([^}]*)\}/);
  const dateMatch = source.match(/\\date\{([^}]*)\}/);

  if (source.includes('\\maketitle')) {
    if (titleMatch) {
      elements.push(
        <h1 key={key++} className="text-3xl font-bold text-center mb-2">
          {parseInline(titleMatch[1])}
        </h1>
      );
    }
    if (authorMatch) {
      elements.push(
        <p key={key++} className="text-lg text-center text-[var(--holo-muted)] mb-1">
          {parseInline(authorMatch[1])}
        </p>
      );
    }
    if (dateMatch) {
      const dateContent =
        dateMatch[1] === '\\today' ? new Date().toLocaleDateString() : dateMatch[1];
      elements.push(
        <p key={key++} className="text-sm text-center text-[var(--holo-muted)] mb-6">
          {dateContent}
        </p>
      );
    }
  }

  let remaining = content;
  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;

    const abstractMatch = remaining.match(/^\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
    if (abstractMatch) {
      elements.push(
        <div key={key++} className="my-6 mx-8 p-4 border-l-2 border-[var(--holo-border)] italic">
          <p className="font-bold text-sm mb-2 not-italic">Abstract</p>
          {parseInline(abstractMatch[1].trim())}
        </div>
      );
      remaining = remaining.slice(abstractMatch[0].length);
      continue;
    }

    const sectionMatch = remaining.match(/^\\section\*?\{([^}]*)\}/);
    if (sectionMatch) {
      elements.push(
        <h2
          key={key++}
          className="text-2xl font-bold mt-8 mb-4 border-b border-[var(--holo-border)] pb-2"
        >
          {parseInline(sectionMatch[1])}
        </h2>
      );
      remaining = remaining.slice(sectionMatch[0].length);
      continue;
    }

    const subsectionMatch = remaining.match(/^\\subsection\*?\{([^}]*)\}/);
    if (subsectionMatch) {
      elements.push(
        <h3 key={key++} className="text-xl font-semibold mt-6 mb-3">
          {parseInline(subsectionMatch[1])}
        </h3>
      );
      remaining = remaining.slice(subsectionMatch[0].length);
      continue;
    }

    const subsubsectionMatch = remaining.match(/^\\subsubsection\*?\{([^}]*)\}/);
    if (subsubsectionMatch) {
      elements.push(
        <h4 key={key++} className="text-lg font-medium mt-4 mb-2">
          {parseInline(subsubsectionMatch[1])}
        </h4>
      );
      remaining = remaining.slice(subsubsectionMatch[0].length);
      continue;
    }

    const paragraphMatch = remaining.match(/^\\paragraph\{([^}]*)\}/);
    if (paragraphMatch) {
      elements.push(
        <p key={key++} className="mt-4 mb-2">
          <strong>{parseInline(paragraphMatch[1])}</strong>
        </p>
      );
      remaining = remaining.slice(paragraphMatch[0].length);
      continue;
    }

    const itemizeMatch = remaining.match(/^\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/);
    if (itemizeMatch) {
      elements.push(<div key={key++}>{parseList(itemizeMatch[1], false)}</div>);
      remaining = remaining.slice(itemizeMatch[0].length);
      continue;
    }

    const enumerateMatch = remaining.match(/^\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/);
    if (enumerateMatch) {
      elements.push(<div key={key++}>{parseList(enumerateMatch[1], true)}</div>);
      remaining = remaining.slice(enumerateMatch[0].length);
      continue;
    }

    const quoteMatch = remaining.match(
      /^\\begin\{(?:quote|quotation)\}([\s\S]*?)\\end\{(?:quote|quotation)\}/
    );
    if (quoteMatch) {
      elements.push(
        <blockquote
          key={key++}
          className="my-4 pl-4 border-l-2 border-[var(--holo-border)] italic text-[var(--holo-muted)]"
        >
          {parseInline(quoteMatch[1].trim())}
        </blockquote>
      );
      remaining = remaining.slice(quoteMatch[0].length);
      continue;
    }

    const verbatimMatch = remaining.match(/^\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/);
    if (verbatimMatch) {
      elements.push(
        <pre
          key={key++}
          className="my-4 p-4 bg-[rgba(0,0,0,0.3)] rounded font-mono text-sm overflow-x-auto"
        >
          {verbatimMatch[1]}
        </pre>
      );
      remaining = remaining.slice(verbatimMatch[0].length);
      continue;
    }

    const equationMatch = remaining.match(/^\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/);
    if (equationMatch) {
      elements.push(
        <div
          key={key++}
          className="my-4 text-center"
          dangerouslySetInnerHTML={{ __html: renderMath(equationMatch[1].trim(), true) }}
        />
      );
      remaining = remaining.slice(equationMatch[0].length);
      continue;
    }

    const alignMatch = remaining.match(/^\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/);
    if (alignMatch) {
      elements.push(
        <div
          key={key++}
          className="my-4 text-center"
          dangerouslySetInnerHTML={{
            __html: renderMath('\\begin{aligned}' + alignMatch[1].trim() + '\\end{aligned}', true),
          }}
        />
      );
      remaining = remaining.slice(alignMatch[0].length);
      continue;
    }

    const displayMathMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/);
    if (displayMathMatch) {
      elements.push(
        <div
          key={key++}
          className="my-4 text-center"
          dangerouslySetInnerHTML={{ __html: renderMath(displayMathMatch[1], true) }}
        />
      );
      remaining = remaining.slice(displayMathMatch[0].length);
      continue;
    }

    const displayMathMatch2 = remaining.match(/^\\\[([\s\S]*?)\\\]/);
    if (displayMathMatch2) {
      elements.push(
        <div
          key={key++}
          className="my-4 text-center"
          dangerouslySetInnerHTML={{ __html: renderMath(displayMathMatch2[1], true) }}
        />
      );
      remaining = remaining.slice(displayMathMatch2[0].length);
      continue;
    }

    if (remaining.match(/^\\(?:maketitle|tableofcontents|newpage|clearpage|pagebreak)\b/)) {
      const cmdMatch = remaining.match(
        /^\\(?:maketitle|tableofcontents|newpage|clearpage|pagebreak)\b/
      );
      remaining = remaining.slice(cmdMatch![0].length);
      continue;
    }

    if (remaining.startsWith('%')) {
      const lineEnd = remaining.indexOf('\n');
      remaining = lineEnd === -1 ? '' : remaining.slice(lineEnd + 1);
      continue;
    }

    const nextStructure = remaining.search(
      /\\(?:section|subsection|subsubsection|paragraph|begin|end|\[)|^\s*$/m
    );
    if (nextStructure === -1 || nextStructure > 0) {
      const paraEnd = nextStructure === -1 ? remaining.length : nextStructure;
      const paraText = remaining.slice(0, paraEnd).trim();
      const paragraphs = paraText.split(/\n\s*\n/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (trimmed && !trimmed.startsWith('%')) {
          elements.push(
            <p key={key++} className="my-3 leading-relaxed">
              {parseInline(trimmed.replace(/\s+/g, ' '))}
            </p>
          );
        }
      }
      remaining = nextStructure === -1 ? '' : remaining.slice(paraEnd);
    } else {
      remaining = remaining.slice(1);
    }
  }

  return <div className="latex-document">{elements}</div>;
}

const modeBtn = (active: boolean) =>
  `px-2 py-1 text-xs rounded transition-colors ${
    active
      ? 'bg-[var(--holo-accent)] text-white'
      : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
  }`;

export function LatexRenderer({ view, data }: ViewRendererProps) {
  const [mode, setMode] = useState<ViewMode>('preview');

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <span className="text-xs text-[var(--holo-muted)] truncate max-w-[200px]">
          {view.title ?? 'LaTeX'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setMode('preview')} className={modeBtn(mode === 'preview')}>
            Preview
          </button>
          <button onClick={() => setMode('source')} className={modeBtn(mode === 'source')}>
            Source
          </button>
          <button onClick={() => setMode('split')} className={modeBtn(mode === 'split')}>
            Split
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden flex">
        {(mode === 'source' || mode === 'split') && (
          <div
            className={`${
              mode === 'split' ? 'w-1/2 border-r border-[var(--holo-border)]' : 'w-full'
            } overflow-auto`}
          >
            <pre className="p-4 text-sm font-mono text-[var(--holo-text)] leading-relaxed whitespace-pre-wrap">
              {data.content}
            </pre>
          </div>
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div
            className={`${
              mode === 'split' ? 'w-1/2' : 'w-full'
            } overflow-auto bg-[rgba(255,255,255,0.02)]`}
          >
            <div className="max-w-3xl mx-auto p-8 text-[var(--holo-text)]">
              {parseLatex(data.content)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
