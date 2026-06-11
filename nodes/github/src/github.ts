// Thin GitHub REST v3 client (fetch-based, api.github.com). Deliberately NOT
// the gh CLI (#256 pre-decision): a fine-grained PAT in env is deterministic
// where gh's auth state is host-dependent. The token travels ONLY in the
// Authorization header — it must never appear in errors, logs, or thrown
// messages (GithubApiError messages come from GitHub's response body).

import type { RawIssue } from './types'

const API_ROOT = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 10_000

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GithubApiError'
  }
}

/** What the handlers depend on. GithubClient implements it against the real
 *  API; tests substitute a fake. */
export interface IssueClient {
  /** Open issues, newest-first, PRs filtered out. `labels` is GitHub's
   *  comma-separated label filter (issues must carry ALL listed labels).
   *  EVENTUALLY CONSISTENT: a just-created issue may be absent for a few
   *  seconds — dedup's memo path exists because of this. */
  listOpenIssues(opts: { labels?: string | null; perPage: number }): Promise<RawIssue[]>
  createIssue(opts: {
    title: string
    body: string
    labels: string[]
  }): Promise<{ number: number; url: string }>
  createComment(issueNumber: number, body: string): Promise<{ comment_id: number; url: string }>
  /** Direct by-number read — strongly consistent, unlike the filtered list. */
  getIssueState(issueNumber: number): Promise<'open' | 'closed'>
  /** Full single-issue read (body included, any state). Throws GithubApiError
   *  404 for an unknown number; returns `pullRequest: true` for a PR number so
   *  the handler can deny it cleanly. */
  getIssue(issueNumber: number): Promise<RawIssueDetail>
  /** First page of an issue's comments, oldest-first (GitHub default order). */
  listComments(issueNumber: number, perPage: number): Promise<RawComment[]>
}

/** github.getIssue's return — RawIssue plus the fields a single-issue read
 *  adds (real state, PR discriminator). Omit re-widens `state`: the list
 *  type pins it to 'open' (state=open filter), a by-number read does not. */
export interface RawIssueDetail extends Omit<RawIssue, 'state'> {
  state: 'open' | 'closed'
  pullRequest: boolean
}

export interface RawComment {
  author: string | null
  body: string
  created_at: string
}

// GET /repos/:repo/issues returns PRs too — `pull_request` presence is the
// discriminator. Labels arrive as objects or bare strings depending on API
// mood; both are handled.
interface GhIssueRaw {
  number: number
  title: string
  labels: Array<{ name?: string } | string>
  created_at: string
  updated_at: string
  comments: number
  html_url: string
  user: { login?: string } | null
  body: string | null
  pull_request?: unknown
}

function toRawIssue(raw: GhIssueRaw): RawIssue {
  return {
    number: raw.number,
    title: raw.title,
    labels: raw.labels
      .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
      .filter((name) => name.length > 0),
    state: 'open',
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    comments: raw.comments,
    url: raw.html_url,
    author: raw.user?.login ?? null,
    body: raw.body,
  }
}

export class GithubClient implements IssueClient {
  constructor(
    private readonly repo: string,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = ((await response.json()) as { message?: string }).message ?? ''
      } catch {
        /* non-JSON error body — status alone will have to do */
      }
      throw new GithubApiError(response.status, detail || `HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }

  async listOpenIssues(opts: { labels?: string | null; perPage: number }): Promise<RawIssue[]> {
    const labelsParam = opts.labels ? `&labels=${encodeURIComponent(opts.labels)}` : ''
    const raw = await this.request<GhIssueRaw[]>(
      'GET',
      `/repos/${this.repo}/issues?state=open&per_page=${opts.perPage}${labelsParam}`,
    )
    return raw.filter((issue) => issue.pull_request === undefined).map(toRawIssue)
  }

  async createIssue(opts: {
    title: string
    body: string
    labels: string[]
  }): Promise<{ number: number; url: string }> {
    const created = await this.request<{ number: number; html_url: string }>(
      'POST',
      `/repos/${this.repo}/issues`,
      { title: opts.title, body: opts.body, labels: opts.labels },
    )
    return { number: created.number, url: created.html_url }
  }

  async createComment(
    issueNumber: number,
    body: string,
  ): Promise<{ comment_id: number; url: string }> {
    const created = await this.request<{ id: number; html_url: string }>(
      'POST',
      `/repos/${this.repo}/issues/${issueNumber}/comments`,
      { body },
    )
    return { comment_id: created.id, url: created.html_url }
  }

  async getIssueState(issueNumber: number): Promise<'open' | 'closed'> {
    const issue = await this.request<{ state: string }>(
      'GET',
      `/repos/${this.repo}/issues/${issueNumber}`,
    )
    return issue.state === 'open' ? 'open' : 'closed'
  }

  async getIssue(issueNumber: number): Promise<RawIssueDetail> {
    const raw = await this.request<GhIssueRaw & { state: string }>(
      'GET',
      `/repos/${this.repo}/issues/${issueNumber}`,
    )
    return {
      ...toRawIssue(raw),
      state: raw.state === 'open' ? 'open' : 'closed',
      pullRequest: raw.pull_request !== undefined,
    }
  }

  async listComments(issueNumber: number, perPage: number): Promise<RawComment[]> {
    const raw = await this.request<
      Array<{ body: string | null; user: { login?: string } | null; created_at: string }>
    >('GET', `/repos/${this.repo}/issues/${issueNumber}/comments?per_page=${perPage}`)
    return raw.map((c) => ({
      author: c.user?.login ?? null,
      body: c.body ?? '',
      created_at: c.created_at,
    }))
  }
}
