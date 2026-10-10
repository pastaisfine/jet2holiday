import { describe, it, expect } from "vitest";
import { shouldPromptForInvite, shouldRetireInvitePrompt } from "./invitePrompt";

const leader = { user_id: "u1", role: "leader" };
const guest = { user_id: "u2", role: "member" };

const base = {
  tripId: "t1",
  userId: "u1",
  leaderId: "u1",
  members: [leader],
};

describe("shouldPromptForInvite", () => {
  it("asks a lone leader", () => {
    expect(shouldPromptForInvite(base)).toBe(true);
  });

  it("stays closed without a trip, since there is no link to share", () => {
    expect(shouldPromptForInvite({ ...base, tripId: null })).toBe(false);
    expect(shouldPromptForInvite({ ...base, tripId: "" })).toBe(false);
  });

  it("stays closed without a signed-in user", () => {
    expect(shouldPromptForInvite({ ...base, userId: null })).toBe(false);
  });

  it("stays closed once someone has joined", () => {
    expect(shouldPromptForInvite({ ...base, members: [leader, guest] })).toBe(false);
  });

  it("stays closed for a member who is not the leader", () => {
    expect(
      shouldPromptForInvite({
        tripId: "t1",
        userId: "u2",
        leaderId: "u1",
        members: [leader, guest],
      }),
    ).toBe(false);
  });

  it("stays closed once dismissed", () => {
    expect(shouldPromptForInvite({ ...base, dismissed: true })).toBe(false);
  });

  it("trusts trips.leader_id when the membership row is missing", () => {
    // createOrUpdateTrip tolerates a failed leader insert, so a real leader can
    // be the only person named by the trip row itself.
    expect(
      shouldPromptForInvite({
        tripId: "t1",
        userId: "u1",
        leaderId: "u1",
        members: [{ user_id: "u1", role: "member" }],
      }),
    ).toBe(true);
  });

  it("trusts a trip_members leader role when leader_id is null", () => {
    expect(
      shouldPromptForInvite({
        tripId: "t1",
        userId: "u1",
        leaderId: null,
        members: [leader],
      }),
    ).toBe(true);
  });

  it("treats an empty member list as unknown rather than alone", () => {
    // A failed read must not read as "this trip has nobody in it", or a
    // leader who already has a crew gets nagged on top of the failed query.
    expect(shouldPromptForInvite({ ...base, members: [] })).toBe(false);
    expect(shouldPromptForInvite({ ...base, members: null })).toBe(false);
    expect(shouldPromptForInvite({ ...base, members: undefined })).toBe(false);
  });

  it("tolerates malformed input without throwing", () => {
    expect(shouldPromptForInvite()).toBe(false);
    expect(shouldPromptForInvite({ ...base, members: [null, undefined] })).toBe(false);
  });
});

describe("shouldRetireInvitePrompt", () => {
  it("retires once a second member exists", () => {
    expect(shouldRetireInvitePrompt([leader, guest])).toBe(true);
  });

  it("keeps the prompt alive while the leader is still alone", () => {
    expect(shouldRetireInvitePrompt([leader])).toBe(false);
    expect(shouldRetireInvitePrompt([])).toBe(false);
  });
});