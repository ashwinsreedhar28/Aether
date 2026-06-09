"""status_report — Python mirror of @viewer/core's status_report generator.

Emits ONE `markdown` View whose inline source is a rich, structured briefing
(headers, a table, bullet + numbered lists, bold/emphasis, a blockquote). The
shared markdown renderer reads `source.value` as GitHub-flavored markdown.

The markdown string is assembled from blocks joined by a fixed separator so it
is byte-identical to the TS mirror (src/generators/status_report.ts) for the
same input. Calling with no params yields a full Daily Ops Briefing.

Keep this in lockstep with src/generators/status_report.ts. Dependency-free
besides the registry helpers it imports from viewer_generators.
"""
from __future__ import annotations

DEFAULT_TITLE = "Daily Ops Briefing"
DEFAULT_SUBTITLE = "Engineering Status - Cycle 24, Day 3 - Prepared by Platform On-Call"
DEFAULT_SUMMARY = (
    "All primary services green. One Sev-2 (checkout latency) was resolved "
    "overnight; root cause was a stale connection pool. The v2.14 release train "
    "remains on schedule for Friday."
)
DEFAULT_SECTIONS: list[dict] = [
    {
        "heading": "Key Metrics",
        "body": "\n".join(
            [
                "| Metric | Today | 7-day avg | Trend |",
                "| --- | --- | --- | --- |",
                "| Uptime (core API) | 99.98% | 99.95% | up |",
                "| p95 latency | 142 ms | 168 ms | improving |",
                "| Error rate | 0.04% | 0.06% | improving |",
                "| Deploys shipped | 11 | 8 | up |",
                "| Open Sev-1 / Sev-2 | 0 / 1 | 0 / 2 | improving |",
            ]
        ),
    },
    {
        "heading": "Highlights",
        "body": "\n".join(
            [
                "- **Checkout latency Sev-2 resolved** at 03:12 UTC. The fix shipped in `hotfix/pool-recycle` and added a connection-pool recycler.",
                "- **Search relevance** rollout reached 50% of traffic; click-through is up **6.2%** versus control.",
                "- **Cost**: the spot-instance migration cut nightly batch spend by roughly **$1,840/week**.",
            ]
        ),
    },
    {
        "heading": "Risks & Blockers",
        "body": "\n".join(
            [
                "- **Postgres primary** is approaching 78% disk. A failover drill is scheduled before Thursday.",
                "- The vendor TLS certificate for `payments-gw` expires in **6 days**; the renewal PR is awaiting approval.",
                "- The iOS build pipeline is flaky (2 of 9 runs failed at the signing step) and is under investigation.",
            ]
        ),
    },
    {
        "heading": "Next 24 Hours",
        "body": "\n".join(
            [
                "1. Promote the search rollout to 100% pending a final relevance review.",
                "2. Run the Postgres failover drill and reclaim disk on the primary.",
                "3. Merge the `payments-gw` certificate renewal and verify the handshake in staging.",
                "4. Cut the v2.14 release branch and freeze non-critical merges.",
            ]
        ),
    },
]


def _build_markdown(
    title: str, subtitle: str | None, summary: str | None, sections: list[dict]
) -> str:
    """Assemble the markdown document from ordered blocks joined by a blank line.

    Must match the TS `buildMarkdown` so the resulting string is byte-identical.
    """
    blocks: list[str] = [f"# {title}"]
    if subtitle is not None:
        blocks.append(f"_{subtitle}_")
    if summary is not None:
        blocks.append(f"> {summary}")
    for s in sections:
        blocks.append(f"## {s['heading']}\n\n{s['body']}")
    return "\n\n".join(blocks)


def status_report_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one markdown View (as a dict)."""
    params = params or {}
    title = params.get("title", DEFAULT_TITLE)
    subtitle = params.get("subtitle", DEFAULT_SUBTITLE)
    summary = params.get("summary", DEFAULT_SUMMARY)
    sections = params.get("sections", DEFAULT_SECTIONS)
    content = _build_markdown(title, subtitle, summary, sections)
    return [
        {
            "id": params.get("id", "status"),
            "type": "markdown",
            "title": params.get("title", DEFAULT_TITLE),
            "source": {"kind": "inline", "value": content},
            "layout": {"w": 0.8, "h": 1, "hint": "tall"},
        }
    ]


status_report_generator: dict = {
    "slug": "status_report",
    "describe": "Emit a markdown status/briefing View (defaults to a full Daily Ops Briefing).",
    "generate": status_report_build,
}


def register_status_report_generator() -> None:
    """Register the status_report generator with the shared registry.

    Imports the registry lazily so this module stays standalone — build() has no
    dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(status_report_generator)
