<!-- chat-ux components. Interface agreed with story-panel:

  <div className="mb-chat-shell">
    <MessageList pinKey={userMessageCount} busy={streaming}>…</MessageList>   the transcript, the only scroller
    <Composer onSend onStop running disabledReason commands />                  pinned under it
  </div>

  commands?: { name: string; hint: string }[]   names include the slash, e.g. { name: '/story', hint: 'Write a report' }.
  Typing "/" at the start of the composer opens a menu of the commands whose name starts with what was typed; picking
  one (pointer, or arrows then Enter/Tab) puts "/story " in the box. Sending is still onSend(text): the caller parses it.

  Layout: .mb-chat-shell fills a flex column with min-height: 0 (the panel layout's left column). The list scrolls;
  the composer stays at the bottom.
-->
