### Fixed
- Spec-review verdict cites the head commit SHA, not a file blob SHA (#316).
  The reviewer cell's prompt now receives the head commit explicitly
  (`HEAD_SHA: ${{ github.event.pull_request.head.sha }}` interpolated into
  `claude-spec-review.yml`) and the verdict block must end with exactly
  `Reviewed <HEAD_SHA> against issue #<n>` — SHAs sourced from API payloads
  (e.g. blob SHAs in `pulls/{n}/files`) are forbidden, so the
  one-verdict-per-head-SHA supersede contract keys on a real commit.
