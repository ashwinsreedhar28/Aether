# Vision Arc Roadmap

Vision is a first-class interaction primitive for Aether. This document captures the
multi-PR sequence, gesture vocabulary, hardware constraints, and
scope split between the current laptop dev surface and the eventual
home substrate.

## Director's Vision (eventual end-state)

> "Point at a wall and speak 'put my calendar there' — Aether casts
> the calendar where I am pointing."

The end-state is ambient spatial computing: a home substrate with
peripherals (cameras, projectors, depth sensors), where the user
gestures and speaks to compose interfaces into physical space. Aether
runs on an always-on home box; the laptop is a development surface
for the substrate that eventually moves into the room.

## Why a roadmap doc

The vision arc is several PRs that build on each other in a specific
order. Capturing the sequence and the architectural decisions before
any single PR fires prevents:

- Scope creep on any one PR (each PR delivers a specific layer)
- Wrong-order PR shipping (capture before gesture-watch before action)
- Re-deriving the gesture vocabulary across multiple sessions
- Forgetting why specific dependencies stay vendored

## Hardware-constrained scope (current — MacBook Pro)

| Capability                          | Laptop  | Home substrate |
|-------------------------------------|---------|----------------|
| Front-facing webcam                 | Yes     | Multiple cams  |
| Depth sensor                        | No      | LiDAR / ToF    |
| Projection surface                  | Screen  | Wall / table   |
| Multi-user                          | No      | Yes            |
| Background gesture detection        | No      | Yes            |
| Eye-gaze tracking                   | No      | IR sensors     |

This roadmap targets the laptop surface for v1 of the vision arc.
The home-substrate capabilities open up when that hardware exists.

## Six-Gesture Vocabulary (laptop v1)

All gestures are single-hand, single-user, fixed-camera-position,
detectable with MediaPipe Hands at 10fps.

### 1. Open palm facing camera, 1-2s hold

**Action:** Stop / cancel current voice action.

**Use case:** Gemini is mid-response and you want to interrupt
without speaking "stop" (which the mic might not catch over the
audio output).

### 2. Index finger pointing toward screen

**Action:** "Look here / read this." Provides screen-coord context
to whatever app is in focus.

**Use case:** Combined with voice — "read this article" while
pointing at a specific headline in the News app routes to that
article instead of the default-active one.

**Implementation:** MediaPipe gives 2D fingertip coords; app
translates to the DOM element at those coords via
`document.elementFromPoint`. Apps opt-in by tagging elements with
`data-pointable="article-{id}"` (or similar key).

### 3. Thumbs-up / Thumbs-down

**Action:** Confirm / dismiss.

**Use case:** Notifications. A notification arrives ("AAPL hit your
threshold"); thumbs-up acknowledges; thumbs-down dismisses without
keyboard or voice.

### 4. Pinch (thumb + index closed)

**Action:** Select / open.

**Use case:** Combined with the pointing gesture — point at an
article and pinch to open it. Faster than voice for known UI elements.

### 5. Hand swipe left/right (open palm, lateral motion)

**Action:** Next / previous.

**Use case:** Cycle through articles in News, ticker grid pages in
Finance, app navigation in shell. Replaces arrow keys for visual
content browsing.

### 6. Two-finger peace sign, 1-2s hold

**Action:** Wake voice session.

**Use case:** Start a voice turn without a wake-word or keyboard
shortcut. Particularly useful when you've quieted the mic to focus
on screen work.

## 4-PR Implementation Sequence

### PR 1: feat/vision-capture-node

**Purpose:** Foundation. Camera access, frame capture, single mesh
surface.

**New mesh node:** `vision_capture`
- Opens webcam via macOS AVFoundation (or Pillow / mss fallback)
- Captures frames at 10fps (configurable)
- Surface: `vision.frame()` returns latest frame buffer + metadata
- Releases camera when no active consumer (resource-careful)
- macOS camera permission dance handled at first launch

**No user-visible behavior yet.** This PR sets up the camera
substrate; consumers come later.

### PR 2: feat/vision-gesture-watcher

**Purpose:** First always-on event-emitting mesh node. Introduces
a new mesh pattern.

**New mesh node:** `gesture_watcher`
- Subscribes to `vision.frame()` (poll or event — design discussion
  needed when this PR fires)
- Runs MediaPipe Hands inference on each frame
- Detects the six gestures above
- **Emits events** to the mesh (not request-response) — first event-
  emitting node
- Per-gesture config to enable/disable (e.g., "off when on a Zoom
  call")

**Architectural decision needed at PR time:** how mesh handles
event-emitting nodes. Possibly an extension to the envelope protocol,
or a new SSE-based "subscribe to events" pattern. Won't be settled
until this PR is actively designed.

### PR 3: feat/raven-gesture-actions

**Purpose:** Map gesture events to voice/app actions.

raven-core subscribes to `gesture_watcher` events. Action map:

| Gesture           | Action                              |
|-------------------|-------------------------------------|
| Open palm         | Cancel current voice turn           |
| Two-finger wave   | Start voice session                 |
| Thumbs up/down    | Confirm/dismiss pending prompt      |
| Swipe L/R         | Next/prev (context-aware in app)    |
| Point + voice     | Provide screen-coord to apps        |
| Pinch + point     | "Select" the pointed item           |

raven-core gets an interruption mechanism so that "cancel voice"
actually halts Gemini mid-response (currently no such hook exists —
adding this is part of this PR's scope).

### PR 4: feat/pointing-app-integration

**Purpose:** Apps support pointer-targeting for "look here" semantics.

**Convention:** Apps tag pointable elements with
`data-pointable="{kind}-{id}"`. Examples:
- News articles: `data-pointable="article-{article-id}"`
- Finance quotes: `data-pointable="quote-{symbol}"`
- Markdown headings: `data-pointable="heading-{anchor}"`

**Shell service:** Translates screen-coords from `gesture_watcher`
events + active app context into "user is pointing at article X" and
exposes via `window.aether.pointer.current()` (or whatever the bridge
shape becomes).

**Voice integration:** When the voice tool routes a query like "read
this", it consults `pointer.current()` to know what "this" refers to.
Falls back to "the most recent thing you opened" if no pointer
context.

## Home Substrate (eventual, not in current scope)

When Aether runs on a home box with proper hardware, additional
capabilities open:

- **Multi-user gesture distinguishing** via multiple cameras
- **Projection of UI onto walls / tables** — "put my calendar there"
- **Mid-air drawing / writing** with depth-sensing
- **Background gesture detection** (gestures from across the room)
- **Eye-gaze + gesture combined** for "look at + select"

These require hardware not present on the laptop dev surface and are
explicitly out of scope for the four PRs above. The patterns
established in laptop v1 (event-emitting mesh nodes, gesture-to-
action mapping, pointer-targeting convention) extend cleanly to the
home substrate; no retrofit needed.

## Why vision lives in mesh, not MCP

Vision data is **owned by Aether** — frame capture, gesture
detection, pointer state all happen locally. No external service
sees the camera feed. This is mesh territory by the taxonomy in
DECISIONS.md (owned data → mesh; borrowed-via-MCP → external).

## Dependencies preserved

The following Python dependencies stay vendored in raven-core's
bootstrap (despite not being used by current voice path):
- `mediapipe` — gesture detection
- `opencv-python` — frame manipulation
- `Pillow` — image format conversion
- `mss` — screen capture (for "look here" coord translation)
- `numpy` — already present, used by all of the above

These were originally lifted from VIEWER's voice pattern but are
actually load-bearing for the vision arc. Pruning them now would
require re-vendoring at PR 1 — explicit anti-decision.
