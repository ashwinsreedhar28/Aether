/**
 * Unit tests for the viewer_desktop mesh node. Each of the five surfaces is
 * driven with a synthetic Envelope against a mocked control dispatch, asserting
 * the right renderer action + params are dispatched and the right shape returns.
 *
 * Runs under Node's native TypeScript loader: `node --test` (see package.json
 * `test` script). No Electron, no live Core, no renderer required.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createViewerNode } from './viewerNode.ts'
import { MeshDeny, type Envelope } from './mesh-sdk/index.ts'
import { registerGenerator, _resetGenerators, type View } from '@viewer/core'

interface DispatchCall {
  action: string
  params: Record<string, unknown>
}

function mockDispatch(responses: Record<string, unknown>): {
  fn: (action: string, params?: Record<string, unknown>) => Promise<unknown>
  calls: DispatchCall[]
} {
  const calls: DispatchCall[] = []
  const fn = async (action: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ action, params })
    return responses[action]
  }
  return { fn, calls }
}

function makeEnv(payload: Record<string, unknown>, from = 'agent'): Envelope {
  return {
    id: 'env-1',
    correlation_id: 'env-1',
    from,
    to: 'viewer_desktop.surface',
    kind: 'invocation',
    payload,
    timestamp: new Date().toISOString(),
    signature: 'test',
  }
}

interface EmitCall {
  target: string
  payload: Record<string, unknown>
}

function mockMeshEmit(): {
  fn: (target: string, payload: Record<string, unknown>) => Promise<void>
  calls: EmitCall[]
} {
  const calls: EmitCall[] = []
  const fn = async (target: string, payload: Record<string, unknown>): Promise<void> => {
    calls.push({ target, payload })
  }
  return { fn, calls }
}

test('open_view (path source) dispatches open-file with the mapped app and tracks the id', async () => {
  const { fn, calls } = mockDispatch({ 'open-file': { windowId: 'win-1', appId: 'markdown-viewer' } })
  const node = createViewerNode({ dispatch: fn })

  const res = await node.handlers.open_view(
    makeEnv({ id: 'v1', type: 'markdown', source: { kind: 'path', value: '/docs/readme.md' } }),
  )

  assert.deepEqual(res, { ok: true, id: 'v1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'open-file')
  assert.deepEqual(calls[0].params, { path: '/docs/readme.md', appId: 'markdown-viewer' })
})

test('open_view (inline source) materialises a temp file then opens it', async () => {
  const { fn, calls } = mockDispatch({ 'open-file': { windowId: 'win-7', appId: 'json-viewer' } })
  const node = createViewerNode({ dispatch: fn })

  const res = await node.handlers.open_view(
    makeEnv({ id: 'v-inline', type: 'json', source: { kind: 'inline', value: '{"hello":true}' } }),
  )

  assert.deepEqual(res, { ok: true, id: 'v-inline' })
  assert.equal(calls[0].action, 'open-file')
  assert.equal(calls[0].params.appId, 'json-viewer')
  const path = calls[0].params.path as string
  assert.match(path, /\.json$/)
  const written = await readFile(path, 'utf8')
  assert.equal(written, '{"hello":true}')
})

test('open_view rejects an unknown view type with MeshDeny', async () => {
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () =>
      node.handlers.open_view(
        makeEnv({ id: 'bad', type: 'spreadsheet', source: { kind: 'path', value: '/x' } }),
      ),
    (e: unknown) => e instanceof MeshDeny && (e as MeshDeny).reason === 'viewer_unknown_view_type',
  )
})

test('open_view rejects a url source (follow-up wave) with MeshDeny', async () => {
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () =>
      node.handlers.open_view(
        makeEnv({ id: 'u', type: 'html', source: { kind: 'url', value: 'https://x.test' } }),
      ),
    (e: unknown) => e instanceof MeshDeny && (e as MeshDeny).reason === 'viewer_url_source_unsupported',
  )
})

test('open_view rejects a reused id with MeshDeny (no orphaned window)', async () => {
  const { fn, calls } = mockDispatch({ 'open-file': { windowId: 'win-dup', appId: 'markdown-viewer' } })
  const node = createViewerNode({ dispatch: fn })

  // First open of 'dup' succeeds and tracks the window.
  await node.handlers.open_view(
    makeEnv({ id: 'dup', type: 'markdown', source: { kind: 'path', value: '/a.md' } }),
  )
  // Re-using the same id must be denied — not silently overwrite (which would
  // orphan win-dup, leaving it open but un-closable).
  await assert.rejects(
    () =>
      node.handlers.open_view(
        makeEnv({ id: 'dup', type: 'markdown', source: { kind: 'path', value: '/b.md' } }),
      ),
    (e: unknown) => e instanceof MeshDeny && (e as MeshDeny).reason === 'viewer_id_in_use',
  )
  // The reuse was rejected before dispatch — only the first open hit open-file.
  assert.equal(calls.length, 1)
})

test('close_view closes the tracked window and clears it', async () => {
  const { fn, calls } = mockDispatch({
    'open-file': { windowId: 'win-9' },
    'close-window': { success: true },
  })
  const node = createViewerNode({ dispatch: fn })

  await node.handlers.open_view(
    makeEnv({ id: 'c1', type: 'text', source: { kind: 'path', value: '/a.txt' } }),
  )
  const res = await node.handlers.close_view(makeEnv({ id: 'c1' }))

  assert.deepEqual(res, { ok: true })
  const closeCall = calls.find((c) => c.action === 'close-window')
  assert.deepEqual(closeCall?.params, { windowId: 'win-9' })

  // Second close of the same id is now unknown.
  await assert.rejects(
    () => node.handlers.close_view(makeEnv({ id: 'c1' })),
    (e: unknown) => e instanceof MeshDeny && (e as MeshDeny).reason === 'viewer_unknown_view',
  )
})

test('focus_view raises the tracked window', async () => {
  const { fn, calls } = mockDispatch({
    'open-file': { windowId: 'win-3' },
    'focus-window': { success: true },
  })
  const node = createViewerNode({ dispatch: fn })

  await node.handlers.open_view(
    makeEnv({ id: 'f1', type: 'markdown', source: { kind: 'path', value: '/r.md' } }),
  )
  const res = await node.handlers.focus_view(makeEnv({ id: 'f1' }))

  assert.deepEqual(res, { ok: true })
  const focusCall = calls.find((c) => c.action === 'focus-window')
  assert.deepEqual(focusCall?.params, { windowId: 'win-3' })
})

test('focus_view of an unknown id denies', async () => {
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () => node.handlers.focus_view(makeEnv({ id: 'nope' })),
    (e: unknown) => e instanceof MeshDeny && (e as MeshDeny).reason === 'viewer_unknown_view',
  )
})

test('open_view → list_views → close_view round-trips through the id map', async () => {
  const state = {
    workspaces: [{ windows: [{ id: 'win-A', zIndex: 5 }] }],
  }
  const { fn } = mockDispatch({
    'open-file': { windowId: 'win-A' },
    'get-state': state,
    'close-window': { success: true },
  })
  const node = createViewerNode({ dispatch: fn })

  await node.handlers.open_view(
    makeEnv({ id: 'va', type: 'markdown', source: { kind: 'path', value: '/a.md' } }),
  )

  const listed1 = (await node.handlers.list_views(makeEnv({}))) as {
    views: Array<{ id: string }>
    focused?: string
  }
  assert.equal(listed1.views.length, 1)
  assert.equal(listed1.views[0].id, 'va')
  assert.equal(listed1.focused, 'va')

  await node.handlers.close_view(makeEnv({ id: 'va' }))
  const listed2 = (await node.handlers.list_views(makeEnv({}))) as { views: unknown[] }
  assert.equal(listed2.views.length, 0)
})

test('list_views prunes views whose window was closed out-of-band', async () => {
  const { fn } = mockDispatch({
    'open-file': { windowId: 'win-gone' },
    'get-state': { workspaces: [{ windows: [] }] },
  })
  const node = createViewerNode({ dispatch: fn })
  await node.handlers.open_view(
    makeEnv({ id: 'ghost', type: 'text', source: { kind: 'path', value: '/g.txt' } }),
  )
  const listed = (await node.handlers.list_views(makeEnv({}))) as { views: unknown[] }
  assert.equal(listed.views.length, 0)
})

test('notify is fire-and-forget: calls the notifier and returns void', async () => {
  const seen: Array<{ level: string; text: string }> = []
  const node = createViewerNode({
    dispatch: async () => undefined,
    notifier: async (level, text) => {
      seen.push({ level, text })
    },
  })

  const res = await node.handlers.notify(makeEnv({ level: 'warn', text: 'heads up' }))
  assert.equal(res, undefined)
  assert.deepEqual(seen, [{ level: 'warn', text: 'heads up' }])
})

test('notify ignores an empty message', async () => {
  let called = false
  const node = createViewerNode({
    dispatch: async () => undefined,
    notifier: async () => {
      called = true
    },
  })
  await node.handlers.notify(makeEnv({ text: '' }))
  assert.equal(called, false)
})

// --- run_generator: the mesh-driven symmetry of spatial's /generators/{slug}/run ---

test('run_generator runs a registered generator and opens every emitted View', async () => {
  _resetGenerators()
  registerGenerator({
    slug: 'demo_two',
    describe: 'emits two views (a markdown + a text) for the test',
    generate: (): View[] => [
      { id: 'a', type: 'markdown', source: { kind: 'inline', value: '# A' } },
      { id: 'b', type: 'text', source: { kind: 'inline', value: 'B' } },
    ],
  })
  const { fn, calls } = mockDispatch({ 'open-file': { windowId: 'win', appId: 'x' } })
  const node = createViewerNode({ dispatch: fn })

  const res = await node.handlers.run_generator(makeEnv({ slug: 'demo_two' }))

  assert.deepEqual(res, { ok: true, slug: 'demo_two', opened: ['a', 'b'], count: 2 })
  // one open-file dispatch per emitted View
  assert.equal(calls.filter((c) => c.action === 'open-file').length, 2)
  _resetGenerators()
})

test('run_generator rejects an unknown slug with MeshDeny', async () => {
  _resetGenerators()
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () => node.handlers.run_generator(makeEnv({ slug: 'nope' })),
    (e: unknown) => e instanceof MeshDeny && e.reason === 'viewer_unknown_generator',
  )
})

test('run_generator rejects a missing slug with MeshDeny', async () => {
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () => node.handlers.run_generator(makeEnv({})),
    (e: unknown) => e instanceof MeshDeny && e.reason === 'viewer_bad_payload',
  )
})

test('run_generator surfaces a generator that emits an invalid View as MeshDeny', async () => {
  _resetGenerators()
  registerGenerator({
    slug: 'bad_gen',
    describe: 'emits an invalid view to exercise the error path',
    // emits a View missing required fields -> runGenerator's assertView throws
    generate: (): View[] => [{ id: 'x' } as unknown as View],
  })
  const { fn } = mockDispatch({ 'open-file': { windowId: 'win', appId: 'x' } })
  const node = createViewerNode({ dispatch: fn })
  await assert.rejects(
    () => node.handlers.run_generator(makeEnv({ slug: 'bad_gen' })),
    (e: unknown) => e instanceof MeshDeny && e.reason === 'viewer_generator_failed',
  )
  _resetGenerators()
})

// --- list_generators: the discovery half of run_generator. Reflects the shared
//     @viewer/core registry (slug + describe + paramsSchema), never the generate fn. ---

test('list_generators returns the registered generators with no generate fn leaked', async () => {
  _resetGenerators()
  registerGenerator({
    slug: 'demo_listed',
    describe: 'a generator the agent can discover before running it',
    paramsSchema: { type: 'object', properties: { name: { type: 'string' } } },
    generate: (): View[] => [{ id: 'd', type: 'text', source: { kind: 'inline', value: 'D' } }],
  })
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })

  const res = (await node.handlers.list_generators(makeEnv({}))) as {
    ok: boolean
    generators: Array<Record<string, unknown>>
  }

  assert.equal(res.ok, true)
  assert.equal(res.generators.length, 1)
  const [entry] = res.generators
  assert.equal(entry.slug, 'demo_listed')
  assert.equal(entry.describe, 'a generator the agent can discover before running it')
  assert.deepEqual(entry.paramsSchema, { type: 'object', properties: { name: { type: 'string' } } })
  // The callable must NEVER cross the surface — only its addressable metadata.
  assert.equal('generate' in entry, false)
  _resetGenerators()
})

test('list_generators returns an empty list when no generators are registered', async () => {
  _resetGenerators()
  const { fn } = mockDispatch({})
  const node = createViewerNode({ dispatch: fn })
  const res = (await node.handlers.list_generators(makeEnv({}))) as {
    ok: boolean
    generators: unknown[]
  }
  assert.deepEqual(res, { ok: true, generators: [] })
})

// --- view_event: the human→agent SEND path. The viewer node is the SENDER; the
//     event flows on the existing mesh via the openedBy (env.from) captured at open. ---

test('open_view captures openedBy (env.from), so emitViewEvent routes back to that agent', async () => {
  const { fn } = mockDispatch({ 'open-file': { windowId: 'win-e1', appId: 'kanban-board' } })
  const emit = mockMeshEmit()
  const node = createViewerNode({ dispatch: fn, meshEmit: emit.fn })

  // The opener is whoever sent the open_view envelope (env.from).
  await node.handlers.open_view(
    makeEnv({ id: 'board', type: 'kanban', source: { kind: 'path', value: '/b.kanban' } }, 'agent_sprint'),
  )
  await node.emitViewEvent('board', 'card_moved', { cardId: 'c1' })

  assert.equal(emit.calls.length, 1)
  assert.equal(emit.calls[0].target, 'agent_sprint')
  assert.equal(emit.calls[0].payload.viewId, 'board')
})

test('emitViewEvent emits a fire-and-forget view_event with the canonical payload shape', async () => {
  const { fn } = mockDispatch({ 'open-file': { windowId: 'win-e2', appId: 'kanban-board' } })
  const emit = mockMeshEmit()
  const node = createViewerNode({ dispatch: fn, meshEmit: emit.fn })

  await node.handlers.open_view(
    makeEnv({ id: 'kb', type: 'kanban', source: { kind: 'path', value: '/k.kanban' } }, 'agent_x'),
  )
  await node.emitViewEvent('kb', 'card_moved', {
    cardId: 'c42',
    fromColumn: 'todo',
    toColumn: 'done',
    position: 0,
  })

  assert.equal(emit.calls.length, 1)
  const { target, payload } = emit.calls[0]
  assert.equal(target, 'agent_x')
  assert.equal(payload.viewId, 'kb')
  assert.equal(payload.type, 'kanban')
  assert.equal(payload.action, 'card_moved')
  assert.deepEqual(payload.data, { cardId: 'c42', fromColumn: 'todo', toColumn: 'done', position: 0 })
  assert.equal(typeof payload.ts, 'string')
  assert.match(payload.ts as string, /^\d{4}-\d{2}-\d{2}T/)
})

test('emitViewEvent on an untracked viewId drops silently (no throw, no emit)', async () => {
  const { fn } = mockDispatch({})
  const emit = mockMeshEmit()
  const node = createViewerNode({ dispatch: fn, meshEmit: emit.fn })

  // Must not throw — a stray gesture (window closed out-of-band, unknown id) is
  // not an error condition.
  await node.emitViewEvent('ghost', 'card_moved', { cardId: 'x' })
  assert.equal(emit.calls.length, 0)
})

test('a kanban card_moved gesture (window-keyed) produces a view_event invocation', async () => {
  const { fn } = mockDispatch({ 'open-file': { windowId: 'win-kanban', appId: 'kanban-board' } })
  const emit = mockMeshEmit()
  const node = createViewerNode({ dispatch: fn, meshEmit: emit.fn })

  await node.handlers.open_view(
    makeEnv({ id: 'sprint', type: 'kanban', source: { kind: 'path', value: '/sprint.kanban' } }, 'agent_pm'),
  )
  // The renderer knows its windowId (AppProps), not the agent-assigned View.id —
  // this is the path the kanban drag handler drives via IPC.
  await node.emitViewEventForWindow('win-kanban', 'card_moved', {
    cardId: 'TASK-7',
    fromColumn: 'In Progress',
    toColumn: 'Done',
    position: 2,
  })

  assert.equal(emit.calls.length, 1)
  assert.equal(emit.calls[0].target, 'agent_pm')
  assert.equal(emit.calls[0].payload.viewId, 'sprint')
  assert.equal(emit.calls[0].payload.action, 'card_moved')
  assert.deepEqual(emit.calls[0].payload.data, {
    cardId: 'TASK-7',
    fromColumn: 'In Progress',
    toColumn: 'Done',
    position: 2,
  })
})

test('emitViewEventForWindow on an unknown windowId drops silently', async () => {
  const { fn } = mockDispatch({})
  const emit = mockMeshEmit()
  const node = createViewerNode({ dispatch: fn, meshEmit: emit.fn })
  await node.emitViewEventForWindow('no-such-window', 'card_moved', {})
  assert.equal(emit.calls.length, 0)
})
