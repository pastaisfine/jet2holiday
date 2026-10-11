/**
 * Classifying where a password-reset link landed the user.
 *
 * Supabase emails a link that bounces through the auth server before it reaches
 * /reset-password. By the time our SPA loads, that trip has already left traces
 * in the URL, and *which* trace tells us whether the link can still be used:
 *
 *   - A good link arrives as an implicit-flow fragment carrying the session
 *     tokens and `type=recovery`. The client exchanges it for a session.
 *   - A link that has already been clicked, or that has aged out, comes back as
 *     an `?error=...&error_code=otp_expired` query instead of a session. No
 *     amount of waiting turns that into a session; it is already spent.
 *   - A PKCE-style link arrives as `?code=...`, which this client (implicit
 *     flow) cannot exchange.
 *
 * The reset screen used to answer only "is there a session yet?", which left
 * every one of the last three cases showing "Verifying your reset link..." with
 * a permanently disabled form and no way back. This module turns the URL into an
 * explicit verdict so the screen can say what happened and offer a new link.
 *
 * Kept pure and free of Supabase and React so it can be tested directly; the
 * screen owns the session and the submit.
 */

/** The three outcomes the reset screen can be in. */
export const RESET_LINK_STATE = {
  /** A usable recovery token is present, or nothing has ruled it out yet. */
  RECOVERY: "recovery",
  /** The auth server has said this link is spent or unusable. */
  INVALID: "invalid",
};

/**
 * Supabase error codes that mean "ask for a new link", with the copy we show.
 * Anything not listed falls back to a generic message rather than leaking the
 * raw code at the user.
 */
const INVALID_REASONS = {
  otp_expired: "This reset link has expired or was already used.",
  access_denied: "This reset link is no longer valid.",
  otp_disabled: "This reset link is no longer valid.",
  verification_failed: "This reset link could not be verified.",
  identity_not_found: "This reset link could not be verified.",
};

/**
 * Read a URL's query + fragment into a flat map of params, lowercasing keys so
 * callers can rely on the canonical casing Supabase uses.
 *
 * Accepts either a full URL string or a location-ish object with `search` and
 * `hash`, so it can be pointed at `window.location` in the app and at a plain
 * string in tests.
 */
export function readResetParams(input = "") {
  // Auth params only ever live in the query and the fragment, so parse those
  // two pieces separately. Splitting the whole string would fold the scheme and
  // host ("https://host/path") into a bogus param.
  let query = "";
  let hash = "";
  if (typeof input === "string") {
    const qIndex = input.indexOf("?");
    const hIndex = input.indexOf("#");
    query = qIndex === -1 ? "" : input.slice(qIndex + 1);
    hash = hIndex === -1 ? "" : input.slice(hIndex + 1);
    if (hIndex !== -1 && qIndex !== -1 && hIndex < qIndex) {
      // Fragment comes first (a full URL pasted with a trailing query after it);
      // keep only the real fragment.
      query = "";
    }
    if (hIndex !== -1 && query) {
      // Trim any query segment that trails the fragment.
      const hInQuery = query.indexOf("#");
      if (hInQuery !== -1) query = query.slice(0, hInQuery);
    }
    if (hIndex !== -1) {
      const qInHash = hash.indexOf("?");
      if (qInHash !== -1) hash = hash.slice(0, qInHash);
    }
  } else {
    query = String(input.search || "").replace(/^\?/, "");
    hash = String(input.hash || "").replace(/^#/, "");
  }

  const params = {};
  for (const part of [query, hash]) {
    if (!part) continue;
    for (const [key, value] of new URLSearchParams(part).entries()) {
      params[key.toLowerCase()] = value;
    }
  }
  return params;
}

/**
 * Decide whether the URL we were handed still contains a usable reset token,
 * or whether the link is already spent.
 *
 * Order matters. An error in the URL is the auth server having *made a
 * decision* about the link, so it wins over anything the fragment appears to
 * offer -- a spent link can still carry leftover params.
 */
export function classifyResetLink(input = "") {
  const params = readResetParams(input);

  // The auth server rejected the link. This is the terminal case.
  const errorCode = (params.error_code || params.error || "").toLowerCase();
  if (errorCode) {
    return {
      state: RESET_LINK_STATE.INVALID,
      reason: INVALID_REASONS[errorCode] || "This reset link could not be used. Please request a new one.",
    };
  }

  // A PKCE code. This client runs the implicit flow and has no verifier for it,
  // so it can never be redeemed here.
  if (params.code) {
    return {
      state: RESET_LINK_STATE.INVALID,
      reason: "This reset link is no longer valid. Please request a new one.",
    };
  }

  // The implicit-flow fragment. A recovery token is what we are waiting for;
  // anything else (a bare visit, a fragment for some other flow) leaves the
  // screen in its "still checking" state rather than calling the link bad.
  const hasRecoveryToken = Boolean(
    params.access_token && params.refresh_token && params.token_type,
  );
  if (hasRecoveryToken || params.type === "recovery") {
    return { state: RESET_LINK_STATE.RECOVERY, reason: "" };
  }

  return { state: RESET_LINK_STATE.RECOVERY, reason: "" };
}

/**
 * Build the URL a reset email should send the user back to.
 *
 * The host is pinned to the canonical site when one is configured, so a reset
 * requested on a preview or a stray origin still produces a link that lands on
 * the real app. Falls back to the current origin for local dev.
 */
export function buildResetRedirect(siteUrl, currentOrigin = "") {
  const base = (siteUrl || currentOrigin || "").trim();
  return `${base.replace(/\/+$/, "")}/reset-password`;
}
