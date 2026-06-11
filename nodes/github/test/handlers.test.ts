import { describe, it, expect, vi } from 'vitest'
import { MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import {
  makeCommentIssueHandler,
  makeCreateIssueHandler,
  makeGetIssueHandler,
  makeListIssuesHandler,
  type HandlerDeps,
} from '../src/handlers'
import { GithubApiError, type IssueClient } from '../src/github'
import { buildGapBody } from '../src/gap'
import type { RawIssue } from '../src/types'

function envelope(payload: Record<string, unknown>): Envelope {
  return {
    id: 'e1',
    correlation_id: 'c1',
    from: 'test',
    to: 'github.x',
    kind: 'invocation',
    payload,
    timestamp: new Date().toISOString(),
    signature: 'sig',
  }
}

function rawIssue(over: Partial<RawIssue>): RawIssue {
  return {
    number: 1,
    title: 'gap(email): no mail-reading surface',
    labels: ['gap'],
    state: 'open',
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    comments: 0,
    url: 'https://github.com/o/r/issues/1',
    author: 'aether',
    body: null,
    ...over,
  }
}

function fakeClient(over: Partial<IssueClient> = {}): IssueClient {
  return {
    listOpenIssues: vi.fn(async () => [] as RawIssue[]),
    createIssue: vi.fn(async () => ({ number: 10, url: 'https://github.com/o/r/issues/10' })),
    createComment: vi.fn(async () => ({ comment_id: 99, url: 'https://github.com/o/r/c/99' })),
    getIssueState: vi.fn(async () => 'open' as const),
    getIssue: vi.fn(async () => ({
      ...rawIssue({ body: 'ARCHITECT SPEC\nBranch: lane/issue-1   Worktree: ~/aether-lane-1' }),
      state: 'open' as const,
      pullRequest: false,
    })),
    listComments: vi.fn(async () => [
      { author: 'architect', body: 'ADDENDUM: batch semantics', created_at: '2026-06-11T00:00:00Z' },
    ]),
    ...over,
  }
}

function deps(client: IssueClient | null): HandlerDeps {
  return { client, log: () => {}, now: () => new Date('2026-06-10T12:00:00Z') }
}

const gapArgs = {
  area: 'email',
  summary: 'no mail-reading surface',
  utterance: 'read me my email',
}

describe('create_issue', () => {
  it('denies github_no_token when degraded', async () => {
    const handler = makeCreateIssueHandler(deps(null))
    await expect(handler(envelope(gapArgs))).rejects.toMatchObject({
      name: 'MeshDeny',
      reason: 'github_no_token',
    })
  })

  it('files a new issue when no key matches', async () => {
    const client = fakeClient()
    const handler = makeCreateIssueHandler(deps(client))
    const result = await handler(envelope({ ...gapArgs, session_id: 's1' }))
    expect(result).toMatchObject({ ok: true, deduped: false, number: 10 })
    expect(result.capability_key).toBe('email-no-mail-reading-surface')
    const createArgs = vi.mocked(client.createIssue).mock.calls[0]![0]
    expect(createArgs.title).toBe('gap(email): no mail-reading surface')
    expect(createArgs.labels).toEqual(['gap'])
    expect(createArgs.body).toContain('> read me my email')
  })

  it('dedups onto an existing issue with a matching key marker', async () => {
    const existingBody = buildGapBody({
      utterance: 'earlier ask',
      failure: null,
      sessionId: null,
      key: 'email-no-mail-reading-surface',
      filedAt: new Date('2026-06-09T00:00:00Z'),
    })
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => [rawIssue({ number: 7, body: existingBody })]),
    })
    const handler = makeCreateIssueHandler(deps(client))
    const result = await handler(envelope(gapArgs))
    expect(result).toMatchObject({ ok: true, deduped: true, number: 7, comment_id: 99 })
    expect(client.createIssue).not.toHaveBeenCalled()
    const commentBody = vi.mocked(client.createComment).mock.calls[0]![1]
    expect(commentBody).toContain('asked again:')
    expect(commentBody).toContain('> read me my email')
  })

  it('honors an explicit capability_key over the derived one', async () => {
    const existingBody = buildGapBody({
      utterance: 'x',
      failure: null,
      sessionId: null,
      key: 'mail-read',
      filedAt: new Date(),
    })
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => [rawIssue({ number: 3, body: existingBody })]),
    })
    const handler = makeCreateIssueHandler(deps(client))
    const result = await handler(envelope({ ...gapArgs, capability_key: 'Mail Read' }))
    expect(result).toMatchObject({ deduped: true, number: 3 })
  })

  it('denies github_bad_capability_key when nothing survives normalization', async () => {
    const handler = makeCreateIssueHandler(deps(fakeClient()))
    await expect(
      handler(envelope({ ...gapArgs, capability_key: '!!!' })),
    ).rejects.toMatchObject({ reason: 'github_bad_capability_key' })
  })

  it('maps API failures to github_api_error with status', async () => {
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => {
        throw new GithubApiError(403, 'rate limited')
      }),
    })
    const handler = makeCreateIssueHandler(deps(client))
    await expect(handler(envelope(gapArgs))).rejects.toMatchObject({
      reason: 'github_api_error',
      details: { status: 403 },
    })
  })

  it('denies github_bad_<field> on missing required fields', async () => {
    const handler = makeCreateIssueHandler(deps(fakeClient()))
    await expect(handler(envelope({ summary: 's', utterance: 'u' }))).rejects.toMatchObject({
      reason: 'github_bad_area',
    })
  })

  it('memo dedups a back-to-back re-ask even when the list scan lags', async () => {
    // The list NEVER returns the issue — simulating GitHub's eventual
    // consistency. The memo must still catch the repeat.
    const client = fakeClient({ listOpenIssues: vi.fn(async () => []) })
    const handler = makeCreateIssueHandler(deps(client))
    const first = await handler(envelope(gapArgs))
    expect(first).toMatchObject({ deduped: false, number: 10 })
    const second = await handler(envelope({ ...gapArgs, utterance: 'asked again' }))
    expect(second).toMatchObject({ deduped: true, number: 10, comment_id: 99 })
    expect(client.createIssue).toHaveBeenCalledTimes(1)
    expect(client.getIssueState).toHaveBeenCalledWith(10)
  })

  it('re-files fresh when the memoized issue was closed meanwhile', async () => {
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => []),
      getIssueState: vi.fn(async () => 'closed' as const),
    })
    const handler = makeCreateIssueHandler(deps(client))
    await handler(envelope(gapArgs))
    const second = await handler(envelope(gapArgs))
    expect(second).toMatchObject({ deduped: false })
    expect(client.createIssue).toHaveBeenCalledTimes(2)
    expect(client.createComment).not.toHaveBeenCalled()
  })

  it('memoizes scan hits so the next re-ask skips the scan', async () => {
    const existingBody = buildGapBody({
      utterance: 'x',
      failure: null,
      sessionId: null,
      key: 'email-no-mail-reading-surface',
      filedAt: new Date(),
    })
    const list = vi.fn(async () => [rawIssue({ number: 7, body: existingBody })])
    const client = fakeClient({ listOpenIssues: list })
    const handler = makeCreateIssueHandler(deps(client))
    await handler(envelope(gapArgs))
    expect(list).toHaveBeenCalledTimes(1)
    const second = await handler(envelope(gapArgs))
    expect(second).toMatchObject({ deduped: true, number: 7 })
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('list_issues', () => {
  it('serves the clean no-token payload when degraded', async () => {
    const handler = makeListIssuesHandler(deps(null))
    const result = await handler(envelope({}))
    expect(result).toEqual({
      issues: [],
      fetched_at_ms: 0,
      stale: false,
      token_available: false,
    })
  })

  it('serves mapped issues without bodies', async () => {
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => [rawIssue({ number: 5, body: 'secret-ish body' })]),
    })
    const handler = makeListIssuesHandler(deps(client))
    const result = (await handler(envelope({}))) as { issues: Array<Record<string, unknown>> }
    expect(result.issues[0]).toMatchObject({ number: 5, title: rawIssue({}).title })
    expect(result.issues[0]).not.toHaveProperty('body')
  })

  it('serves from cache within the TTL (one upstream fetch)', async () => {
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => [rawIssue({})]),
    })
    const handler = makeListIssuesHandler(deps(client))
    await handler(envelope({}))
    await handler(envelope({}))
    expect(client.listOpenIssues).toHaveBeenCalledTimes(1)
  })

  it('serves the last good fetch with stale: true when GitHub errors', async () => {
    let calls = 0
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => {
        calls += 1
        if (calls === 1) return [rawIssue({})]
        throw new GithubApiError(500, 'boom')
      }),
    })
    const handler = makeListIssuesHandler(deps(client))
    const first = (await handler(envelope({}))) as { fetched_at_ms: number }
    // Force the cache past its TTL so the second call refetches and fails.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 60_000)
    try {
      const second = await handler(envelope({}))
      expect(second).toMatchObject({
        stale: true,
        token_available: true,
        fetched_at_ms: first.fetched_at_ms,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('denies when GitHub errors with nothing cached', async () => {
    const client = fakeClient({
      listOpenIssues: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    })
    const handler = makeListIssuesHandler(deps(client))
    await expect(handler(envelope({}))).rejects.toMatchObject({
      reason: 'github_unreachable',
    })
  })
})

describe('comment_issue', () => {
  it('denies github_no_token when degraded', async () => {
    const handler = makeCommentIssueHandler(deps(null))
    await expect(handler(envelope({ number: 1, body: 'hi' }))).rejects.toMatchObject({
      reason: 'github_no_token',
    })
  })

  it('comments and returns ids', async () => {
    const client = fakeClient()
    const handler = makeCommentIssueHandler(deps(client))
    const result = await handler(envelope({ number: 4, body: 'more detail' }))
    expect(result).toMatchObject({ ok: true, number: 4, comment_id: 99 })
    expect(client.createComment).toHaveBeenCalledWith(4, 'more detail')
  })

  it('rejects non-integer numbers', async () => {
    const handler = makeCommentIssueHandler(deps(fakeClient()))
    await expect(handler(envelope({ number: '4', body: 'x' }))).rejects.toMatchObject({
      reason: 'github_bad_number',
    })
    await expect(handler(envelope({ number: 0, body: 'x' }))).rejects.toBeInstanceOf(MeshDeny)
  })
})

describe('get_issue (#268 — the work_on_issue spec-guard read)', () => {
  it('denies github_no_token when degraded (a tool call can error; only panels need a degraded payload)', async () => {
    const handler = makeGetIssueHandler(deps(null))
    await expect(handler(envelope({ number: 1 }))).rejects.toMatchObject({
      reason: 'github_no_token',
    })
  })

  it('rejects non-integer numbers', async () => {
    const handler = makeGetIssueHandler(deps(fakeClient()))
    await expect(handler(envelope({ number: '7' }))).rejects.toMatchObject({
      reason: 'github_bad_number',
    })
  })

  it('serves the full detail — body and comments verbatim', async () => {
    const client = fakeClient()
    const handler = makeGetIssueHandler(deps(client))
    const result = await handler(envelope({ number: 1 }))
    expect(result).toMatchObject({
      ok: true,
      number: 1,
      state: 'open',
      labels: ['gap'],
    })
    expect(result.body).toContain('ARCHITECT SPEC')
    expect(result.body).toContain('Branch: lane/issue-1')
    expect((result.comments as Array<Record<string, unknown>>)[0]).toMatchObject({
      author: 'architect',
      body: 'ADDENDUM: batch semantics',
    })
  })

  it('denies github_is_pull_request for a PR number', async () => {
    const client = fakeClient({
      getIssue: vi.fn(async () => ({
        ...rawIssue({ number: 8 }),
        state: 'open' as const,
        pullRequest: true,
      })),
    })
    const handler = makeGetIssueHandler(deps(client))
    await expect(handler(envelope({ number: 8 }))).rejects.toMatchObject({
      reason: 'github_is_pull_request',
    })
  })

  it('maps a 404 to github_api_error with status', async () => {
    const client = fakeClient({
      getIssue: vi.fn(async () => {
        throw new GithubApiError(404, 'Not Found')
      }),
    })
    const handler = makeGetIssueHandler(deps(client))
    await expect(handler(envelope({ number: 9999 }))).rejects.toMatchObject({
      reason: 'github_api_error',
      details: { status: 404 },
    })
  })
})
