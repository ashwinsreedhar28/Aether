import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/**
 * Thin host: markdown preview/edit (incl. mermaid code blocks + math) lives in
 * @viewer/core's `markdown` renderer.
 */
export function MarkdownEditor(props: AppProps) {
  return <ContentHost {...props} type="markdown" editable />;
}
