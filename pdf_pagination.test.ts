import { describe, expect, test } from "vitest";
import {
  type BoardMeta,
  computeColumnGeometry,
  estimateBoardHeightPx,
  estimateTextHeightPx,
  paginateUnits,
} from "./pdf_pagination.ts";

const baseMeta: BoardMeta = {
  hasTitle: false,
  titleLength: 0,
  movetextLength: 0,
  hintLength: 0,
  isError: false,
};

describe("computeColumnGeometry", () => {
  test("2 columns splits the usable width in half (minus the gap)", () => {
    const { colWidthPx, colBudgetPx } = computeColumnGeometry(2);
    expect(colWidthPx).toBe(334);
    expect(colBudgetPx).toBeGreaterThan(0);
  });

  test("1 column uses the full usable width", () => {
    const { colWidthPx } = computeColumnGeometry(1);
    expect(colWidthPx).toBe(693);
  });

  test("both column counts share the same per-page height budget", () => {
    expect(computeColumnGeometry(1).colBudgetPx).toBe(
      computeColumnGeometry(2).colBudgetPx,
    );
  });
});

describe("estimateBoardHeightPx", () => {
  test("a plain board (no title/movetext/hint) is close to boardSize", () => {
    const h = estimateBoardHeightPx(400, baseMeta);
    expect(h).toBeGreaterThan(400);
    expect(h).toBeLessThan(450);
  });

  test("an error banner is small regardless of boardSize", () => {
    const h = estimateBoardHeightPx(700, { ...baseMeta, isError: true });
    expect(h).toBeLessThan(100);
  });

  test("a title adds height", () => {
    const withTitle = estimateBoardHeightPx(400, {
      ...baseMeta,
      hasTitle: true,
      titleLength: 10,
    });
    expect(withTitle).toBeGreaterThan(estimateBoardHeightPx(400, baseMeta));
  });

  test("longer movetext adds more height", () => {
    const short = estimateBoardHeightPx(400, {
      ...baseMeta,
      movetextLength: 20,
    });
    const long = estimateBoardHeightPx(400, {
      ...baseMeta,
      movetextLength: 2000,
    });
    expect(long).toBeGreaterThan(short);
  });

  test("a hint adds height", () => {
    const withHint = estimateBoardHeightPx(400, {
      ...baseMeta,
      hintLength: 30,
    });
    expect(withHint).toBeGreaterThan(estimateBoardHeightPx(400, baseMeta));
  });
});

describe("estimateTextHeightPx", () => {
  test("empty (or whitespace-only) text has zero height", () => {
    expect(estimateTextHeightPx("Paragraph", "", 334)).toBe(0);
    expect(estimateTextHeightPx("Paragraph", "   \n  ", 334)).toBe(0);
  });

  test("longer text is taller", () => {
    const short = estimateTextHeightPx("Paragraph", "Hello world", 334);
    const long = estimateTextHeightPx(
      "Paragraph",
      "Hello world ".repeat(50),
      334,
    );
    expect(long).toBeGreaterThan(short);
  });

  test("a heading uses a taller line-height than a paragraph for the same text", () => {
    const heading = estimateTextHeightPx("ATXHeading1", "Short title", 334);
    const paragraph = estimateTextHeightPx("Paragraph", "Short title", 334);
    expect(heading).toBeGreaterThan(paragraph);
  });

  test("an unmapped node type falls back to the default line height without crashing", () => {
    expect(() =>
      estimateTextHeightPx("SomeUnknownNodeType", "text", 334),
    ).not.toThrow();
    expect(
      estimateTextHeightPx("SomeUnknownNodeType", "text", 334),
    ).toBeGreaterThan(0);
  });
});

describe("paginateUnits", () => {
  test("several small units all fit in column 1 of page 1", () => {
    const units = [{ estHeight: 100 }, { estHeight: 100 }, { estHeight: 100 }];
    const placed = paginateUnits(units, 2, 1000);
    expect(placed.every((u) => u.page === 0 && u.col === 0)).toBe(true);
  });

  test("overflowing a column moves the next unit to column 2 of the same page", () => {
    const units = [{ estHeight: 600 }, { estHeight: 600 }];
    const placed = paginateUnits(units, 2, 1000);
    expect(placed[0]).toMatchObject({ page: 0, col: 0 });
    expect(placed[1]).toMatchObject({ page: 0, col: 1 });
  });

  test("overflowing both columns of a page moves to page 2, column 1", () => {
    const units = [{ estHeight: 600 }, { estHeight: 600 }, { estHeight: 600 }];
    const placed = paginateUnits(units, 2, 1000);
    expect(placed[0]).toMatchObject({ page: 0, col: 0 });
    expect(placed[1]).toMatchObject({ page: 0, col: 1 });
    expect(placed[2]).toMatchObject({ page: 1, col: 0 });
  });

  test("columns=1 never places anything in column 2 — every overflow starts a new page", () => {
    const units = Array.from({ length: 5 }, () => ({ estHeight: 600 }));
    const placed = paginateUnits(units, 1, 1000);
    expect(placed.every((u) => u.col === 0)).toBe(true);
    expect(placed.map((u) => u.page)).toEqual([0, 1, 2, 3, 4]);
  });

  test("a single oversized unit is still placed — alone, never dropped, never causes an infinite loop", () => {
    const units = [{ estHeight: 100 }, { estHeight: 5000 }, { estHeight: 100 }];
    const placed = paginateUnits(units, 2, 1000);
    expect(placed).toHaveLength(3);
    const oversized = placed[1];
    const sharingItsSlot = placed.filter(
      (u, idx) =>
        idx !== 1 && u.page === oversized.page && u.col === oversized.col,
    );
    expect(sharingItsSlot).toHaveLength(0);
  });

  test("(page, col) never moves backwards relative to input order", () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      estHeight: 150 + i * 37,
    }));
    const placed = paginateUnits(units, 2, 1000);
    const rank = (u: { page: number; col: number }) => u.page * 2 + u.col;
    for (let i = 1; i < placed.length; i++) {
      expect(rank(placed[i])).toBeGreaterThanOrEqual(rank(placed[i - 1]));
    }
  });
});
