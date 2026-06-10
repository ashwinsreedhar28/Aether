# Viewer node — mesh surface contract

The **shared** Lattice mesh surface contract that BOTH viewer shells expose so
an agent controls either one *identically*:

- `viewer-desktop` (macOS / Electron) hosts the node in its Electron main and
  uses the TS SDK (`@aether/node_sdk_ts`, `MeshNode.on(surface, handler)`).
- `viewer-spatial` (visionOS) hosts the node in its Python bridge and uses the
  Python SDK (`node_sdk.MeshNode`).

A View opened on either shell is the same [`View`](../schema/view.schema.json)
atom — the desktop renders it in a window, spatial renders it in a floating HTML
panel. This contract is the seam that makes that interchangeable.

> This directory is the **contract only** — schemas + the manifest fragment. The
> node implementations (handler bodies, window/panel hosting) are Wave 2.

## The five surfaces

| Surface | Type | Invocation mode | Payload | Returns |
| --- | --- | --- | --- | --- |
| `open_view` | `tool` | `request_response` | a [`View`](./open_view.payload.json) | `{ ok, id }` |
| `close_view` | `tool` | `request_response` | [`{ id }`](./close_view.payload.json) | `{ ok }` |
| `focus_view` | `tool` | `request_response` | [`{ id }`](./focus_view.payload.json) | `{ ok }` |
| `list_views` | `tool` | `request_response` | [`{}`](./list_views.payload.json) | `{ views: View[], focused?: id }` |
| `notify` | `inbox` | `fire_and_forget` | [`{ level?, text }`](./notify.payload.json) | 202 ack (no body) |

Payload schemas live alongside this file. `open_view`'s payload **is** a View —
its schema `$ref`s `../schema/view.schema.json` rather than re-declaring the
shape, so the View contract stays single-source.

> Per Lattice SPEC §8, a manifest's surface `schema` paths resolve relative to
> the manifest file. When a shell splices [`viewer-surfaces.json`](./viewer-surfaces.json)
> into its own manifest, it must keep these payload schemas reachable at the
> referenced relative paths (point at this `mesh/` dir, or vendor the files).

## Semantics

- **`open_view`** — spawn a host for the supplied View. Desktop: a new window
  bound to `View.id`. Spatial: a new HTML panel. Returns the id the view is
  addressable by (echoes `View.id`).
- **`close_view`** — tear down the host addressed by `id`.
- **`focus_view`** — bring the host addressed by `id` to the foreground (raise
  the window / pull the panel to gaze-front).
- **`list_views`** — enumerate currently-open views and which one (if any) is
  focused. The reflection surface an agent reads before acting.
- **`notify`** — surface a transient message to the user. Desktop: a toast.
  Spatial: an on-panel caption / spoken voice line. `level` is a styling hint.

## Desktop ↔ spatial mapping

| Concept | viewer-desktop | viewer-spatial |
| --- | --- | --- |
| host for a View | OS window (Electron `BrowserWindow`) | floating HTML panel |
| `focus_view` | raise + focus the window | pull panel to gaze-front |
| `notify` | toast notification | caption overlay / voice |
| `View.layout.w/h` | px (≥1) or screen-fraction (<1) | meters |
| `source: path` | resolved via Electron `fs` | resolved via the Python bridge |

Both consume the identical manifest fragment and identical payload schemas, so
Core validates an agent's call the same way regardless of which shell is the
target. The shells differ only in how a handler *fulfils* the call.

## Why `request_response` for control, `fire_and_forget` for `notify`

The four control surfaces (`open/close/focus/list_views`) are **`tool` /
`request_response`**: the agent needs the result to proceed. `open_view` must
return the `id` to address the view later; `list_views` returns state the agent
reasons over; `close`/`focus` confirm the mutation landed. Core blocks the
caller until the node responds (or `504 timeout`).

`notify` is **`inbox` / `fire_and_forget`**: it is a one-way nudge to the human,
not a request for data. There is nothing for the agent to await — a toast either
shows or it doesn't, and the agent's next step does not depend on it. Core acks
`202 accepted` immediately and never blocks. Per SPEC §4.2 a `fire_and_forget`
surface returns 202 with no response envelope; the SDK handler returns `None`.

Picking the mode per the *shape of the interaction* — "do I need an answer?" —
rather than per surface convenience is what keeps the contract honest across
both shells.
