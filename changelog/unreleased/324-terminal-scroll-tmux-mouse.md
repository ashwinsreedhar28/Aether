### Fixed
- Lane terminal scroll scrolls the buffer, not command history (#324): the
  spawn recipe now enables tmux mouse mode per lane session (`set-option -t
  %pane_id mouse on` right after pane resolution — `mouse` is a session
  option, so the pane target sets it on the owning session and only that
  session). Without it tmux translated wheel events into arrow keys per the
  alternate-screen convention, so wheeling at the prompt walked history and
  off-screen output was unreachable. Wheel-up now enters copy-mode and
  scrolls back; wheel-down at the bottom returns to live; arrow keys still
  reach the shell unchanged. User-global tmux config untouched; renderer
  xterm hosts needed no change (nothing suppresses mouse reporting, and both
  plain-pty surfaces already carry `scrollback: 10000`). Run-4 matrix
  extended in the field: `set-option` is pane-typed for targets — `-t
  =lane-N` fails on tmux 3.6b exactly as send-keys did in #302.
