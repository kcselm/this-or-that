# Bracket Game Mode — Design

**Date:** 2026-05-20
**Status:** Approved (design phase)

## Summary

Add a third game mode to This or That, called **Bracket**, alongside Swipe Vote and Blind Rank. The host picks a topic and adds 4–16 items. The server seeds a single-elimination bracket by shuffling the items; every round plays as many matchups as possible and sits out at most one item ("rolling byes", see Bracket seeding). Each round, all participants vote head-to-head on every matchup in that round; majority wins, ties resolve by server-side coin flip. When the round closes, every player sees the updated bracket tree on a "round reveal" screen and individually taps Continue to start the next round of voting. After the final, the reveal screen shows the full bracket tree with the winner, per-matchup vote breakdowns, and "split decision" labels on any tiebroken matchups.

## Goals

- Ship a third game mode that reuses the existing room lifecycle (create → add items → start → play → reveal).
- Follow the per-mode dispatch pattern established by Blind Rank (mode field on rooms, mode-specific tables/routes/screens).
- Build a tournament with real drama: hidden future matchups, between-round reveals, narrative-shaped output.
- Keep Swipe Vote and Blind Rank behaviorally unchanged.

## Non-goals

- Seeding. Pairings are fully random — there is no "#1 seed."
- Double-elimination, losers brackets, or repechage rounds.
- Host force-advance / skip-stragglers. (Same gating as Blind Rank: round closes when all current participants finish all matchups in it. Revisit if stalling becomes a real problem.)
- More than 16 items.
- Showing the bracket during play. Voters see only the current matchup. The bracket appears only on round-reveal and final-reveal screens.
- Live "spectator" view of in-progress matchup vote counts.
- A general-purpose tournament engine. Add the concrete mode; refactor later if a fourth mode needs a shared abstraction.

## User flow

### Creator
1. Home → tap **Create a Room**.
2. **Mode picker screen** — third card added: "Bracket." Tap it.
3. **Topic + name screen** — existing. In bracket mode the "allow suggestions" toggle is hidden (the item pool is fixed).
4. **Add items screen** — existing screen. Bracket mode allows 4–16 items. Start button enabled at 4+; input disabled at 16.
5. **Share screen** — existing. Start button enabled once ≥4 items exist.
6. Tap **Start** — server validates 4 ≤ item count ≤ 16, shuffles items, creates Round 1 matchups (real + bye), transitions room to `voting`.
7. **Bracket play screen** — creator votes on each Round 1 matchup like everyone else.
8. **Waiting screen** — existing; "X of N done with this round."
9. **Round reveal screen** — bracket-so-far rendered, just-completed round highlighted. Tap "Continue" to start voting on the next round.
10. Repeat (play → waiting → reveal) until the final.
11. **Final reveal screen** — full bracket tree with winner highlighted. Tap a matchup to see vote breakdown.

### Participant
1. Home → **Join a Room** → enter code → enter name (all existing).
2. **Lobby** — existing "waiting for host to start." In bracket mode, items are never shown here.
3. **Bracket play screen** → same as creator from step 7 onward.

### Routing dispatch
`app/room/[code]/_layout.tsx` already dispatches by mode for Swipe vs. Rank. Extend it to also route Bracket rooms to the new `bracket.tsx` screen. Round-reveal navigation happens from inside the bracket screen flow (not via the dispatch layout).

## Screens

### Mode picker (updated)

Third card added below the existing two:
- **Bracket** — "Items face off in a tournament. Each round, everyone votes on the matchups. See the bracket grow after each round."

Layout stays vertical (single column of three cards). If a fourth mode ever lands, revisit as a 2×2 grid.

### Bracket play screen (new)

Layout (top to bottom):
- **Header**: room topic + round/matchup progress ("Round 1 — Matchup 2 of 4").
- **Two cards side-by-side**, separated by a "vs" label, filling the upper two-thirds of the screen. Each card shows one item's title, large and centered.
- **Subtle hint** below the cards on the first matchup of the first round: "Tap to pick a winner." Fades after first tap.

Interaction:
- Tap a card → it bumps up / scales briefly to confirm the pick, server vote submitted, next matchup card pair fades in.
- Tap is the only interaction. No swipe, no drag. Matches "fast tap through a tournament" pacing.
- The card the voter picked stays selected visually for ~300ms before the next pair animates in. Provides a moment of feedback.
- After the last matchup of the round is voted on, the screen navigates to the waiting screen.

Resume after close:
- Reopening mid-round: the play screen fetches the bracket state, finds the current round, skips matchups the voter already voted on (via `myVotes`), and shows the next unvoted matchup.
- If the voter has voted on all current-round matchups but the round hasn't yet closed (others are still voting), the play screen routes directly to the waiting screen.

Cross-platform:
- Tap-only interaction works trivially on iOS, Android, and Expo web. No gesture-handler gymnastics needed.

### Waiting screen (existing, minor update)

Same screen as Swipe and Blind Rank. The in-progress status label needs a bracket-specific string: "Voting..." (or "Round N..." for clarity). Reads `mode` from the room and switches the label.

The waiting screen polls `/status` and transitions to the round-reveal screen when the current round closes (server has decided all matchups for it). Transition trigger: a new field on the status response — `currentRound` (number) and `roundClosed` (boolean) or equivalent — see API section.

### Round reveal screen (new)

- **Header**: "Round N complete."
- **Bracket-so-far** rendered vertically (mobile-friendly): one row per round, oldest round at top. Each row is a horizontal list of matchups for that round, showing the two items with the winner styled prominently and the loser greyed/struck-through. Tiebroken matchups labeled "split decision."
- **Coming up** section below: the next round's pairings preview (titles only, no voting yet).
- **Continue button** at the bottom: tapping advances *this player only* to the next round of voting. Other players advance when they tap on their own device.

This screen is reachable only from the waiting screen after a round closes — there's no way to navigate back to it once you've tapped Continue (it's a transient reveal).

### Final reveal screen (new)

- **Header**: "Winner: {item title}" with a small celebratory accent (matches existing reveal aesthetic).
- **Full bracket tree** rendered the same way as round reveal: vertical list of rounds with matchups. Final round's winner card is highlighted.
- **Per-matchup vote breakdown**: each matchup card is tappable; tapping expands it inline to show `picked_item_id` per voter (e.g., "Alice → A, Bob → A, Carol → B"). Mirrors the existing vote-mode reveal pattern.
- **Tiebreak labels**: matchups decided by the server's coin flip are tagged "split decision (X–X, server picked Y)."
- "You" voter's picks are styled distinctly inside the breakdown for easy self-reference.

## Data model

New migration `apps/api/migrations/0006_bracket_mode.sql`:

```sql
-- The `mode` column already exists (added in 0005). Allowed values become 'vote' | 'rank' | 'bracket'.

CREATE TABLE matchups (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  round INTEGER NOT NULL,                       -- 1-indexed
  slot INTEGER NOT NULL,                        -- 0-indexed position within the round
  item_a_id TEXT REFERENCES items(id),          -- nullable for bye matchups (where item_b is also null)
  item_b_id TEXT REFERENCES items(id),
  winner_item_id TEXT REFERENCES items(id),    -- null until the round closes
  is_bye INTEGER NOT NULL DEFAULT 0,            -- 1 if this matchup is an auto-advance (only one item set)
  decided_by_tiebreak INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, round, slot)
);

CREATE TABLE matchup_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  matchup_id TEXT NOT NULL REFERENCES matchups(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  picked_item_id TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(matchup_id, voter_id)
);

CREATE INDEX idx_matchups_room ON matchups(room_id);
CREATE INDEX idx_matchups_room_round ON matchups(room_id, round);
CREATE INDEX idx_matchup_votes_room ON matchup_votes(room_id);
CREATE INDEX idx_matchup_votes_matchup ON matchup_votes(matchup_id);
CREATE INDEX idx_matchup_votes_room_voter ON matchup_votes(room_id, voter_id);
```

The `votes` and `rankings` tables are untouched. Bracket rooms use `matchups` and `matchup_votes`. Nothing polymorphic.

### Bracket seeding (executed on `/start`)

**Rolling byes** (revised 2026-09-01; the original design front-loaded all byes into Round 1 to reach a power of two, which for 9 items meant one matchup and seven byes). Every round with `n` competitors plays `floor(n/2)` real matchups and, when `n` is odd, one bye matchup (only `item_a_id` set, `is_bye=1`, `winner_item_id=item_a_id`, `decided_at=now`). The bye takes the **last** slot in odd-numbered rounds and the **first** slot in even-numbered rounds, so no item sits out twice in a row and the whole bracket shape follows from the item count alone (the client uses this to draw empty slots for rounds that don't exist yet). `total_rounds` is unchanged: `ceil(log2(N))`.

Algorithm for Round 1 (`apps/api/src/lib/bracket-shape.ts`, mirrored in `apps/mobile/lib/bracket-shape.ts`):
1. Shuffle the items. Call the shuffled list `S` (length N).
2. Pair adjacent items into real matchups: `(S[0], S[1])`, `(S[2], S[3])`, …, at slots `0..floor(N/2)-1`.
3. If `N` is odd, `S[N-1]` gets the bye at slot `floor(N/2)`.

Later rounds apply the same plan to the previous round's winners in slot order, with the bye moved to slot 0 in even-numbered rounds (the pairs then start at slot 1).

The whole insert (presentation order + all R1 matchup rows + status transition to 'voting') runs in a single `db.batch()` for atomicity, mirroring the pattern in `/start` for rank rooms.

### Round advancement (executed after each matchup vote)

After inserting a `matchup_votes` row, the server:

1. Counts votes on the just-voted matchup. If `vote_count >= participant_count`, the matchup is ready to be decided.
2. Checks if **all** matchups in the current round are ready to be decided (excluding byes, which are decided at start).
3. If yes, atomically:
   - For each undecided real matchup in the round, tally votes. Majority pick wins; on exact tie, server picks uniformly at random and sets `decided_by_tiebreak=1`.
   - Sets `winner_item_id` and `decided_at` on each.
   - If this was the final round (`round == total_rounds`), updates the room to `status='revealed'`.
   - Otherwise, creates the next round's matchup rows from the round's winners in slot order using the rolling-bye plan above (adjacent winners pair up; an odd winner count leaves one bye). New real rows have `winner_item_id=null`, `decided_at=null`. A lone winner means the round was the final.

`total_rounds = log2(P)`.

Concurrency: under D1's eventual consistency, two simultaneous vote inserts could both observe "round is now complete." Idempotency via:
- `UNIQUE(room_id, round, slot)` on `matchups` rejects duplicate next-round-row creation.
- Round decision is idempotent: setting `winner_item_id` is a UPDATE that's a no-op if already set. Use `WHERE winner_item_id IS NULL` on the UPDATE to be safe.

### Participant completion

A participant is "complete for the current round" when they have a `matchup_votes` row for every non-bye matchup in that round. Their `/status` line shows "Done" once they're complete; "Voting…" otherwise.

For bracket mode, `/status`'s `completedCount` field counts participants done with the **current** round (not the whole game). The reveal trigger is independent: it fires when the final matchup is decided and the room transitions to `status='revealed'`, regardless of who voted in earlier rounds.

The matchup count shown on the bracket play screen ("Round 1 — Matchup 2 of 4") excludes bye matchups — voters never see or vote on byes. So for a 7-item room, Round 1 shows "Matchup X of 3" (3 real matchups + 1 invisible bye).

## API

### Existing endpoints (small additions)

- **`POST /api/rooms`** — accepts `mode: 'vote' | 'rank' | 'bracket'` (default `'vote'`). For bracket mode, server forces `allow_suggestions = false`.
- **`POST /api/rooms/:code/items`** — for bracket rooms, total item count capped at 16. Participant suggestions disabled (suggestions are off in bracket).
- **`POST /api/rooms/:code/start`** — for bracket rooms, validates `4 <= itemCount <= 16`. On start: runs the seeding algorithm above; creates Round 1 matchup rows; transitions room to `voting`.
- **`GET /api/rooms/:code`** — response includes `mode`. For bracket rooms, items are returned only to the creator pre-start (consistent with rank mode behavior); after `voting` starts, the items array is omitted and clients use `/bracket` to fetch state.
- **`GET /api/rooms/:code/status`** — for bracket rooms, "complete" means the voter has voted on every non-bye matchup in the **current** round. Response shape unchanged (`totalVoters`, `completedCount`, `isRevealed`, `voters`), plus a new optional `currentRound: number` field for bracket rooms that the waiting screen uses to detect round transitions.

### New endpoints (in `apps/api/src/routes/bracket.ts`)

- **`GET /api/rooms/:code/bracket?voterId=X`** — returns the bracket state visible to this voter:

  ```ts
  {
    currentRound: number | null,   // null if room is revealed
    totalRounds: number,           // log2(P)
    rounds: [
      {
        round: number,
        matchups: [
          {
            id: string,
            slot: number,
            itemA: { id, title } | null,
            itemB: { id, title } | null,
            winner: { id, title } | null,
            isBye: boolean,
            decidedByTiebreak: boolean,
            // Vote breakdown ONLY included for decided matchups in past rounds.
            // Current-round matchups never expose vote counts (anti-strategy).
            voteBreakdown?: [
              { voterId, voterName, pickedItemId }
            ],
          }
        ]
      }
    ],
    myVotes: { [matchupId]: pickedItemId },  // all my votes across all rounds
  }
  ```

  Only past-round and current-round matchups are returned. Future rounds (`round > currentRound`) aren't yet created in the DB, so they're naturally absent — there's no way for a curious client to peek at them.

- **`POST /api/rooms/:code/matchup-votes`** — body `{ matchupId, voterId, voterName, pickedItemId }`. Server validates:
  - Room mode is `bracket` and status is `voting`.
  - Matchup exists, belongs to this room, and is in the current round.
  - Matchup is not a bye (byes aren't voted on).
  - `pickedItemId` is one of the matchup's two competitors.
  - UNIQUE catches double-votes from the same voter on the same matchup.

  Response: `{ success: true, progress: { votedThisRound, totalThisRound } }`.

  After insert, runs the round-advancement check (described in Data model § Round advancement).

- **`GET /api/rooms/:code/results`** — for bracket rooms: returns `{ revealed: true, mode: 'bracket', topic, totalRounds, winner: { id, title }, rounds: [...same shape as /bracket but with all vote breakdowns...] }`. If not yet revealed: `{ revealed: false, completedCount, totalVoters }`.

### Mode-mismatch errors

- `POST /api/rooms/:code/votes` on a bracket room → 400 "wrong mode."
- `POST /api/rooms/:code/rankings` on a bracket room → 400 "wrong mode."
- `POST /api/rooms/:code/matchup-votes` on vote/rank rooms → 400 "wrong mode."
- `PATCH /api/rooms/:code/settings` setting `allowSuggestions: true` on a bracket room → 400.

### Why server-enforced "hidden bracket"

Future-round matchups aren't created in the DB until the previous round resolves, so `/bracket` literally cannot return them. A curious player opening devtools sees only past + current rounds. The server is the source of truth for "what comes next," and it doesn't reveal until the round closes.

## Behavior notes

- **Resume after close:** rejoining mid-round calls `/bracket`, repaints any votes already cast (from `myVotes`), and shows the next un-voted current-round matchup. If all current-round matchups already have a vote, routes to waiting.
- **Late joiners:** allowed after `/start` (matches Blind Rank behavior). A late joiner can vote on any open round. Missed prior rounds: skipped — they didn't vote on those matchups, breakdowns will show them as absent. New joiners DO become part of the gating set for the current round (the round won't advance until they've voted too).
- **Ties:** in even-participant rooms, a matchup can split 2–2 / 3–3 / etc. Server picks a winner uniformly at random and sets `decided_by_tiebreak=1`. Final reveal labels it "split decision."
- **Allow_suggestions in bracket mode:** forced off at room creation; PATCH `/settings` rejects attempts to enable it.
- **Item titles never reach the client for un-created future matchups:** since future rounds aren't materialized until the previous round resolves, no client request can return them. The items array on `/api/rooms/:code` is omitted post-start.

## File layout

```
apps/api/
├── migrations/
│   └── 0006_bracket_mode.sql           (new)
├── src/
│   ├── index.ts                         (mount bracket router)
│   ├── routes/
│   │   ├── rooms.ts                     (accept 'bracket' mode; 4–16 item cap; seeding in /start)
│   │   ├── votes.ts                     (reject bracket rooms)
│   │   ├── rankings.ts                  (reject bracket rooms for /rankings)
│   │   ├── bracket.ts                   (new — /bracket, /matchup-votes)
│   │   └── results.ts                   (dispatch on mode; bracket result shape)
│   └── db/
│       └── queries.ts                   (matchup + matchup-vote query helpers)

apps/mobile/
├── app/
│   ├── create/
│   │   ├── mode.tsx                     (add 3rd card: Bracket)
│   │   ├── index.tsx                    (hide suggestions toggle in bracket mode)
│   │   └── share.tsx                    (Start enabled at 4+ items in bracket; cap at 16)
│   └── room/[code]/
│       ├── _layout.tsx                  (dispatch bracket → bracket.tsx)
│       ├── lobby.tsx                    (existing; works for bracket)
│       ├── swipe.tsx                    (existing, untouched)
│       ├── rank.tsx                     (existing, untouched)
│       ├── bracket.tsx                  (new — matchup voting screen)
│       ├── round-reveal.tsx             (new — between-round bracket reveal)
│       ├── waiting.tsx                  (existing; bracket-aware status label + round-reveal transition)
│       └── results.tsx                  (dispatch on mode)
├── components/
│   ├── MatchupCard.tsx                  (new — tappable item card for one side of a matchup)
│   ├── BracketTree.tsx                  (new — renders the bracket tree vertically)
│   └── MatchupResult.tsx                (new — vote breakdown row used inside BracketTree)
└── lib/
    └── api.ts                           (new client functions: getBracket, submitMatchupVote)
```

## Validation summary

- Mode at room creation: must be `'vote' | 'rank' | 'bracket'`, defaults to `'vote'`.
- Bracket room item add: rejected if would push total over 16. Participant suggestions never allowed.
- Bracket room start: rejected if `itemCount < 4` or `itemCount > 16`.
- Matchup vote: rejected if room not `voting`, mode not `bracket`, matchup not in current round, matchup is a bye, pickedItemId not one of the two competitors, voter not a participant.
- UNIQUE constraints on `matchups (room_id, round, slot)` and `matchup_votes (matchup_id, voter_id)` catch race conditions at the DB layer.

## Testing

API (Vitest, matching existing test conventions where present):
- Create bracket room: `mode='bracket'` persisted; `allow_suggestions=false` forced.
- Add 16 items: 17th rejected.
- Start with 3 items: rejected. Start with 17 items: rejected (already caught by add). Start with 4 items: succeeds, total rounds = 2 (R1 has 2 matchups, R2 = final).
- Start with 4–16 items at each size: row counts match the formula (`N - P/2` real R1 matchups + `P - N` bye matchups, both summing to `P/2`).
- Submit matchup vote: succeeds; double-vote rejected by UNIQUE; vote on bye rejected; vote on wrong matchup rejected; wrong mode rejected.
- Round advance: when all participants vote on all non-bye R1 matchups, R2 matchups created with correct feeder pairing.
- Tie: matchup tied → winner picked, `decided_by_tiebreak=1`.
- Final: after final matchup decided, status → `revealed`.
- `/bracket`: returns only past + current rounds, never future. Vote breakdowns only on past rounds (not current).
- `/results`: returns full bracket only when revealed.

Mobile (manual test plan):
- iOS simulator, Android emulator, Expo web: tap-to-pick on matchup screen works on each.
- Round reveal screen renders bracket correctly for 4, 7, 8, 16 item rooms (varied bye counts).
- Continue button advances to next round of voting.
- Final reveal shows winner, expanded vote breakdowns, "split decision" labels.
- Resume after close mid-round: locked votes repaint, next unvoted matchup loaded.

## Open questions / future considerations

- **Stalling.** If a participant joins, leaves, and never returns, the current round stalls forever (gating waits for them). If this becomes a real problem in playtesting, add a host force-advance button on the waiting screen.
- **Very small or very lopsided brackets.** 5 items = 3 byes, with most items advancing for free. 9 items = 7 byes. Mathematically valid but feels weird. Consider adding a UI hint on the add-items screen: "Bracket plays best with 4, 8, or 16 items." Non-blocking nudge, not enforcement.
- **Spectator view during play.** Future: a host-only "see who's voted on what" view during the round, like the existing per-voter swipe-progress on the waiting screen. Out of scope for v1.
- **A general game-engine abstraction.** With three concrete modes, the per-mode dispatch pattern is starting to repeat (mode field, mode-specific tables, mode-specific routes, mode-specific screens). Don't refactor now — wait for mode #4 to provide a third data point.
