// Chats — a tasteful placeholder. The persistent-conversation surface (threaded
// history of voice + CLI turns) is a future lane; this view reserves the tab and
// states intent without faking data. Kept deliberately minimal so it reads as
// "coming", not "broken".
export function ChatsView(): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 select-none">
      <div className="text-xs tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
        CHATS
      </div>
      <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)', opacity: 0.6 }}>
        conversation history — soon
      </div>
    </div>
  )
}
