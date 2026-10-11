import { describe, it, expect } from "vitest";
import {
  RESET_LINK_STATE,
  classifyResetLink,
  readResetParams,
  buildResetRedirect,
} from "./resetLink";

const fragmentUrl = (q) => `https://app.example.com/reset-password#${q}`;
const queryUrl = (q) => `https://app.example.com/reset-password?${q}`;

describe("readResetParams", () => {
  it("parses a fragment", () => {
    expect(readResetParams(fragmentUrl("access_token=a&token_type=bearer"))).toEqual({
      access_token: "a",
      token_type: "bearer",
    });
  });

  it("parses a query", () => {
    expect(readResetParams(queryUrl("error_code=otp_expired"))).toEqual({
      error_code: "otp_expired",
    });
  });

  it("merges both halves, which is what a redirected callback looks like", () => {
    const url = "https://app.example.com/reset-password?error=x#access_token=a";
    expect(readResetParams(url)).toEqual({ error: "x", access_token: "a" });
  });

  it("accepts a location-like object", () => {
    const params = readResetParams({ search: "?a=1", hash: "#b=2" });
    expect(params).toEqual({ a: "1", b: "2" });
  });

  it("lowercases keys so casing differences cannot smuggle a param past a check", () => {
    expect(readResetParams("https://x/#ERROR_CODE=otp_expired")).toEqual({
      error_code: "otp_expired",
    });
  });

  it("tolerates junk without throwing", () => {
    expect(readResetParams()).toEqual({});
    expect(readResetParams("")).toEqual({});
    expect(readResetParams("#")).toEqual({});
  });
});

describe("classifyResetLink", () => {
  it("treats a full implicit-flow recovery fragment as usable", () => {
    const url = fragmentUrl(
      "access_token=eyJhbGciOi&expires_in=3600&refresh_token=qmg&token_type=bearer&type=recovery",
    );
    expect(classifyResetLink(url)).toEqual({
      state: RESET_LINK_STATE.RECOVERY,
      reason: "",
    });
  });

  it("treats a type=recovery marker alone as a recovery link", () => {
    expect(classifyResetLink(fragmentUrl("type=recovery")).state).toBe(
      RESET_LINK_STATE.RECOVERY,
    );
  });

  it("leaves a bare visit unresolved rather than calling the link bad", () => {
    // No error was reported, so the screen should keep waiting on the session
    // instead of accusing the link of being spent.
    expect(classifyResetLink("https://app.example.com/reset-password").state).toBe(
      RESET_LINK_STATE.RECOVERY,
    );
  });

  it("rejects an expired or already-used link", () => {
    const result = classifyResetLink(
      queryUrl("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"),
    );
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
    expect(result.reason).toMatch(/expired or was already used/i);
  });

  it("rejects a spent link delivered in the fragment, the way production sends it", () => {
    // Captured from the live auth server:
    //   GET /auth/v1/verify?token=<spent>&type=recovery
    //   -> 303 https://jet2holiday-ten.vercel.app/reset-password
    //        #error=access_denied&error_code=otp_expired&...&sb=
    // The error arrives in the fragment, not the query, so a classifier that
    // only read the query would let this sit spinning until the timeout.
    const result = classifyResetLink(
      "https://jet2holiday-ten.vercel.app/reset-password" +
        "#error=access_denied&error_code=otp_expired" +
        "&error_description=Email+link+is+invalid+or+has+expired&sb=",
    );
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
    expect(result.reason).toMatch(/expired or was already used/i);
  });

  it("rejects a PKCE code this client cannot exchange", () => {
    const result = classifyResetLink(queryUrl("code=abcdef0123456789"));
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
    expect(result.reason).toMatch(/no longer valid/i);
  });

  it("lets a reported error outrank a leftover fragment", () => {
    // A spent link can still carry params; the server's verdict is the real one.
    const result = classifyResetLink(
      "https://app.example.com/reset-password?error_code=otp_expired#access_token=a&token_type=bearer",
    );
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
  });

  it("does not leak an unknown error code to the user", () => {
    const result = classifyResetLink(queryUrl("error_code=some_internal_thing_42"));
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
    expect(result.reason).not.toContain("some_internal_thing_42");
  });

  it("still reports something actionable for a bare error flag", () => {
    const result = classifyResetLink(queryUrl("error=access_denied"));
    expect(result.state).toBe(RESET_LINK_STATE.INVALID);
    expect(result.reason).toBeTruthy();
  });

  it("tolerates junk without throwing", () => {
    expect(classifyResetLink().state).toBe(RESET_LINK_STATE.RECOVERY);
    expect(classifyResetLink("").state).toBe(RESET_LINK_STATE.RECOVERY);
  });
});

describe("buildResetRedirect", () => {
  it("pins the link to the configured site so a preview cannot send it astray", () => {
    expect(buildResetRedirect("https://jet2holiday-ten.vercel.app", "https://preview-abc.vercel.app")).toBe(
      "https://jet2holiday-ten.vercel.app/reset-password",
    );
  });

  it("falls back to the current origin for local dev", () => {
    expect(buildResetRedirect("", "http://localhost:5173")).toBe(
      "http://localhost:5173/reset-password",
    );
    expect(buildResetRedirect(undefined, "http://localhost:5173")).toBe(
      "http://localhost:5173/reset-password",
    );
  });

  it("tolerates a trailing slash on the site url", () => {
    expect(buildResetRedirect("https://app.example.com/", "")).toBe(
      "https://app.example.com/reset-password",
    );
    expect(buildResetRedirect("https://app.example.com///", "")).toBe(
      "https://app.example.com/reset-password",
    );
  });

  it("does not produce a doubled slash when the site url ends in one", () => {
    expect(buildResetRedirect("https://app.example.com/", "")).not.toContain("//reset");
  });

  it("degrades to just the path when neither source is known", () => {
    expect(buildResetRedirect()).toBe("/reset-password");
  });
});
