import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/** Thin host: diagram rendering lives in @viewer/core's `mermaid` renderer. */
export function MermaidViewer(props: AppProps) {
  return <ContentHost {...props} type="mermaid" />;
}
