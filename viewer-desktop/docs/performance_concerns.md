# Performance Concerns & Optimization Guide

## Tech Stack Assessment

**Verdict: ✅ Stack is solid** — The issues are implementation optimizations, not architectural problems. Safe to keep building on this foundation.

### Current Stack
- **React 19 + TypeScript** — Modern, performant
- **Zustand** — Lightweight state management
- **Vite** — Fast builds/dev server
- **WebSocket** — Efficient for real-time updates
- **Architecture** — Sound foundation

---

## Performance Concerns

### 1. Full Tree Rebuild ⚠️ **HIGH IMPACT**

**Issue:** Server rebuilds entire tree on every request (`server/index.js:84-92`)

```javascript
// Current: Rebuilds entire tree recursively
app.get('/api/tree', async (req, res) => {
  const tree = await buildTree(ROOT_DIR); // O(n) scan
});
```

**Impact:** 
- Slow for large directories (1000+ files)
- Blocks request thread during rebuild
- Unnecessary work when only one file changed

**Fix:** 
- Cache tree in memory, invalidate on file changes
- Send incremental updates via WebSocket instead of full rebuilds

**Priority:** High

---

### 2. Multiple File Watchers ⚠️ **MEDIUM IMPACT**

**Issue:** Each WebSocket client gets its own chokidar watcher (`server/index.js:266`)

```javascript
// Each client watches entire ROOT_DIR
const watcher = watch(ROOT_DIR, { depth: 10 });
```

**Impact:** 
- Memory/CPU waste with multiple clients
- Redundant file system monitoring
- Each watcher consumes resources

**Fix:** 
- Single shared watcher, broadcast to all clients
- One watcher instance, multiple WebSocket connections

**Priority:** Medium

---

### 3. No Tree Memoization ⚠️ **MEDIUM IMPACT**

**Issue:** `FileTreeItem` re-renders entire subtree on any tree change

**Impact:** 
- Janky scrolling in large trees
- Unnecessary React reconciliation
- Poor UX with 100+ visible nodes

**Fix:** 
- `React.memo` + shallow comparison
- Or virtualize tree rendering (react-window)

**Priority:** Medium

---

### 4. Large File Handling ⚠️ **LOW-MEDIUM IMPACT**

**Issue:** Base64 encoding images in memory (`server/index.js:117-130`)

```javascript
const content = await fs.readFile(resolvedPath);
const base64 = content.toString('base64');
```

**Impact:** 
- Memory spikes for large images (10MB+)
- Blocks request thread during encoding
- Unnecessary base64 overhead

**Fix:** 
- Stream images or serve via URL instead of base64
- Use `/api/file?path=...` as image src directly
- Or implement streaming response

**Priority:** Low-Medium (only affects large images)

---

### 5. No Virtualization ⚠️ **LOW IMPACT (Future)**

**Issue:** Renders all tree nodes, even collapsed

**Impact:** 
- Slow initial render for huge directories (1000+ files)
- Memory overhead for DOM nodes

**Fix:** 
- Virtual scrolling (react-window) when needed
- Only render visible nodes

**Priority:** Low (optimize when needed)

---

## Optimization Roadmap

### Short Term (Quick Wins)

1. **Cache tree in memory** — Store tree, invalidate on file changes
2. **Single shared chokidar watcher** — One watcher, multiple clients
3. **Add `React.memo` to `FileTreeItem`** — Prevent unnecessary re-renders

**Estimated effort:** 2-4 hours  
**Expected improvement:** 50-70% faster tree operations

---

### Medium Term

4. **Incremental tree updates** — Send patch diffs instead of full tree
5. **Lazy-load tree nodes** — Load children on expand, not upfront

**Estimated effort:** 1-2 days  
**Expected improvement:** Near-instant updates, faster initial load

---

### Long Term

6. **Virtual scrolling** — For 1000+ file directories
7. **Image serving optimization** — URLs vs base64

**Estimated effort:** 2-3 days  
**Expected improvement:** Handles massive directories smoothly

---

## Implementation Notes

### Tree Caching Example

```javascript
// server/index.js
let cachedTree = null;
let treeCacheTime = 0;
const TREE_CACHE_TTL = 5000; // 5 seconds

app.get('/api/tree', async (req, res) => {
  const now = Date.now();
  if (cachedTree && (now - treeCacheTime) < TREE_CACHE_TTL) {
    return res.json({ tree: cachedTree });
  }
  
  cachedTree = await buildTree(ROOT_DIR);
  treeCacheTime = now;
  res.json({ tree: cachedTree });
});

// Invalidate on file changes
watcher.on('change', () => {
  cachedTree = null;
});
```

### Shared Watcher Example

```javascript
// Single watcher for all clients
const sharedWatcher = watch(ROOT_DIR, {
  ignored: IGNORE_PATTERNS,
  persistent: true,
  ignoreInitial: true,
  depth: 10,
});

wss.on('connection', (ws) => {
  // Just add client to broadcast list
  clients.add(ws);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Broadcast to all clients
sharedWatcher.on('change', (filePath) => {
  const message = JSON.stringify({ type: 'file-changed', path: filePath });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
});
```

### Memoized FileTreeItem

```typescript
export const FileTreeItem = React.memo(({ node, depth, onOpenFile, onContextMenu, modifiedFiles }: FileTreeItemProps) => {
  // ... existing code
}, (prevProps, nextProps) => {
  // Custom comparison
  return (
    prevProps.node.path === nextProps.node.path &&
    prevProps.node.children === nextProps.node.children &&
    prevProps.depth === nextProps.depth &&
    prevProps.modifiedFiles === nextProps.modifiedFiles
  );
});
```

---

## Monitoring

To track performance improvements:

1. **Tree build time** — Log `buildTree()` duration
2. **Memory usage** — Monitor Node.js heap size
3. **WebSocket connections** — Track active clients
4. **Render performance** — React DevTools Profiler

---

## Conclusion

The current tech stack is **solid and scalable**. The performance concerns listed above are **optimization opportunities**, not blockers. The architecture can handle growth; optimize as you scale.

**Recommendation:** Address short-term optimizations first (tree caching, shared watcher, memoization) for immediate 50-70% improvement. Defer virtualization and advanced optimizations until you actually hit performance issues with real-world usage.

