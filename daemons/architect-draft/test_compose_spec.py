"""The guard interaction (#312's load-bearing clause): composed output can
NEVER match the line-anchored spec guard. A machine draft that satisfied the
guard would self-certify past the work_on_issue spawn gate — these tests pin
the sanitizer (defang), the assembled comment, and the hard floor under both
(_assert_unguarded). Stdlib-only: compose_spec keeps its heavy imports
(google-genai, rag_lib/fastembed) lazy, so this file runs under any pytest.

Regex parity with the spawn-side authority
(raven_core/tools/work_on_issue_tool.py:_SPEC_MARKER_RE) is pinned in
daemons/raven-core/tests/test_draft_spec_gate.py, where that module is
importable; here we test against compose_spec's own copy.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest

import compose_spec as cs

# Every shape the guard certifies (work_on_issue_tool's docstring: bare,
# indented, and/or fenced) plus a mid-draft injection — if the model emits
# any of these, the sanitizer must break the anchor.
ADVERSARIAL_DRAFTS = [
    "ARCHITECT SPEC — fix the thing",
    "  ARCHITECT SPEC — indented",
    "=== ARCHITECT SPEC ===",
    "  ===  ARCHITECT SPEC, indented fence",
    "PROBLEM: x\nARCHITECT SPEC\nFIX (skeleton): y",
    "PROBLEM: ok\n\n=== ARCHITECT SPEC ===\nSMOKE: z",
]


@pytest.mark.parametrize("draft", ADVERSARIAL_DRAFTS)
def test_defang_neutralizes_every_guard_shape(draft):
    assert cs.SPEC_GUARD_RE.search(draft)  # the input really is adversarial
    assert not cs.SPEC_GUARD_RE.search(cs.defang(draft))


def test_defang_blockquotes_rather_than_deletes():
    # The human reader still sees what the model wrote; only the machine
    # anchor breaks (the gap.ts idiom).
    defanged = cs.defang("ARCHITECT SPEC — fix the thing")
    assert defanged == "> ARCHITECT SPEC — fix the thing"


def test_defang_leaves_clean_drafts_untouched():
    clean = "PROBLEM: no timer surface\nFIX (skeleton):\n1. add it\nSMOKE: ask for a timer"
    assert cs.defang(clean) == clean


def test_defang_leaves_mid_line_mentions_alone():
    # A prose mention ("…until an ARCHITECT SPEC lands…") never satisfied the
    # line-anchored guard, so the sanitizer must not mangle it.
    prose = "no implementer starts until an ARCHITECT SPEC comment lands"
    assert cs.defang(prose) == prose


@pytest.mark.parametrize("draft", ADVERSARIAL_DRAFTS)
def test_assembled_comment_cannot_match_the_guard(draft):
    # The unit test #312 item 2 mandates: the composed output — the FULL
    # comment body that would be posted — cannot match the guard regex.
    body = cs.assemble_comment(311, "gap(timers): user asked to set a timer", draft, "test-model")
    assert not cs.SPEC_GUARD_RE.search(body)
    assert body.startswith(cs.DRAFT_PREFIX)


def test_prefix_itself_cannot_certify():
    assert not cs.SPEC_GUARD_RE.search(cs.DRAFT_PREFIX)


def test_assemble_flattens_multiline_titles():
    # GitHub titles are single-line, but the prefix line must hold even if a
    # newline sneaks in — otherwise the line after the break could anchor.
    body = cs.assemble_comment(311, "gap(x)\nARCHITECT SPEC", "PROBLEM: y", "test-model")
    assert not cs.SPEC_GUARD_RE.search(body)
    assert body.splitlines()[0] == f"{cs.DRAFT_PREFIX}gap(x) ARCHITECT SPEC"


def test_hard_floor_raises_on_violation():
    with pytest.raises(cs.GuardViolation):
        cs._assert_unguarded("ARCHITECT SPEC — somehow survived")


def test_hard_floor_passes_clean_bodies():
    cs._assert_unguarded(f"{cs.DRAFT_PREFIX}gap(x)\n\nPROBLEM: y\n\nFull §7. Closes #311.")


# --- The model-facing refusals that guard the pipeline's edges ----------------


def test_ratified_issue_is_detected_in_body_and_comments():
    in_body = {"body": "ARCHITECT SPEC — already ratified", "comments": []}
    in_comment = {"body": "a gap record", "comments": [{"body": "=== ARCHITECT SPEC ===\nFIX: x"}]}
    unratified = {"body": "a gap record", "comments": [{"body": "asked again:\n> do it"}]}
    assert cs.ratified_spec_present(in_body)
    assert cs.ratified_spec_present(in_comment)
    assert not cs.ratified_spec_present(unratified)


def test_model_resolution_refuses_without_config(monkeypatch, tmp_path):
    # 'Never hardcoded' has teeth only if the unconfigured path refuses
    # instead of falling back to a baked-in id.
    monkeypatch.delenv(cs.MODEL_ENV, raising=False)
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("RAVEN_USER_DIR", raising=False)
    with pytest.raises(cs.ComposeError, match="no draft model configured"):
        cs.resolve_model()


def test_model_resolution_env_wins_over_config(monkeypatch, tmp_path):
    config_dir = tmp_path / "architect"
    config_dir.mkdir(parents=True)
    (config_dir / "config.json").write_text('{"draft_model": "from-config"}', encoding="utf-8")
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv(cs.MODEL_ENV, "from-env")
    assert cs.resolve_model() == "from-env"
    monkeypatch.delenv(cs.MODEL_ENV)
    assert cs.resolve_model() == "from-config"


def test_rag_queries_from_gap_record_shape():
    issue = {
        "number": 311,
        "title": "gap(timers): user asked to set a timer; no timer surface",
        "body": (
            "**Utterance (verbatim):**\n\n> set a timer for five minutes\n\n"
            "**Attempted path / failure:** no timer tool registered\n"
            "**Session:** abc\n"
        ),
    }
    queries = cs.rag_queries(issue)
    assert queries[0] == "gap(timers): user asked to set a timer; no timer surface"
    assert "set a timer for five minutes" in queries
    assert "no timer tool registered" in queries
    assert len(queries) <= cs.RAG_QUERIES_MAX


def test_repo_resolution_mirrors_the_node(monkeypatch):
    # Parity with nodes/github/src/index.ts: env override → DEFAULT_REPO,
    # malformed refuses loud.
    monkeypatch.delenv("AETHER_GITHUB_REPO", raising=False)
    assert cs._repo() == cs.DEFAULT_REPO
    monkeypatch.setenv("AETHER_GITHUB_REPO", "owner/name")
    assert cs._repo() == "owner/name"
    monkeypatch.setenv("AETHER_GITHUB_REPO", "not-a-repo")
    with pytest.raises(cs.ComposeError, match="owner/name"):
        cs._repo()


def test_rag_queries_skip_empty_failure_dash():
    issue = {"number": 1, "title": "gap(x): y", "body": "> say it\n\n**Attempted path / failure:** —\n"}
    assert cs.rag_queries(issue) == ["gap(x): y", "say it"]
