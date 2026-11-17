-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Bingo (docs/phase-6/README.md §53). Hand-written; any change needs a second
-- reviewer. Guarded by tests/integration/bingo.test.ts.
--
-- Review decisions:
--  1. Exactly 18 items, positions 1…18, seeded with placeholders the team renames in Admin › Bingo
--     (rows are never inserted or deleted by the app, only their text changes).
--  2. A card is 9 distinct positions in 1…18; a call and a win's line only name positions in 1…18.
--  3. A win's line is 3 distinct positions; places start at 1 and are unique per day (the
--     BingoRound row is updated first in the same transaction, so they are given out in order).
-- ─────────────────────────────────────────────────────────────────────────────

-- true when every element is a position 1…18, none repeats and there are exactly n of them
CREATE FUNCTION bingo_positions_ok(cells INTEGER[], n INTEGER) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT cardinality(cells) = n
     AND array_position(cells, NULL) IS NULL
     AND (SELECT count(DISTINCT c) = n AND min(c) >= 1 AND max(c) <= 18 FROM unnest(cells) AS c)
$$;

ALTER TABLE "BingoItem" ADD CONSTRAINT bingo_item_position CHECK (position BETWEEN 1 AND 18);
ALTER TABLE "BingoItem" ADD CONSTRAINT bingo_item_text
  CHECK (char_length(text) BETWEEN 1 AND 80 AND text = btrim(text));

ALTER TABLE "BingoRound" ADD CONSTRAINT bingo_round_winners CHECK (winners >= 0);

ALTER TABLE "BingoCard" ADD CONSTRAINT bingo_card_cells
  CHECK (cells IS NOT NULL AND bingo_positions_ok(cells, 9));

ALTER TABLE "BingoCall" ADD CONSTRAINT bingo_call_position CHECK (position BETWEEN 1 AND 18);

ALTER TABLE "BingoWin" ADD CONSTRAINT bingo_win_place CHECK (place >= 1);
ALTER TABLE "BingoWin" ADD CONSTRAINT bingo_win_line
  CHECK (line IS NOT NULL AND bingo_positions_ok(line, 3));

INSERT INTO "BingoItem" (position, text, "updatedAt")
SELECT n, 'Item ' || n || ' (a definir)', now() FROM generate_series(1, 18) AS n;
