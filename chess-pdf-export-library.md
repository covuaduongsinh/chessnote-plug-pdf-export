---
name: Library/chessnote/Chess PDF Export
tags: meta/library
files:
  - chess-pdf-export.plug.js
---
# Chess PDF Export

Renders a ChessNote page to a print-ready PDF (paginating text + static
board diagrams + move lists), via headless-Chrome page rendering on the
server side.

**Depends on 2 other plugs, installed first**:
[`chessnote-plug-core`](https://github.com/covuaduongsinh/chessnote-plug-core)
(static board rendering, board CSS) and
[`chessnote-plug-engine`](https://github.com/covuaduongsinh/chessnote-plug-engine)
(move lists).

Originally built as part of
[ChessNote](https://github.com/covuaduongsinh/chessnote), a chess-focused
SilverBullet fork.

Source: [chessnote-plug-pdf-export](https://github.com/covuaduongsinh/chessnote-plug-pdf-export).
