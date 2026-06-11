import { randomBytes } from 'node:crypto'
import { getNodeSecret } from './nodeRegistry'

// Per-launch secrets. None of these are persisted — every cold start gets a
// fresh set, written only into the env of spawned child processes. A future
// PR moves these into the system keychain (MASTER_SYNTHESIS.md §7 Q6).
//
// NOTE: This interface is a compatibility shim over the nodeRegistry. New
// nodes should use registerPythonDaemonNode() or registerTsNode() instead of
// adding fields here. The registry generates secrets lazily on first
// registration and caches them for the process lifetime.
export interface MeshSecrets {
  adminToken: string
  coreSecret: string
  shellSecret: string
  hostNotificationsSecret: string
  ravenSecret: string
  newsFeedsSecret: string
  financeSecret: string
  digestSecret: string
  weatherSecret: string
  visionSecret: string
  calendarSecret: string
  remindersSecret: string
  systemInfoSecret: string
  clipboardHistorySecret: string
  macosMessagesSecret: string
  macosMailSecret: string
  timeSecret: string
  meshIntrospectionSecret: string
  visualizerSecret: string
  lanesSecret: string
  intentsSecret: string
  githubSecret: string
  viewerDesktopSecret: string
}

function hex32(): string {
  return randomBytes(32).toString('hex')
}

export function generateMeshSecrets(): MeshSecrets {
  // Core infrastructure secrets (not node-specific)
  const adminToken = hex32()
  const coreSecret = hex32()
  const shellSecret = hex32()

  // Node secrets: use the registry so registerPythonDaemonNode() and the
  // legacy path share the same secret pool. getNodeSecret() generates on
  // first call and caches thereafter.
  return {
    adminToken,
    coreSecret,
    shellSecret,
    hostNotificationsSecret: getNodeSecret('host_notifications'),
    ravenSecret: getNodeSecret('raven'),
    newsFeedsSecret: getNodeSecret('news_feeds'),
    financeSecret: getNodeSecret('finance'),
    digestSecret: getNodeSecret('digest'),
    weatherSecret: getNodeSecret('weather'),
    visionSecret: getNodeSecret('vision'),
    calendarSecret: getNodeSecret('calendar'),
    remindersSecret: getNodeSecret('reminders'),
    systemInfoSecret: getNodeSecret('system_info'),
    clipboardHistorySecret: getNodeSecret('clipboard_history'),
    macosMessagesSecret: getNodeSecret('macos_messages'),
    macosMailSecret: getNodeSecret('macos_mail'),
    timeSecret: getNodeSecret('time'),
    meshIntrospectionSecret: getNodeSecret('mesh_introspection'),
    visualizerSecret: getNodeSecret('visualizer'),
    lanesSecret: getNodeSecret('lanes'),
    intentsSecret: getNodeSecret('intents'),
    githubSecret: getNodeSecret('github'),
    viewerDesktopSecret: getNodeSecret('viewer_desktop'),
  }
}
