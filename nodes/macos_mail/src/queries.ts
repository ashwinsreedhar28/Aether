// AppleScript invoked via @aether/macos-applescript. Queries Mail.app's
// inbox for the 20 most recent messages and returns tab-separated values:
//
//   <message_id>\t<subject>\t<sender>\t<iso_date>\t<read_status>\n
//
// Scoped via `messages 1 thru 20 of inbox` rather than enumerating the
// full inbox — Mail.app indexes the inbox newest-first by default, so
// the range gives us the 20 most-recent without an explicit sort, and
// avoids the 30s `runAppleScript` timeout on large mailboxes (the prior
// "messages of inbox" form timed out on a 97k-message account). The
// range operator caps at the available count when the inbox holds
// fewer than 20.
//
// TSV is simpler than JSON-from-AppleScript (which is fragile across
// macOS versions). The poller splits the output and INSERT OR IGNOREs
// keyed on message_id. «class isot» returns ISO 8601 dates which
// Date.parse() handles natively. The try/on-error block ensures one
// unreadable message doesn't break the batch.
export const MAIL_RECENT_INBOX_QUERY = `
on run
  tell application "Mail"
    set output to ""
    set msgList to messages 1 thru 20 of inbox
    repeat with msg in msgList
      try
        set msgId to message id of msg
        set msgSubj to subject of msg
        set msgSender to sender of msg
        set msgDate to (date received of msg) as «class isot» as string
        set msgRead to read status of msg
        set msgReadStr to "0"
        if msgRead then set msgReadStr to "1"
        set output to output & msgId & tab & msgSubj & tab & msgSender & tab & msgDate & tab & msgReadStr & linefeed
      on error
        -- skip individual unreadable messages (corrupted, deleted mid-read)
      end try
    end repeat
    return output
  end tell
end run
`.trim()
