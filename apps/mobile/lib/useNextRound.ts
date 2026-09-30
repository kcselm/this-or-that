import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  getParticipants,
  getRoom,
  getStatus,
  joinRoom,
  pickNextHost,
  type Participant,
} from "./api";
import { clearActiveRoom, getActiveRoom, getVoterId, saveActiveRoom } from "./storage";
import { usePolling } from "./usePolling";
import { showAlert } from "./alert";

type NextHost = { participantId: string; name: string };

/**
 * Keep-playing for revealed blind rank rooms: the host picks who hosts the
 * next round, that player creates it, and everyone else is moved into it
 * automatically. Polls only while `active`; `null` means "not known yet".
 */
export function useNextRound(code: string, name: string | undefined, active: boolean | null) {
  const router = useRouter();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [nextHost, setNextHost] = useState<NextHost | null>(null);
  const [advancing, setAdvancing] = useState(false);

  // Guards against a second poll tick starting a concurrent advance attempt
  // (an in-flight advance's own awaits can overlap the poll interval).
  // Flipped synchronously — no await between the check and the set — so two
  // overlapping ticks can't both pass the guard.
  const advancingRef = useRef(false);

  // Lets the "You're up!" button stop the poll before navigating away, so a
  // buried results screen can't auto-advance someone mid-typing on the next
  // screen.
  const stopRef = useRef<(() => void) | null>(null);

  const me = participants.find((p) => p.isYou);
  const isHost = !!me?.isCreator;
  const iAmNext = !!(nextHost && me && nextHost.participantId === me.participantId);

  const resolveDisplayName = async (): Promise<string | null> => {
    if (name) return name;
    const activeRoom = await getActiveRoom();
    return activeRoom?.name ?? null;
  };

  const advanceToNextRound = async (newCode: string, stop: () => void) => {
    setAdvancing(true);
    try {
      const displayName = await resolveDisplayName();
      if (!displayName) {
        // Never joined under a name (e.g. viewed results via an old code) —
        // run them through the normal name entry for the new room. Stop
        // polling only now that we're actually navigating away.
        stop();
        router.replace({ pathname: "/join/name", params: { code: newCode } });
        return;
      }
      const voterId = await getVoterId();
      // Fetch the successor first and branch on its status — POST /join
      // rejects revealed/closed rooms with 400, and a phone backgrounded
      // through the whole next round can reopen after it's already revealed.
      const newRoom = await getRoom(newCode, voterId);
      if (newRoom.status === "revealed") {
        stop();
        router.replace({
          pathname: "/room/[code]/results",
          params: { code: newCode, name: displayName },
        });
        return;
      }
      if (newRoom.status === "closed") {
        stop();
        await clearActiveRoom();
        router.replace("/");
        return;
      }
      await joinRoom(newCode, { voterId, voterName: displayName });
      await saveActiveRoom({ code: newCode, topic: newRoom.topic, name: displayName });
      stop();
      router.replace({
        pathname: "/room/[code]/lobby",
        params: { code: newCode, name: displayName },
      });
    } catch {
      // Transient failure (e.g. network blip) — clear the guard so the next
      // poll tick (polling was never stopped) genuinely retries.
      advancingRef.current = false;
      setAdvancing(false);
    }
  };

  usePolling(async (stop) => {
    stopRef.current = stop;
    if (active === false) {
      stop();
      return;
    }
    if (active === null) return;
    try {
      const voterId = await getVoterId();
      let partsList = participants;
      if (partsList.length === 0) {
        partsList = (await getParticipants(code, voterId)).participants;
        setParticipants(partsList);
      }
      const status = await getStatus(code);
      if (status.nextHost !== undefined) setNextHost(status.nextHost ?? null);
      if (status.nextRoomCode) {
        const self = partsList.find((p) => p.isYou);
        const selfIsNext = !!(
          status.nextHost && self && status.nextHost.participantId === self.participantId
        );
        if (selfIsNext) {
          // The new host reaches the new room through the create flow instead.
          stop();
        } else if (!advancingRef.current) {
          advancingRef.current = true;
          await advanceToNextRound(status.nextRoomCode, stop);
        }
      }
    } catch {}
  }, 3000);

  /** Host only: pick the next host, or omit an id for a random draw. */
  const pick = async (participantId?: string): Promise<boolean> => {
    try {
      const voterId = await getVoterId();
      const res = await pickNextHost(code, {
        creatorVoterId: voterId,
        ...(participantId ? { nextParticipantId: participantId } : {}),
      });
      setNextHost(res.nextHost);
      return true;
    } catch (e: any) {
      showAlert("Error", e.message);
      return false;
    }
  };

  /** The next host heads off to create the next round. */
  const createNextRound = () => {
    stopRef.current?.();
    router.push({
      pathname: "/create",
      params: { mode: "rank", previousRoomCode: code, name: name ?? "" },
    });
  };

  return { participants, nextHost, advancing, isHost, iAmNext, pick, createNextRound };
}

export type NextRound = ReturnType<typeof useNextRound>;
