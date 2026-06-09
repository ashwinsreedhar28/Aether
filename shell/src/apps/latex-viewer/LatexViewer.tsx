import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/** Thin host: LaTeX preview/source/split lives in @viewer/core's `latex` renderer. */
export function LatexViewer(props: AppProps) {
  return <ContentHost {...props} type="latex" />;
}
