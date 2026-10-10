import { useEffect, useRef, useState } from "react";
import { UsersThree } from "@phosphor-icons/react";
import { canNativeShare, shareInviteLink } from "../lib/inviteLink";

// Matches the profile screen's confirm modals (ProfileScreen.jsx:9-17): a
// scrim over the whole viewport with a card centred on it. Deliberately below
// BottomSheet's z-index (70) so a sheet opened behind it still wins.
const MODAL_OVERLAY = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(0,0,0,0.45)",
  display: "grid",
  placeItems: "center",
  padding: 20,
};

/**
 * Asks a lone trip leader to invite their crew, with the link in reach.
 *
 * The link only comes into existence at the end of setup, so this is the first
 * screen where sharing is actually possible. `onDismiss` is final for the trip:
 * the deck screen records it, and a member joining closes the dialog the same
 * way, because a leader who already has a crew has nothing left to be asked.
 */
export default function InviteCrewDialog({ open, link, onDismiss }) {
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const primaryRef = useRef(null);

  // The dialog unmounts rather than hiding, so the "Copied" label resets with
  // it and never has to be cleared by hand on the way back in.
  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  const handleShare = async () => {
    const outcome = await shareInviteLink(link);
    setResult(outcome.method);
    // Every fallback can fail -- a clipboard write is refused outside a secure
    // context -- so select the link rather than leaving the user with nothing
    // to copy by hand.
    if (outcome.method === "none") inputRef.current?.select();
  };

  const shared = result === "shared";
  const copied = result === "copied";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-crew-title"
      style={MODAL_OVERLAY}
      onClick={onDismiss}
    >
      <div
        className="bento-card"
        style={{
          padding: 20,
          maxWidth: 340,
          width: "100%",
          background: "var(--surface)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
            marginBottom: 12,
          }}
        >
          <UsersThree size={20} weight="fill" />
        </div>

        <h3 id="invite-crew-title" style={{ margin: "0 0 6px", fontSize: 17 }}>
          Invite your crew?
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Send this link to the people you are travelling with. They sign in and
          swipe the same places, so the itinerary is built from everyone.
        </p>

        <input
          ref={inputRef}
          className="input"
          readOnly
          value={link || ""}
          aria-label="Trip invite link"
          onFocus={(event) => event.currentTarget.select()}
          style={{
            width: "100%",
            fontSize: 11,
            padding: "0 10px",
            height: 38,
            borderRadius: 10,
            background: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleShare}
          >
            {shared ? "Shared" : copied ? "Copied" : canNativeShare() ? "Share invite link" : "Copy invite link"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={onDismiss}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}