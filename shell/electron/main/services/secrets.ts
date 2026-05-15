import { randomBytes } from 'node:crypto'

// Per-launch secrets. None of these are persisted — every cold start gets a
// fresh set, written only into the env of spawned child processes. A future
// PR moves these into the system keychain (MASTER_SYNTHESIS.md §7 Q6).
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
}

function hex32(): string {
  return randomBytes(32).toString('hex')
}

export function generateMeshSecrets(): MeshSecrets {
  return {
    adminToken: hex32(),
    coreSecret: hex32(),
    shellSecret: hex32(),
    hostNotificationsSecret: hex32(),
    ravenSecret: hex32(),
    newsFeedsSecret: hex32(),
    financeSecret: hex32(),
    digestSecret: hex32(),
    weatherSecret: hex32(),
    visionSecret: hex32(),
    calendarSecret: hex32(),
  }
}
