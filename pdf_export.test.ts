import { describe, expect, test, vi } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";

// `markdownToHtml` is mocked (rather than exercising the real renderer) since
// this module's own job is the fen/pgn/puzzle splice + pagination — not
// markdown-to-HTML correctness, which `client/markdown_renderer` already has
// its own tests for. `parseMarkdown` uses the real parser: the pagination
// walk needs a real `ParseTree` shape (top-level block nodes with correct
// `from`/`to`, `FencedCode`/`CodeInfo`/`CodeText`) to find and place anything.
const markdownToHtmlMock = vi.fn(
  async (text: string) => `<HTML>${text}</HTML>`,
);
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  markdown: {
    parseMarkdown: (text: string) => parseMarkdown(text),
    markdownToHtml: (text: string) => markdownToHtmlMock(text),
  },
}));

// pdf_export.ts now reaches board_renderer.ts (chess-core) and
// chess-engine's buildMoveList via its own local external_syscalls.ts
// wrapper (a syscall, not a direct import — see that file's module comment)
// — mock that boundary with the real implementations. board_renderer.ts
// itself goes through chess-core's OWN external_syscalls.ts for
// piece-set/board-theme data, mocked separately below.
vi.mock("./external_syscalls.ts", async () => {
  const boardRenderer = await import("../chess/board_renderer.ts");
  const gameReviewer = await import("../chess-engine/game_reviewer.ts");
  return {
    getChessCss: () => Promise.resolve(boardRenderer.getChessCss()),
    renderStaticBoardHtml: (
      fen: string,
      opts?: Parameters<typeof boardRenderer.renderStaticBoardHtml>[1],
    ) => boardRenderer.renderStaticBoardHtml(fen, opts),
    buildMoveList: (pgn: string) =>
      Promise.resolve(gameReviewer.buildMoveList(pgn)),
  };
});

vi.mock("../chess/external_syscalls.ts", async () => {
  const boardThemes = await import("../chess-themes/board_themes.ts");
  const pieceSets = await import("../chess-themes/piece_sets.ts");
  return {
    getPieceSet: (name?: string) =>
      Promise.resolve(pieceSets.getPieceSet(name)),
    getAllPieceSets: () => Promise.resolve(pieceSets.getAllPieceSets()),
    getBoardTheme: (id?: string) =>
      Promise.resolve(boardThemes.getBoardTheme(id)),
    getAllBoardThemes: () => Promise.resolve(boardThemes.getAllBoardThemes()),
    generateBoardThemeCss: (theme: unknown) =>
      Promise.resolve(
        boardThemes.generateBoardThemeCss(
          theme as Parameters<typeof boardThemes.generateBoardThemeCss>[0],
        ),
      ),
  };
});

const { renderPageForPdf } = await import("./pdf_export.ts");

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** All markdown->HTML calls made for this render, in order, concatenated — a
 * looser substitute for asserting a single call's exact argument, since a
 * page's top-level blocks can now be batched into more than one call. */
function allMarkdownInputs() {
  return markdownToHtmlMock.mock.calls
    .map((c) => c[0] as string)
    .join("\n---\n");
}

describe("renderPageForPdf", () => {
  test("replaces a fen block with a static board, leaving surrounding text alone", async () => {
    const page = [
      "# My game",
      "",
      "Some notes here.",
      "",
      "```fen",
      START_FEN,
      "```",
      "",
      "More notes.",
    ].join("\n");

    const html = await renderPageForPdf(page);

    expect(allMarkdownInputs()).toContain("# My game");
    expect(allMarkdownInputs()).toContain("Some notes here.");
    expect(allMarkdownInputs()).toContain("More notes.");
    expect(allMarkdownInputs()).not.toContain("```fen");
    expect(html).toContain("chessnote-static-board");
    expect(html).toContain("chess-sq");
    expect(html).not.toContain(START_FEN);
    expect(html).not.toContain('class="fen-footer"');
  });

  test("replaces a pgn block with the starting position and full movetext", async () => {
    const pgn = [
      '[White "Alice"]',
      '[Black "Bob"]',
      '[Result "1-0"]',
      "",
      "1. e4 e5 2. Nf3 Nc6 1-0",
    ].join("\n");
    const page = "```pgn\n" + pgn + "\n```";

    const html = await renderPageForPdf(page);

    expect(html).toContain("chess-pgn-movetext");
    expect(html).toContain("Alice vs Bob (1-0)");
    expect(html).toContain("1. e4");
    expect(html).toContain("2. Nf3");
    expect(html).not.toContain(START_FEN);
    expect(html).not.toContain('class="fen-footer"');
  });

  describe("[DisplayMove] tag on a pgn block", () => {
    const pieceCount = (html: string) =>
      (html.match(/class="chess-piece"/g) || []).length;

    // 1. e4 d5 (32 pieces, no capture yet) 2. exd5 (White captures — 31)
    // Qxd5 (Black recaptures — 30). Piece count after each ply is distinct,
    // so it doubles as a cheap proxy for "which position is this?" without
    // asserting on a brittle full FEN/board-HTML string.
    const pgnWithCaptures = (displayMove?: string) =>
      [
        '[White "Alice"]',
        '[Black "Bob"]',
        '[Result "*"]',
        ...(displayMove ? [`[DisplayMove "${displayMove}"]`] : []),
        "",
        "1. e4 d5 2. exd5 Qxd5 *",
      ].join("\n");

    test("with no tag, still shows the starting position (32 pieces)", async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures() + "\n```",
      );
      expect(pieceCount(html)).toBe(32);
      expect(html).not.toContain("sau nước");
    });

    test('"2" (and "2w") show the position after White\'s move 2', async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("2") + "\n```",
      );
      expect(pieceCount(html)).toBe(31);
      expect(html).toContain("Alice vs Bob (*) — sau nước 2");

      const htmlW = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("2w") + "\n```",
      );
      expect(pieceCount(htmlW)).toBe(31);
    });

    test('"2b" shows the position after Black\'s move 2', async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("2b") + "\n```",
      );
      expect(pieceCount(html)).toBe(30);
      expect(html).toContain("sau nước đen 2");
    });

    test('"last" shows the game\'s final move', async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("last") + "\n```",
      );
      expect(pieceCount(html)).toBe(30);
      expect(html).toContain("sau nước đen 2");
    });

    test("a move number past the game's end falls back to the last actual move", async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("20") + "\n```",
      );
      expect(pieceCount(html)).toBe(30);
      expect(html).toContain("sau nước đen 2");
    });

    test("a nonsense value falls back to the starting position", async () => {
      const html = await renderPageForPdf(
        "```pgn\n" + pgnWithCaptures("abc") + "\n```",
      );
      expect(pieceCount(html)).toBe(32);
      expect(html).not.toContain("sau nước");
    });
  });

  test("replaces a puzzle block with a board and its hint", async () => {
    const page = [
      "```puzzle",
      "fen: 4k3/8/8/8/8/8/8/4K2R w - - 0 1",
      "hint: đẩy tốt lên phong cấp",
      "solution: Rh8",
      "```",
    ].join("\n");

    const html = await renderPageForPdf(page);

    expect(html).toContain("puzzle-hint-box");
    expect(html).toContain("đẩy tốt lên phong cấp");
    expect(html).not.toContain("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
    expect(html).not.toContain('class="fen-footer"');
  });

  test("an invalid fen block renders an error banner instead of breaking the export", async () => {
    const page = "```fen\nnot a fen\n```";
    const html = await renderPageForPdf(page);
    expect(html).toContain("chess-error-banner");
  });

  test("leaves plain markdown with no board blocks untouched aside from markdownToHtml", async () => {
    const page = "# Just text\n\nNo boards here.";
    await renderPageForPdf(page);
    expect(allMarkdownInputs()).toContain("Just text");
    expect(allMarkdownInputs()).toContain("No boards here.");
  });

  test("splices multiple board blocks without corrupting offsets", async () => {
    const page = [
      "```fen",
      START_FEN,
      "```",
      "",
      "Middle text",
      "",
      "```fen",
      "8/8/8/8/8/8/8/4K2k w - - 0 1",
      "```",
    ].join("\n");

    const html = await renderPageForPdf(page);

    expect(allMarkdownInputs()).toContain("Middle text");
    // Count actual board *elements*, not the class name — the embedded
    // <style> block also references ".chessnote-static-board" in several
    // selectors, so a bare substring match over-counts.
    expect(
      (html.match(/<div class="chessnote-static-board">/g) || []).length,
    ).toBe(2);
  });

  test("a code fence in an unrelated language is left as-is", async () => {
    const page = "```js\nconsole.log('hi')\n```";
    const html = await renderPageForPdf(page);
    expect(html).toContain("console.log");
  });

  test("wraps the output in a <style> tag carrying the chess board CSS", async () => {
    const html = await renderPageForPdf("# No boards");
    expect(html).toMatch(/^<style>/);
    expect(html).toContain("chess-sq");
    expect(html).toContain("chessnote-static-board");
  });

  test("defaults the board size to 400px when no size is given", async () => {
    const html = await renderPageForPdf("# No boards");
    expect(html).toContain("max-width: 400px");
    expect(html).toContain("aspect-ratio: 1 / 1");
  });

  test("uses a custom board size when given", async () => {
    const html = await renderPageForPdf("# No boards", 250);
    expect(html).toContain("max-width: 250px");
    expect(html).not.toContain("max-width: 400px");
  });

  test("clamps a board size below the minimum", async () => {
    const html = await renderPageForPdf("# No boards", 10);
    expect(html).toContain("max-width: 150px");
  });

  test("clamps a board size above the maximum", async () => {
    const html = await renderPageForPdf("# No boards", 5000);
    expect(html).toContain("max-width: 700px");
  });

  describe("pagination (replaces CSS column-count — see pdf_pagination.ts)", () => {
    test("no CSS column-count/column-fill is emitted anymore", async () => {
      const html = await renderPageForPdf("# No boards");
      expect(html).not.toContain("column-count");
      expect(html).not.toContain("column-fill");
    });

    test("output is wrapped in .pdf-page > .pdf-col divs", async () => {
      const html = await renderPageForPdf("# No boards");
      expect(html).toContain('class="pdf-page"');
      expect(html).toContain('class="pdf-col"');
    });

    test("columns=1 emits exactly one .pdf-col per .pdf-page", async () => {
      const html = await renderPageForPdf("# No boards", undefined, 1);
      const pageCount = (html.match(/class="pdf-page"/g) || []).length;
      const colCount = (html.match(/class="pdf-col"/g) || []).length;
      expect(pageCount).toBeGreaterThan(0);
      expect(colCount).toBe(pageCount);
    });

    test("the default (2 columns) emits exactly two .pdf-col per .pdf-page", async () => {
      const html = await renderPageForPdf("# No boards");
      const pageCount = (html.match(/class="pdf-page"/g) || []).length;
      const colCount = (html.match(/class="pdf-col"/g) || []).length;
      expect(pageCount).toBeGreaterThan(0);
      expect(colCount).toBe(pageCount * 2);
    });

    test("many boards spill across multiple pages/columns without losing or duplicating any", async () => {
      // Default boardSize (400) is comfortably taller than half a page's
      // budget, so this reliably forces at least a 2nd column/page.
      const boards = Array.from(
        { length: 6 },
        (_, i) => `\`\`\`fen\n${START_FEN}\n\`\`\`${i < 5 ? "\n\n" : ""}`,
      ).join("");
      const html = await renderPageForPdf(boards);
      expect(
        (html.match(/<div class="chessnote-static-board">/g) || []).length,
      ).toBe(6);
      const pageCount = (html.match(/class="pdf-page"/g) || []).length;
      expect(pageCount).toBeGreaterThan(1);
    });
  });

  describe("CSS regressions (fixes for cut-across-pages and non-square boards)", () => {
    test(".chess-board keeps its own aspect-ratio (makes the whole board square)", async () => {
      const html = await renderPageForPdf("# No boards");
      const rule = html.match(
        /\.chessnote-static-board \.chess-board\s*\{[^}]*\}/,
      );
      expect(rule).not.toBeNull();
      expect(rule![0]).toContain("aspect-ratio: 1 / 1");
    });

    test(".chess-sq no longer has a redundant aspect-ratio/height:auto", async () => {
      const html = await renderPageForPdf("# No boards");
      const rule = html.match(
        /\.chessnote-static-board \.chess-sq\s*\{[^}]*\}/,
      );
      expect(rule).not.toBeNull();
      expect(rule![0]).not.toContain("aspect-ratio");
      expect(rule![0]).not.toContain("height: auto");
    });
  });
});
