import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/** Thin host: sandboxed HTML preview lives in @viewer/core's `html` renderer. */
export function HtmlPreview(props: AppProps) {
  return <ContentHost {...props} type="html" />;
}
