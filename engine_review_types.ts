// Local mirror of plugs/chess-engine/game_reviewer.ts's MoveListEntry shape.
// Duplicated (not imported cross-plug) so chess-pdf-export builds standalone
// once split into its own repo — buildMoveList() itself is still called
// through ../chess-engine/plug_api.ts's syscall wrapper at runtime, only the
// TYPE shape is copied here. Keep in sync by hand if that shape changes.

export interface MoveListEntry {
  moveNum: number;
  isWhite: boolean;
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}
