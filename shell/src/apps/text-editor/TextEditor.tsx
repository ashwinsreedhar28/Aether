import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/** Thin host: text rendering/editing lives in @viewer/core's `text` renderer. */
export function TextEditor(props: AppProps) {
  return <ContentHost {...props} type="text" editable />;
}
