# time

Stateless mesh node that returns the current time in a requested IANA
timezone. No SQLite, no poller — one surface, one `Date.now()` per call.

## Surfaces

- `time.now` — current wall-clock time in the specified zone.
  Params:
    - `zone?: string` — IANA timezone name (e.g. `America/New_York`,
      `Asia/Tokyo`). Defaults to system local zone.
    - `format?: 'iso' | 'human'` — output style. Default `iso`.
  Returns: `{ time: string, zone: string, unix_ms: number }`.

  Validation: unknown IANA zone → `MeshDeny('time_bad_zone', { zone })`.
  Detection is `try new Intl.DateTimeFormat(undefined, { timeZone })`;
  catch `RangeError` on invalid names.

  Formats:
    - `iso` → ISO 8601 with the zone's UTC offset
      (e.g. `2026-05-19T14:32:00-04:00`). Composed from
      `Intl.DateTimeFormat.formatToParts` with `timeZoneName: 'longOffset'`.
    - `human` → readable form (e.g. `2:32 PM EDT`).

  `unix_ms` is always `Date.now()` — timezone-independent.

## State

None. The standard `running` marker file is written under
`$AETHER_DATA_DIR/time/running` after Core registration as the
daemon-node liveness signal; no other persistence.

## Environment

- `MESH_TIME_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required (marker only).
