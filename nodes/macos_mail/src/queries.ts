// AppleScript invoked via @aether/macos-applescript. Queries Mail.app's
// inbox for the most recent N messages and returns tab-separated values:
//
//   <message_id>\t<subject>\t<sender>\t<iso_date>\t<read_status>\n
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
    set msgList to messages of inbox
    set msgLimit to 50
    set msgCount to 0
    repeat with msg in msgList
      if msgCount >= msgLimit then exit repeat
      set msgCount to msgCount + 1
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
