// AppleScript invoked via @aether/macos-applescript. Two queries:
//
//   1. MAIL_RECENT_INBOX_QUERY — headers only, the 20 most-recent inbox
//      messages, tab-separated, one record per line:
//        <message_id>\t<subject>\t<sender>\t<iso_date>\t<read_status>\n
//   2. buildSingleBodyQuery(position) — ONE message's plain-text body, by
//      inbox position. Body capture is split out from the header poll
//      because reading `content of msg` is slow (~4s/message on heavy HTML
//      mail — measured 84s for 20), which blows the bridge's 30s timeout if
//      batched. So bodies are fetched one message at a time for only the
//      top few, on separate bridge calls (see poller.ts).
//
// Scoped via `messages 1 thru 20 of inbox` rather than enumerating the
// full inbox — Mail.app indexes the inbox newest-first by default, so the
// range gives the most-recent without an explicit sort. The range operator
// caps at the available count when the inbox holds fewer than 20.
//
// CRITICAL — bulk property reads, not a per-message loop. Mail.app's
// Apple-Event latency is highly variable (measured sub-second when healthy,
// but 30–120s PER EVENT when the app is busy syncing/indexing a large store).
// A `repeat with msg in msgList` loop that reads five properties off each of
// 20 messages issues ~100 Apple Events, so any latency spike multiplies into
// a 30s-bridge-timeout and the whole poll (and everything downstream) stalls.
// Reading each property of the WHOLE list — `message id of msgList` etc. —
// returns a list in ONE event, cutting the poll to ~6 events total and
// keeping it under timeout through moderate Mail slowness. The TSV is then
// assembled locally (no Apple Events) from the parallel lists.
//
// TSV is simpler than JSON-from-AppleScript (fragile across macOS versions).
// «class isot» returns ISO 8601 dates Date.parse handles natively. The
// per-row try/on-error guards the local date coercion / assembly so one odd
// row doesn't drop the batch.
export const MAIL_RECENT_INBOX_QUERY = `
on run
  tell application "Mail"
    -- Each property is requested DIRECTLY on the range, not via an
    -- intermediate \`set msgList to messages 1 thru 20\`. Binding the messages
    -- to a variable makes Mail hand back message-id-keyed references, and a
    -- subsequent \`message id of msgList\` then fails -1728 ("Can't get message
    -- id of {message id N of mailbox …}"). Asking \`message id of messages 1
    -- thru 20 of inbox\` returns the value list in one event. The five reads
    -- run back-to-back; a message arriving between them could misalign a row
    -- by one (sub-ms window) — the per-row try below tolerates it and the
    -- next poll self-corrects.
    set idList to message id of messages 1 thru 20 of inbox
    set subjList to subject of messages 1 thru 20 of inbox
    set senderList to sender of messages 1 thru 20 of inbox
    set dateList to date received of messages 1 thru 20 of inbox
    set readList to read status of messages 1 thru 20 of inbox
    -- Coerce the already-fetched date list to ISO strings here, inside the
    -- tell: «class isot» only resolves in the app's terminology context. This
    -- loop iterates a local list — no Apple Events — so it stays fast.
    set isoList to {}
    repeat with j from 1 to (count of dateList)
      set end of isoList to ((item j of dateList) as «class isot» as string)
    end repeat
  end tell
  set output to ""
  set n to count of idList
  repeat with i from 1 to n
    try
      set readStr to "0"
      if (item i of readList) then set readStr to "1"
      set output to output & (item i of idList) & tab & (item i of subjList) & tab & (item i of senderList) & tab & (item i of isoList) & tab & readStr & linefeed
    on error
      -- skip a single odd row; the rest of the batch still emits
    end try
  end repeat
  return output
end run
`.trim()

// Source cap on a body, in raw characters, applied in AppleScript before
// transfer. Bounds the osascript payload; the poller applies the final
// (post-normalize) ~1500-char cap. Bodies longer than this set the
// truncated flag.
const BODY_SOURCE_CAP = 4000

// Build the single-message body query for a 1-based inbox position. Returns
// one tab-separated record (no trailing linefeed needed — single record):
//   <message_id>\t<body_truncated 0|1>\t<body>
// The body read is wrapped in its own try so an unreadable body yields an
// empty body field (→ body: null) rather than erroring the whole script and
// losing the message id. `foldWhitespace` folds tabs and every newline
// variant (CR/LF, vertical tab, form feed, U+2028/U+2029) to single spaces
// so the multi-line body survives as a single trailing TSV field; the
// poller does the run-collapse and final cap.
export function buildSingleBodyQuery(position: number): string {
  const pos = Math.max(1, Math.floor(position))
  return `
on run
  tell application "Mail"
    set msg to message ${pos} of inbox
    set msgId to message id of msg
    set bodyTrunc to "0"
    set bodyText to ""
    try
      set rawBody to content of msg
      if (length of rawBody) > ${BODY_SOURCE_CAP} then
        set rawBody to text 1 thru ${BODY_SOURCE_CAP} of rawBody
        set bodyTrunc to "1"
      end if
      set bodyText to my foldWhitespace(rawBody)
    end try
    return msgId & tab & bodyTrunc & tab & bodyText
  end tell
end run

on foldWhitespace(t)
  set AppleScript's text item delimiters to {tab, return, linefeed, character id 11, character id 12, character id 8232, character id 8233}
  set parts to text items of t
  set AppleScript's text item delimiters to " "
  set folded to parts as text
  set AppleScript's text item delimiters to ""
  return folded
end foldWhitespace
`.trim()
}
