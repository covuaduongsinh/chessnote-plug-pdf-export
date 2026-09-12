import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { markdown } from "@silverbulletmd/silverbullet/syscalls";
import { Chess } from "chess.js";
import { getChessCss, renderStaticBoardHtml } from "../chess/plug_api.ts";
import { buildMoveList } from "../chess-engine/plug_api.ts";
import type { MoveListEntry } from "../chess-engine/game_reviewer.ts";
import {
  type BoardMeta,
  computeColumnGeometry,
  estimateBoardHeightPx,
  estimateTextHeightPx,
  paginateUnits,
} from "./pdf_pagination.ts";

const DEFAULT_BOARD_SIZE = 400;
const MIN_BOARD_SIZE = 150;
const MAX_BOARD_SIZE = 700;

/**
 * `CHESS_CSS`'s `--bg-panel`/`--text-main`/etc. default to the app's *dark*
 * theme (see `board_renderer.ts`) because the live editor is usually dark;
 * a printed page is not, and doesn't carry a `data-theme` attribute to key
 * off of either. Overrides those to a plain light/paper scheme, plus the two
 * classes this module's own output uses that `CHESS_CSS` doesn't define
 * (`.chessnote-static-board`'s sizing, `.chess-pgn-movetext`'s typography),
 * plus the `.pdf-page`/`.pdf-col` layout `renderPageForPdf` assembles pages
 * into (see `pdf_pagination.ts` for why this replaced CSS `column-count`).
 *
 * `boardSize` (px) controls `.chessnote-static-board`'s `max-width` — the
 * caller (`renderPageForPdf`) clamps it before it ever reaches here.
 */
function buildPdfExtraCss(boardSize: number): string {
  return `
:root {
  --bg-panel: #ffffff;
  --text-main: #111111;
  --text-muted: #555555;
  --board-border: #78350f;
}
.pdf-page {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 24px;
  break-after: page;
  page-break-after: always;
}
.pdf-page:last-child {
  break-after: auto;
  page-break-after: auto;
}
.pdf-col {
  flex: 1 1 0;
  min-width: 0;
}
.chessnote-static-board {
  width: 100%;
  max-width: ${boardSize}px;
  margin: 10px auto 16px;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
  display: block;
  box-sizing: border-box;
}
.chessnote-static-board .chess-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--text-main);
  break-after: avoid !important;
  page-break-after: avoid !important;
  -webkit-column-break-after: avoid !important;
}
.chessnote-static-board .chess-board {
  width: 100% !important;
  max-width: ${boardSize}px !important;
  height: auto !important;
  aspect-ratio: 1 / 1 !important;
  margin: 0 auto;
  display: grid !important;
  grid-template-columns: repeat(8, 1fr) !important;
  grid-template-rows: repeat(8, 1fr) !important;
  border: 1.5px solid var(--board-border, #78350f);
  border-radius: 4px;
  overflow: hidden;
  box-sizing: border-box;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
.chessnote-static-board .chess-sq {
  width: 100% !important;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.chessnote-static-board .chess-piece {
  width: 86% !important;
  height: 86% !important;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.chessnote-static-board .chess-piece svg {
  width: 100%;
  height: 100%;
  display: block;
}
.chessnote-static-board .chess-coord {
  position: absolute;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  opacity: 0.8;
}
.chessnote-static-board .coord-file { bottom: 1px; right: 2px; }
.chessnote-static-board .coord-rank { top: 1px; left: 2px; }
.chessnote-static-board .puzzle-hint-box {
  margin-top: 6px;
  break-inside: avoid !important;
}
.chessnote-static-board .fen-footer {
  margin-top: 6px;
  break-inside: avoid !important;
}
.chess-pgn-movetext {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  margin: 4px 0 14px;
  word-break: break-word;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface BoardRender {
  html: string;
  meta: BoardMeta;
}

/** `fen` block body: first line is the FEN, optional `| key: value` lines follow (see `fenWidget`). */
async function renderFenBlockForPdf(bodyText: string): Promise<BoardRender> {
  const lines = bodyText.trim().split("\n");
  const fen = lines[0]?.trim() ?? "";
  let title = "";
  let orientation: "white" | "black" = "white";
  let pieceSet = "merida";
  let boardTheme = "textbook";
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("| title:")) {
      title = line.replace("| title:", "").trim();
    } else if (line.startsWith("| orientation:")) {
      orientation = line.includes("black") ? "black" : "white";
    } else if (line.startsWith("| pieceSet:") || line.startsWith("| pieces:")) {
      pieceSet = line.replace(/\| (pieceSet|pieces):/, "").trim();
    } else if (
      line.startsWith("| boardTheme:") ||
      line.startsWith("| theme:") ||
      line.startsWith("| board:")
    ) {
      boardTheme = line.replace(/\| (boardTheme|theme|board):/, "").trim();
    }
  }
  const html = await renderStaticBoardHtml(fen, {
    title,
    orientation,
    showFen: false,
    pieceSet,
    boardTheme,
  });
  return {
    html,
    meta: {
      hasTitle: title.length > 0,
      titleLength: title.length,
      movetextLength: 0,
      hintLength: 0,
      isError: !html.includes("chessnote-static-board"),
    },
  };
}

/** `puzzle` block body: `key: value` lines (see `puzzleWidget`) — only `fen`/`hint` matter for a static print. */
async function renderPuzzleBlockForPdf(
  bodyText: string,
): Promise<BoardRender> {
  const lines = bodyText.trim().split("\n");
  let fen = "";
  let hint = "";
  let pieceSet = "merida";
  let boardTheme = "textbook";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("fen:")) {
      fen = trimmed.replace("fen:", "").trim();
    } else if (trimmed.startsWith("hint:")) {
      hint = trimmed.replace("hint:", "").trim();
    } else if (
      trimmed.startsWith("pieceSet:") ||
      trimmed.startsWith("pieces:")
    ) {
      pieceSet = trimmed.replace(/(pieceSet|pieces):/, "").trim();
    } else if (
      trimmed.startsWith("boardTheme:") ||
      trimmed.startsWith("theme:") ||
      trimmed.startsWith("board:")
    ) {
      boardTheme = trimmed.replace(/(boardTheme|theme|board):/, "").trim();
    }
  }
  const title = "Bài tập cờ";
  const board = await renderStaticBoardHtml(fen, {
    title,
    showFen: false,
    pieceSet,
    boardTheme,
  });
  const isError = !board.includes("chessnote-static-board");
  const hintHtml =
    !isError && hint
      ? `<div class="puzzle-hint-box">Gợi ý: ${escapeHtml(hint)}</div>`
      : "";
  return {
    html: `${board}${hintHtml}`,
    meta: {
      hasTitle: !isError,
      titleLength: title.length,
      movetextLength: 0,
      hintLength: hintHtml ? hint.length : 0,
      isError,
    },
  };
}

const START_POSITION_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function labelForMove(entry: MoveListEntry): string {
  return entry.isWhite
    ? `sau nước ${entry.moveNum}`
    : `sau nước đen ${entry.moveNum}`;
}

/**
 * Resolves a `pgn` block's optional `[DisplayMove "..."]` PGN tag (a custom
 * tag — chess.js loads and round-trips arbitrary tag pairs without them
 * affecting move parsing) to the move it refers to, so the PDF board can show
 * that position instead of always the game's start.
 *
 * Accepted `tagValue` forms: `"17"`/`"17w"` (after White's move 17), `"17b"`
 * (after Black's move 17), `"last"` (the game's final move). A value with no
 * exact match (typo, or past the game's actual move count) falls back to the
 * latest move at or before the one requested, so "close enough" input still
 * does something sensible instead of erroring on a single-user's own notes.
 * Returns `null` (→ caller keeps the start position) when there's no tag, no
 * moves, or nothing at or before the requested move.
 */
function resolveDisplayMove(
  moves: MoveListEntry[],
  tagValue: string | undefined,
): { entry: MoveListEntry; label: string } | null {
  if (!tagValue || moves.length === 0) return null;
  const trimmed = tagValue.trim();

  if (trimmed.toLowerCase() === "last") {
    const entry = moves[moves.length - 1];
    return { entry, label: labelForMove(entry) };
  }

  const match = /^(\d+)\s*(w|b)?$/i.exec(trimmed);
  if (!match) return null;
  const moveNum = parseInt(match[1], 10);
  const isWhite = (match[2] ?? "w").toLowerCase() !== "b";

  let entry = moves.find((m) => m.moveNum === moveNum && m.isWhite === isWhite);
  if (!entry) {
    const candidates = moves.filter(
      (m) =>
        m.moveNum < moveNum || (m.moveNum === moveNum && m.isWhite && !isWhite),
    );
    entry = candidates[candidates.length - 1];
  }
  return entry ? { entry, label: labelForMove(entry) } : null;
}

/**
 * `pgn` block body: a raw PGN game. A static print defaults to the starting
 * position (an interactive replay, which is what `pgnWidget` shows instead,
 * has no equivalent on paper) plus the full movetext in standard notation —
 * unless the PGN's own `[DisplayMove "..."]` tag points at a specific move
 * (see `resolveDisplayMove`), in which case the board shows that position and
 * the title notes which move it is.
 */
async function renderPgnBlockForPdf(bodyText: string): Promise<BoardRender> {
  const trimmedPgn = bodyText.trim();
  let chess: Chess;
  try {
    chess = new Chess();
    if (trimmedPgn) {
      chess.loadPgn(trimmedPgn);
    }
  } catch (e) {
    const html = `<div class="chess-error-banner">PGN không hợp lệ: ${
      e instanceof Error ? escapeHtml(e.message) : ""
    }</div>`;
    return {
      html,
      meta: {
        hasTitle: false,
        titleLength: 0,
        movetextLength: 0,
        hintLength: 0,
        isError: true,
      },
    };
  }

  const header = chess.header();
  const white = header["White"] || "White";
  const black = header["Black"] || "Black";
  const result = header["Result"] || "*";

  let moves: MoveListEntry[] = [];
  try {
    moves = await buildMoveList(trimmedPgn);
  } catch {
    // Malformed PGN already surfaced above via the loadPgn catch; an empty
    // move list here just means no moves to list/display, not a second error.
  }

  const displayMove = resolveDisplayMove(
    moves,
    header["DisplayMove"] ?? undefined,
  );
  const titleSuffix = displayMove ? ` — ${displayMove.label}` : "";
  const title = `${white} vs ${black} (${result})${titleSuffix}`;
  const pieceSet = header["PieceSet"] || header["Pieces"] || "merida";
  const boardTheme = header["BoardTheme"] || header["Theme"] || "textbook";
  const board = await renderStaticBoardHtml(
    displayMove?.entry.fenAfter ?? START_POSITION_FEN,
    {
      title,
      showFen: false,
      pieceSet,
      boardTheme,
    },
  );

  let movetext = "";
  for (const move of moves) {
    movetext += move.isWhite ? `${move.moveNum}. ${move.san} ` : `${move.san} `;
  }
  const movetextTrimmed = movetext.trim();
  const html = `${board}<div class="chess-pgn-movetext">${escapeHtml(movetextTrimmed)}</div>`;
  return {
    html,
    meta: {
      hasTitle: true,
      titleLength: title.length,
      movetextLength: movetextTrimmed.length,
      hintLength: 0,
      isError: false,
    },
  };
}

function fenceLang(node: ParseTree): string | undefined {
  if (node.type !== "FencedCode") return undefined;
  const codeInfoNode = findNodeOfType(node, "CodeInfo");
  return codeInfoNode?.children?.[0]?.text;
}

async function renderFenceForPdf(
  node: ParseTree,
  lang: string,
): Promise<BoardRender> {
  const codeTextNode = findNodeOfType(node, "CodeText");
  const body = codeTextNode?.children?.[0]?.text ?? "";
  return lang === "fen"
    ? await renderFenBlockForPdf(body)
    : lang === "pgn"
      ? await renderPgnBlockForPdf(body)
      : await renderPuzzleBlockForPdf(body);
}

type PdfBlock =
  | { kind: "board"; html: string; estHeight: number }
  | { kind: "text"; markdownSrc: string; estHeight: number };

/**
 * Turns page markdown into a print-ready, pre-paginated HTML document: every
 * `fen`/`pgn`/`puzzle` code fence becomes a static, non-interactive board
 * rendering (see `board_renderer.ts`), and the page's top-level blocks
 * (headings, paragraphs, boards, etc.) are greedily packed into `columns`
 * columns per physical page (see `pdf_pagination.ts`) using estimated block
 * heights — *not* the browser's own CSS `column-count`, which doesn't
 * reliably keep a board from being split across a page boundary once nested
 * inside print pagination (see `pdf_pagination.ts`'s module doc).
 *
 * Called by the "PDF: Xuất file PDF" exporter in
 * `Library/Std/Infrastructure/Export.md`, which then hands the result to
 * `editor.exportPdf` for the actual PDF rendering + download.
 *
 * `boardSize` (px, default {@link DEFAULT_BOARD_SIZE}) sets how wide each
 * static board renders — clamped to [{@link MIN_BOARD_SIZE},
 * {@link MAX_BOARD_SIZE}] so a bad config/frontmatter value can't shrink
 * boards past legibility or blow past a single PDF column's width.
 * `columns` (1 or 2, default 2) sets how many columns each physical page has.
 */
export async function renderPageForPdf(
  text: string,
  boardSize?: number,
  columns?: number,
): Promise<string> {
  const clampedBoardSize = Math.min(
    MAX_BOARD_SIZE,
    Math.max(MIN_BOARD_SIZE, boardSize ?? DEFAULT_BOARD_SIZE),
  );
  const resolvedColumns: 1 | 2 = columns === 1 ? 1 : 2;
  const { colWidthPx, colBudgetPx } = computeColumnGeometry(resolvedColumns);

  const tree = (await markdown.parseMarkdown(text)) as ParseTree;

  // All fen/pgn/puzzle fences anywhere in the tree (matches the fence's own
  // static-board render to its node) — usually top-level, but a fence nested
  // inside e.g. a blockquote/list is still converted, just not given its own
  // atomic page/column placement (see the fallback branch below).
  const boardByNode = new Map<ParseTree, BoardRender>();
  for (const node of collectNodesOfType(tree, "FencedCode")) {
    const lang = fenceLang(node);
    if (lang !== "fen" && lang !== "pgn" && lang !== "puzzle") continue;
    boardByNode.set(node, await renderFenceForPdf(node, lang));
  }

  const blocks: PdfBlock[] = [];
  for (const node of tree.children ?? []) {
    if (node.from == null || node.to == null) continue;

    const directBoard = boardByNode.get(node);
    if (directBoard) {
      blocks.push({
        kind: "board",
        html: directBoard.html,
        estHeight: estimateBoardHeightPx(clampedBoardSize, directBoard.meta),
      });
      continue;
    }

    const nestedBoardNodes = collectNodesOfType(node, "FencedCode").filter(
      (n) => boardByNode.has(n),
    );
    if (nestedBoardNodes.length === 0) {
      blocks.push({
        kind: "text",
        markdownSrc: text.slice(node.from, node.to),
        estHeight: estimateTextHeightPx(
          node.type,
          renderToText(node),
          colWidthPx,
        ),
      });
      continue;
    }

    // A fen/pgn/puzzle fence nested inside this top-level node (e.g. a
    // blockquote) — splice its board HTML into just this node's own source
    // range (same back-to-front splice technique as a plain fence
    // replacement, scoped) and treat the whole node as one text unit; it
    // still gets a static board, just not this module's atomic
    // never-split-across-a-column placement (only the CSS break-inside
    // fallback), since column-fill is per top-level node.
    const replacements = nestedBoardNodes
      .map((n) => ({
        from: n.from!,
        to: n.to!,
        html: boardByNode.get(n)!.html,
      }))
      .sort((a, b) => b.from - a.from);
    let spliced = text.slice(node.from, node.to);
    for (const r of replacements) {
      spliced =
        spliced.slice(0, r.from - node.from) +
        r.html +
        spliced.slice(r.to - node.from);
    }
    let estHeight = estimateTextHeightPx(
      node.type,
      renderToText(node),
      colWidthPx,
    );
    for (const n of nestedBoardNodes) {
      estHeight += estimateBoardHeightPx(
        clampedBoardSize,
        boardByNode.get(n)!.meta,
      );
    }
    blocks.push({ kind: "text", markdownSrc: spliced, estHeight });
  }

  const placed = paginateUnits(blocks, resolvedColumns, colBudgetPx);

  // Render each block's HTML — boards are already static HTML; consecutive
  // text blocks landing in the same (page, col) slot are batched into one
  // `markdownToHtml` call (joined by a blank line, same as adjacent markdown
  // blocks in the original source) rather than one call per block.
  const renderedHtml: string[] = new Array(placed.length).fill("");
  let i = 0;
  while (i < placed.length) {
    const cur = placed[i];
    if (cur.kind === "board") {
      renderedHtml[i] = cur.html;
      i++;
      continue;
    }
    const srcs: string[] = [cur.markdownSrc];
    let j = i + 1;
    while (j < placed.length) {
      const next = placed[j];
      if (
        next.kind !== "text" ||
        next.page !== cur.page ||
        next.col !== cur.col
      )
        break;
      srcs.push(next.markdownSrc);
      j++;
    }
    renderedHtml[i] = (await markdown.markdownToHtml(
      srcs.join("\n\n"),
    )) as unknown as string;
    i = j;
  }

  // Assemble `.pdf-page` > `.pdf-col` divs in (page, col) order.
  const pageCols: string[][] = [];
  for (let idx = 0; idx < placed.length; idx++) {
    const p = placed[idx];
    if (!pageCols[p.page]) {
      pageCols[p.page] = resolvedColumns === 1 ? [""] : ["", ""];
    }
    pageCols[p.page][p.col] += renderedHtml[idx];
  }

  let bodyHtml = "";
  for (const cols of pageCols) {
    if (!cols) continue;
    bodyHtml += `<div class="pdf-page">`;
    for (const colHtml of cols) {
      bodyHtml += `<div class="pdf-col">${colHtml}</div>`;
    }
    bodyHtml += `</div>`;
  }

  return `<style>${await getChessCss()}${buildPdfExtraCss(clampedBoardSize)}</style>${bodyHtml}`;
}
