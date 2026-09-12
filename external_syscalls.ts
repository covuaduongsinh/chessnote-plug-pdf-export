// Local mirror of the thin plug_api.ts wrappers chess-pdf-export calls into
// on chess-core (chess.*) and chess-engine (chess.engine.buildMoveList) —
// duplicated here (rather than importing ../chess/plug_api.ts,
// ../chess-engine/plug_api.ts directly) so chess-pdf-export builds
// standalone once split into its own repo: the syscall names below are just
// strings, resolved at runtime against whichever installed plug backs them.
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import type { MoveListEntry } from "./engine_review_types.ts";

export function renderStaticBoardHtml(
  fen: string,
  opts: {
    orientation?: "white" | "black";
    title?: string;
    showFen?: boolean;
    pieceSet?: string;
    boardTheme?: string;
  } = {},
): Promise<string> {
  return syscall("chess.renderStaticBoardHtml", fen, opts);
}

export function getChessCss(): Promise<string> {
  return syscall("chess.getCss");
}

export function buildMoveList(pgn: string): Promise<MoveListEntry[]> {
  return syscall("chess.engine.buildMoveList", pgn);
}
