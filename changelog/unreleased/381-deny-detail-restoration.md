### Fixed
- The 9 `reason:`-in-details deny sites #371's audit flagged out-of-scope
  now carry their free-text causes under `detail:` per the deny-payload
  convention (#381) — news_feeds (`news_feeds_bad_query` ×3,
  `news_feeds_bad_entity` ×3), sports (`sports_event_required`),
  host_notifications (`host_notifications_unsupported`), macos_mail
  (`macos_mail_unsupported`). Post-#371-flip those causes were silently
  dropped on the wire (the deny name always wins the `reason` key); this
  restores them. `nodes/` now greps clean of `reason:`-in-details.
