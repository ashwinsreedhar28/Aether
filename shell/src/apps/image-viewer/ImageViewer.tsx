import { ContentHost } from '../ContentHost';
import type { AppProps } from '../types';

/**
 * Thin host: image display + zoom/rotate lives in @viewer/core's `image`
 * renderer. fileApi.readFile returns a base64 data URL, which the renderer uses
 * directly as the image source.
 */
export function ImageViewer(props: AppProps) {
  return <ContentHost {...props} type="image" />;
}
