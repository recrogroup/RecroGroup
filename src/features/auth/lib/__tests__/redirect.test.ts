import { describe, expect, it } from "vitest";

import {
  DEFAULT_AFTER_AUTH,
  continueUrl,
  joinUsUrl,
  loginUrl,
  postAuthPath,
  safeCallbackUrl,
} from "../redirect";

describe("safeCallbackUrl", () => {
  it("defaults to the homepage", () => {
    expect(safeCallbackUrl(undefined)).toBe(DEFAULT_AFTER_AUTH);
    expect(safeCallbackUrl("")).toBe(DEFAULT_AFTER_AUTH);
  });

  it("keeps an internal booking path and query", () => {
    expect(safeCallbackUrl("/booking?service=family")).toBe(
      "/booking?service=family",
    );
  });

  it("rejects open redirects", () => {
    expect(safeCallbackUrl("https://evil.test")).toBe("/");
    expect(safeCallbackUrl("//evil.test")).toBe("/");
    expect(safeCallbackUrl("/\\evil.test")).toBe("/");
  });

  it("does not bounce back into auth pages", () => {
    expect(safeCallbackUrl("/login")).toBe("/");
    expect(safeCallbackUrl("/join-us?callbackUrl=/booking")).toBe("/");
  });
});

describe("auth urls", () => {
  it("omits callbackUrl when returning home", () => {
    expect(loginUrl("/")).toBe("/login");
    expect(joinUsUrl(undefined)).toBe("/join-us");
  });

  it("preserves the return path", () => {
    expect(loginUrl("/booking?service=family")).toBe(
      "/login?callbackUrl=%2Fbooking%3Fservice%3Dfamily",
    );
  });
});

describe("postAuthPath", () => {
  it("sends staff to the dashboard when no return path is set", () => {
    expect(postAuthPath("admin")).toBe("/dashboard");
    expect(postAuthPath("receptionist")).toBe("/dashboard");
  });

  it("keeps customers on the public site", () => {
    expect(postAuthPath("customer")).toBe("/");
    expect(postAuthPath("customer", "/booking")).toBe("/booking");
  });

  it("does not send a customer to staff pages", () => {
    expect(postAuthPath("customer", "/admin")).toBe("/");
    expect(postAuthPath("customer", "/dashboard/bookings")).toBe("/");
  });

  it("honours a staff return path", () => {
    expect(postAuthPath("admin", "/admin/bookings")).toBe("/admin/bookings");
  });
});

describe("continueUrl", () => {
  it("routes through signed-in so staff can be sent to the dashboard", () => {
    expect(continueUrl(undefined)).toBe("/signed-in");
    expect(continueUrl("/booking")).toBe("/signed-in?callbackUrl=%2Fbooking");
  });
});
