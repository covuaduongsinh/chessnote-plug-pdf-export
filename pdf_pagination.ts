/**
 * Server-side pre-pagination for PDF export.
 *
 * Chrome's `Page.printToPDF` doesn't reliably honor `break-inside: avoid`
 * when the avoided element sits inside a CSS multi-column layout
 * (`column-count`) that is itself being fragmented into physical pages — two
 * nested fragmentation contexts (column, then page), a known Blink
 * limitation. Instead of relying on the browser to lay out N pages worth of
 * multi-column content and hoping break-avoidance survives, this module
 * decides page/column placement *before* the HTML ever reaches Chrome: each
 * logical page becomes a plain flex row of column `<div>`s (see
 * `pdf_export.ts`'s `.pdf-page`/`.pdf-col`), so `break-inside: avoid` only
 * ever has to work within a single (page-only) fragmentation context — the
 * case Chromium supports well — kept as a defensive fallback rather than the
 * primary correctness mechanism.
 *
 * Pure and dependency-free (no `ParseTree`, no syscalls) so the bin-packing
 * algorithm and the height estimates can be unit-tested in isolation from
 * markdown parsing/rendering.
 */

/** A4 print geometry used by `server-runtime-chrome/src/pool.rs`'s `render_html_to_pdf`. */
const CSS_PX_PER_IN = 96;
const PAPER_W_IN = 8.27;
const PAPER_H_IN = 11.69;
const MARGIN_L_IN = 0.4;
const MARGIN_R_IN = 0.4;
const MARGIN_T_IN = 0.4;
const MARGIN_B_IN = 0.6;
/** `body{padding:0 12px}` in Export.md's outer HTML shell. */
const BODY_PADDING_PX = 24;
/** Matches `.pdf-page`'s flex `gap` in `buildPdfExtraCss`. */
const COLUMN_GAP_PX = 24;
/** Slack for footer-template bleed and estimate error, kept out of the usable budget. */
const SAFETY_MARGIN_PX = 40;

const CONTENT_WIDTH_PX = Math.floor(
  (PAPER_W_IN - MARGIN_L_IN - MARGIN_R_IN) * CSS_PX_PER_IN - BODY_PADDING_PX,
);
const CONTENT_HEIGHT_PX = Math.floor(
  (PAPER_H_IN - MARGIN_T_IN - MARGIN_B_IN) * CSS_PX_PER_IN,
);
const USABLE_PAGE_HEIGHT_PX = CONTENT_HEIGHT_PX - SAFETY_MARGIN_PX;

export interface ColumnGeometry {
  /** Available width (px) for a single column's content, at the given column count. */
  colWidthPx: number;
  /** Estimated-height budget (px) for a single column of a single physical page. */
  colBudgetPx: number;
}

export function computeColumnGeometry(columns: 1 | 2): ColumnGeometry {
  const colWidthPx =
    columns === 1
      ? CONTENT_WIDTH_PX
      : Math.floor((CONTENT_WIDTH_PX - COLUMN_GAP_PX) / 2);
  return { colWidthPx, colBudgetPx: USABLE_PAGE_HEIGHT_PX };
}

export interface BoardMeta {
  hasTitle: boolean;
  titleLength: number;
  movetextLength: number;
  hintLength: number;
  /** True when the fence body was invalid and rendered as a small error banner instead of a board. */
  isError: boolean;
}

const BOARD_MARGIN_PX = 26; // .chessnote-static-board margin: 10px auto 16px
const TITLE_LINE_H_PX = 22; // .chess-title font-size 14 + margin-bottom 6
const TITLE_CHAR_W_PX = 7.5; // rough glyph width at 14px bold
const MOVETEXT_LINE_H_PX = 16.5; // 11px * line-height 1.5
const MOVETEXT_MARGIN_PX = 18; // margin: 4px 0 14px
const MOVETEXT_CHAR_W_PX = 6.2; // ui-monospace @ 11px
const HINT_H_PX = 30; // puzzle-hint-box padding + ~1 line + margin-top
const ERROR_BANNER_H_PX = 40;

/** Deterministic height estimate for a rendered board unit (board + optional title/movetext/hint). */
export function estimateBoardHeightPx(
  boardSize: number,
  meta: BoardMeta,
): number {
  if (meta.isError) return ERROR_BANNER_H_PX;

  let h = boardSize + BOARD_MARGIN_PX;
  if (meta.hasTitle) {
    const titleLines = meta.titleLength * TITLE_CHAR_W_PX > boardSize ? 2 : 1;
    h += TITLE_LINE_H_PX * titleLines;
  }
  if (meta.movetextLength > 0) {
    const charsPerLine = Math.max(
      10,
      Math.floor(boardSize / MOVETEXT_CHAR_W_PX),
    );
    const lines = Math.max(1, Math.ceil(meta.movetextLength / charsPerLine));
    h += lines * MOVETEXT_LINE_H_PX + MOVETEXT_MARGIN_PX;
  }
  if (meta.hintLength > 0) h += HINT_H_PX;
  return h;
}

const AVG_CHAR_WIDTH_PX = 7.2; // ~0.48em at 15px sans body text
const BLOCK_SPACING_PX = 10; // approx margin between consecutive top-level blocks

const LINE_HEIGHT_PX: Record<string, number> = {
  ATXHeading1: 40,
  ATXHeading2: 34,
  ATXHeading3: 28,
  ATXHeading4: 24,
  ATXHeading5: 22,
  ATXHeading6: 20,
  SetextHeading1: 40,
  SetextHeading2: 34,
  Paragraph: 22,
  BulletList: 20,
  OrderedList: 20,
  Blockquote: 22,
  Table: 24,
  default: 20,
};

/** Approximate height for a plain markdown block (not a fen/pgn/puzzle fence) from its rendered text length. */
export function estimateTextHeightPx(
  nodeType: string | undefined,
  text: string,
  colWidthPx: number,
): number {
  const len = text.trim().length;
  if (len === 0) return 0;
  const charsPerLine = Math.max(10, Math.floor(colWidthPx / AVG_CHAR_WIDTH_PX));
  const lines = Math.max(1, Math.ceil(len / charsPerLine));
  const lineH = LINE_HEIGHT_PX[nodeType ?? ""] ?? LINE_HEIGHT_PX.default;
  return lines * lineH + BLOCK_SPACING_PX;
}

export interface Placement {
  page: number;
  col: number;
}

/**
 * Greedily fills column 0 of page 0 to `colBudgetPx`, then column 1 of the
 * same page (if `columns === 2`), then moves to page 1's column 0, etc. —
 * i.e. per-*page* column pairs, not one giant column spanning every page
 * followed by another — so reading order across many physical pages stays
 * "page 1's left+right, then page 2's left+right", matching a real printed
 * 2-column document.
 *
 * A unit whose own estimate exceeds `colBudgetPx` is never split: it's
 * placed alone (after moving to a fresh column if the current one already
 * has content), and the next unit always starts a fresh column too.
 */
export function paginateUnits<T extends { estHeight: number }>(
  units: T[],
  columns: 1 | 2,
  colBudgetPx: number,
): (T & Placement)[] {
  const result: (T & Placement)[] = [];
  let page = 0;
  let col = 0;
  let used = 0;

  function advanceColumn() {
    if (columns === 2 && col === 0) {
      col = 1;
    } else {
      col = 0;
      page += 1;
    }
    used = 0;
  }

  for (const u of units) {
    if (u.estHeight > colBudgetPx) {
      if (used > 0) advanceColumn();
      result.push({ ...u, page, col });
      advanceColumn();
      continue;
    }
    if (used > 0 && used + u.estHeight > colBudgetPx) {
      advanceColumn();
    }
    result.push({ ...u, page, col });
    used += u.estHeight;
  }
  return result;
}
