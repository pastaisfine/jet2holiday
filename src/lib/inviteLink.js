/**
 * Building and handing off the trip invite link.
 *
 * The join route has always been `/join/{tripId}`, but the string was assembled
 * by hand in three places (SetupStep2Screen, the orphaned SetupScreen, and
 * HubScreen). Three copies is three chances to ship a link that goes somewhere
 * else, so the format lives here and the copy/share fallbacks live here too.
 */

/** The absolute URL that drops someone straight into a trip's workspace. */
export function buildInviteLink(tripId, origin) {
  if (!tripId) return null;
  const base =
    origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/join/${tripId}`;
}

/**
 * True when the device can hand the link to another app — a phone's WhatsApp,
 * Messages, mail composer. This codebase never used the Web Share API before,
 * and on a phone it is the difference between one tap to WhatsApp and three
 * taps through a clipboard round-trip.
 */
export function canNativeShare() {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.share === "function";
}

/**
 * Hands the link to the user, preferring the native share sheet.
 *
 * Returns which route was taken so the caller can say the honest thing: a
 * native share is not a copy, and labelling it "Copied" when nothing was
 * copied trains people to distrust the button.
 *
 * Returns `{ method: "none" }` when every route failed — clipboard writes fail
 * outside a secure context and when permission is refused, and the caller
 * falls back to a selectable input so the link is never simply lost.
 */
export async function shareInviteLink(link) {
  if (!link) return { method: "none" };

  if (canNativeShare()) {
    try {
      await navigator.share({
        title: "Join my trip",
        text: "Join my trip on Tripder and help pick where we go.",
        url: link,
      });
      return { method: "shared" };
    } catch (err) {
      // A user swiping the share sheet away is not a failure to copy, but it is
      // also not a share -- fall through so they still end up with the link.
      if (err?.name === "AbortError") return { method: "none" };
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
      return { method: "copied" };
    }
  } catch {
    // Falls through to "none" below.
  }

  return { method: "none" };
}