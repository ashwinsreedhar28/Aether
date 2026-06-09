import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/** Thin host: JSON rendering/editing lives in @viewer/core's `json` renderer. */
export function JsonViewer(props: AppProps) {
  return <ContentHost {...props} type="json" editable />;
}
