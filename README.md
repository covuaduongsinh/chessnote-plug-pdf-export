# chessnote-plug-pdf-export

A standalone SilverBullet plug: renders a page's `fen`/`pgn`/`puzzle` blocks
as static (non-interactive) board images and pre-paginates the result into
print-ready pages/columns for PDF export — extracted from
[ChessNote](https://github.com/covuaduongsinh/chessnote) (a chess-focused
SilverBullet fork).

## Install

**Install 2 dependencies first, in this order** (each is its own standalone
plug — see its README for its own install URL):

1. [`chessnote-plug-engine`](https://github.com/covuaduongsinh/chessnote-plug-engine)
2. [`chessnote-plug-core`](https://github.com/covuaduongsinh/chessnote-plug-core) (which itself needs `chessnote-plug-themes` and `chessnote-plug-db` first)

Then, in SilverBullet, run the **"Library: Install"** command and paste this
URL:

```
https://raw.githubusercontent.com/covuaduongsinh/chessnote-plug-pdf-export/main/chess-pdf-export-library.md
```

This pulls in `chess-pdf-export.plug.js` (the compiled plug) along with the
library page. After installing, run **"Plugs: Reload"** if it doesn't load
automatically.

## What it provides

Static board rendering + text/board pagination logic used by ChessNote's
"Export to PDF" flow (which drives headless-Chrome page rendering on the
server side, outside this plug itself).

## Development

Source lives here **and** as `plugs/chess-pdf-export/` in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, which is
where `chess-pdf-export.plug.yaml` actually gets compiled during ChessNote's
own build (`npm run build:plugs`). This repo's `chess-pdf-export.plug.js` is
a manually-published snapshot — after changing the source here (or there),
rebuild and re-copy the compiled `.plug.js` to keep this repo's install URL
up to date.

To compile it yourself from this repo directly, you'll need SilverBullet's
plug-compile tooling (see [Plug
Development](https://silverbullet.md/Plugs/Development) docs) pointed at
`chess-pdf-export.plug.yaml`, with the 2 dependency plugs above already
installed in the target Space (this plug only calls their syscalls by name
at runtime — it doesn't need their source to build).
