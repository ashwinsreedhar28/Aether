# Vision Capture Node

Real-time camera frame capture for Aether via macOS AVFoundation.

## Surface Contract

### `vision.frame()`

Returns a single camera frame or unavailable status.

**Request:** Empty object `{}`

**Response (success):**
```json
{
  "available": true,
  "frame_b64": "<base64 JPEG>",
  "format": "jpeg",
  "quality": 80,
  "width": 1280,
  "height": 720,
  "timestamp": 1715731234567
}
```

**Response (unavailable):**
```json
{
  "available": false,
  "reason": "warming_up" | "permission_denied" | "no_config"
}
```

### Unavailable Reasons

- **`warming_up`**: Camera is initializing. First call after idle timeout or node startup. Retry after ~200ms.
- **`permission_denied`**: macOS camera permission denied. User must grant permission in System Settings > Privacy & Security > Camera. Requires Aether restart after granting.
- **`no_config`**: No camera device found on system.

## Implementation Details

### Platform

- **macOS only** via AVFoundation and pyobjc
- Future: cross-platform fallback via Pillow + mss (see MASTER_SYNTHESIS.md §11.6)

### Capture Settings

- **Frame rate**: 10fps (100ms interval)
- **Resolution**: Native device resolution (typically 1280×720 for built-in MacBook cameras)
- **Format**: JPEG
- **Quality**: 80 (balance between size and fidelity)

### Lifecycle & Battery Efficiency

The camera implements a **5-second idle timeout**:

1. First call to `vision.frame()` after node start or idle timeout: camera initialization begins, returns `{ available: false, reason: "warming_up" }`
2. Subsequent calls within ~200ms: camera ready, returns real frame
3. Calls continue: camera stays active, each call resets the 5-second idle timer
4. No calls for 5 seconds: camera automatically released to save battery
5. Next call after release: cycle repeats from step 1

This pattern means:
- Active use (continuous or near-continuous calls) keeps camera warm with no re-initialization overhead
- Inactive periods (>5s between calls) release the camera, trading one warmup cycle for battery savings
- No reference counting or explicit start/stop protocol needed from callers

### Permission UX

macOS camera permission is requested on first `AVCaptureSession.startRunning()`. The system presents a modal dialog. If denied:

- `vision.frame()` returns `{ available: false, reason: "permission_denied" }`
- User must grant permission in System Settings > Privacy & Security > Camera > Aether
- **Aether restart required** after granting permission (macOS does not notify running apps of permission changes)

## Future Surfaces

Per MASTER_SYNTHESIS.md §11.6, additional vision surfaces planned:

- **`vision.gestures()`**: Real-time hand gesture recognition via MediaPipe (piece 2)
- **`vision.pointing_target()`**: Maps index finger pointing to on-screen UI elements (piece 3/4)

These will be added in subsequent PRs as separate surfaces under the same `vision` node.

## Dependencies

See `requirements.txt`:

- `pyobjc-framework-AVFoundation` — camera access
- `pyobjc-framework-CoreMediaIO` — video buffer handling
- `pyobjc-framework-Cocoa` — image conversion utilities
- `Pillow` — JPEG encoding
- `aiohttp` — mesh protocol (via `core/node_sdk`)

## Running

The vision node is managed by `shell/electron/main/services/visionDaemonManager.ts`. It spawns automatically on Aether startup alongside other mesh participants.

**Environment variables:**

- `NODE_ID` — default: `vision`
- `VISION_SECRET` — required, HMAC signing key from mesh.toml
- `CORE_URL` — default: `http://127.0.0.1:8000`

Manual invocation (for testing):

```bash
cd nodes/vision
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export VISION_SECRET="<secret from mesh.toml>"
python main.py
```

## Design Rationale

See DECISIONS.md "Vision capture stack: piece 1 foundation" (2026-05-14) for the four binding decisions:

1. Python mesh node (not Electron-mediated)
2. Single `vision` namespace for all vision surfaces
3. 10fps capture rate
4. 5-second idle timeout

Also see MASTER_SYNTHESIS.md §11 "Voice + Vision Integration Arc" for full vision roadmap context.
