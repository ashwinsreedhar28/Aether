/**
 * Default Event-Sound Bindings
 * Maps viewer events to preset sounds.
 */

import type { ViewerEvent, EventBinding } from './types';

export const defaultEventSoundMap: Record<ViewerEvent, string> = {
  // Window events
  'window:open': 'chimeUpDouble',
  'window:close': 'slideClose',
  'window:focus': 'tapSoft',
  'window:minimize': 'slideDown',
  'window:maximize': 'riseShort',
  'window:drag': 'tapLight',
  'window:resize': 'tapMuted',

  // Tab events
  'tab:add': 'blip',
  'tab:remove': 'slideClose',
  'tab:switch': 'toneSwitch',
  'tab:reorder': 'tapSoft',
  'tab:tearOff': 'whooshQuick',

  // File explorer events
  'file:select': 'tap',
  'folder:expand': 'riseShort',
  'folder:collapse': 'fallShort',
  'file:open': 'chimeUp',

  // Workspace events
  'workspace:switch': 'toneSwitch',
  'workspace:reorder': 'blipDouble',

  // Dialog events
  'dialog:open': 'chimeUpDouble',
  'dialog:close': 'slideClose',
  'dialog:confirm': 'chimeSuccess',
  'dialog:cancel': 'slideSoft',

  // Search events
  'search:navigate': 'tapLight',

  // Other events
  'shortcut:activate': 'blip',
  'drag:start': 'riseShort',
  'drag:end': 'slideSettle',
  'workspace:tile': 'sequenceShort',
};

export function getDefaultBindings(): EventBinding[] {
  return Object.entries(defaultEventSoundMap).map(([event, soundId]) => ({
    event: event as ViewerEvent,
    soundId,
    enabled: true,
  }));
}
