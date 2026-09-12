# chessnote-plug-pdf-export

ChessNote's PDF export plug: renders a page's `fen`/`pgn`/`puzzle` blocks as
static (non-interactive) board images and pre-paginates the result into
print-ready pages/columns for PDF export.

## ⚠️ Not independently installable

This is a **mirrored source snapshot** of `plugs/chess-pdf-export/` from the
main [chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, kept
as a separate repository for clearer version tracking of this one feature
area.

It is **not** a standalone, installable SilverBullet plug:

- It calls chess-core (`chess.renderStaticBoardHtml`, `chess.getCss`) and
  chess-engine (`chess.engine.buildMoveList`) syscalls — it only makes sense
  running alongside them inside the ChessNote client build.
- The actual build (compiling this into a `.plug.js`, registering it in
  `plugs/builtin_plugs.ts`) happens in the main chessnote repo, not here.

To use or modify this code, work in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) repo instead — this
repo exists for reference and history, not standalone development.
