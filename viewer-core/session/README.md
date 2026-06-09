# viewer session — the mesh-resident workspace

The **shared, canonical** set of open Views, held on the Lattice mesh as its own
node (`viewer_session`). It is the seam that makes **cross-device handoff** work:
each shell (`viewer_desktop`, `viewer_spatial`) tracks its *own* open views
locally; the session holds the one set both agree on, so a workspace can move
desktop → Vision Pro (or back) with a single call.

```
session = { "views": [View, ...], "focused": Optional[str], "updated": <iso8601> }
```

## The five surfaces

| Surface | Type | Invocation mode | Payload | Returns |
| --- | --- | --- | --- | --- |
| `session_get` | `tool` | `request_response` | [`{}`](./session_get.payload.json) | `{ views: View[], focused?: id, updated }` |
| `session_set` | `tool` | `request_response` | [`{ views, focused? }`](./session_set.payload.json) | `{ ok, count }` |
| `session_add` | `tool` | `request_response` | [`{ view }`](./session_add.payload.json) | `{ ok, count }` |
| `session_remove` | `tool` | `request_response` | [`{ id }`](./session_remove.payload.json) | `{ ok, count }` |
| `session_handoff` | `tool` | `request_response` | [`{ target }`](./session_handoff.payload.json) | `{ ok, target, opened: [ids] }` |

All five are `tool` / `request_response`: every call returns state the agent
reasons over next (the mutating ones echo the new `count`; handoff echoes the
ids it opened). This mirrors the four control surfaces in
[`../mesh/viewer-surfaces.json`](../mesh/viewer-surfaces.json). `session_set`/
`session_add` payloads `$ref` the View schema (vendored here as
[`view.schema.json`](./view.schema.json)) rather than re-declaring it, so the
View contract stays single-source.

## Handoff mechanism — mesh-client-invoke

The session node is a mesh **client** of the two viewer nodes. `session_handoff`
uses the SDK's `MeshNode.invoke(target_surface, payload)` to call the target
node's `open_view` for each session View (in order), then `focus_view` for the
focused one. The SDK supports node→node invocation directly
([`node_sdk.MeshNode.invoke`](../../Lattice/node_sdk/__init__.py)), so the
simplest truthful path is the session driving the fan-out itself — the agent
makes ONE call (`session_handoff`) and the whole workspace rehydrates on the
other device.

The invoker is injectable (`ViewerSession(invoker=...)`), so tests stub it with
a sink and assert the fan-out without a running Core or real nodes.

## Caveat: in-memory only

The session lives in process memory. **A node restart loses it.** That is an
intentional Wave-3 scope choice — a persistence file would be a trivial
follow-up (the SceneStore in viewer-spatial shows the atomic-write pattern).

## Test

```
cd ~/Desktop/Projects/viewer-core/session && python3 -m pytest -q
```

Fixture-based pytest. Covers all five surfaces, the stubbed handoff fan-out, and
invalid-View rejection — all by calling handlers directly with synthetic `env`
dicts.
