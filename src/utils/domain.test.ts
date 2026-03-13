import { describe, expect, test } from "bun:test";
import { extractTwoLevelDomain, isWildcardDomain } from "./domain.ts";

describe("extractTwoLevelDomain", () => {
  test("extracts 2-level domain from simple FQDN", () => {
    expect(extractTwoLevelDomain("example.com")).toBe("example.com");
    expect(extractTwoLevelDomain("google.com")).toBe("google.com");
  });

  test("extracts 2-level domain from subdomains", () => {
    expect(extractTwoLevelDomain("www.example.com")).toBe("example.com");
    expect(extractTwoLevelDomain("www.api.google.com")).toBe("google.com");
    expect(extractTwoLevelDomain("a.b.c.d.example.com")).toBe("example.com");
  });

  test("handles wildcard domains", () => {
    expect(extractTwoLevelDomain("*.example.com")).toBe("example.com");
    expect(extractTwoLevelDomain("*.cdn.cloudflare.com")).toBe("cloudflare.com");
    expect(extractTwoLevelDomain("*.api.service.example.com")).toBe("example.com");
  });

  test("handles country code TLDs correctly", () => {
    expect(extractTwoLevelDomain("example.co.uk")).toBe("example.co.uk");
    expect(extractTwoLevelDomain("site.co.jp")).toBe("site.co.jp");
    expect(extractTwoLevelDomain("www.example.com.au")).toBe("example.com.au");
  });

  test("handles public suffixes correctly", () => {
    // These are public suffixes and should return the site name + suffix
    expect(extractTwoLevelDomain("site.github.io")).toBe("site.github.io");
    expect(extractTwoLevelDomain("myapp.herokuapp.com")).toBe("myapp.herokuapp.com");
    expect(extractTwoLevelDomain("project.netlify.app")).toBe("project.netlify.app");
  });

  test("returns null for bare public suffixes", () => {
    expect(extractTwoLevelDomain("github.io")).toBeNull();
    expect(extractTwoLevelDomain("co.uk")).toBeNull();
    expect(extractTwoLevelDomain("com")).toBeNull();
  });

  test("handles case insensitivity", () => {
    expect(extractTwoLevelDomain("WWW.EXAMPLE.COM")).toBe("example.com");
    expect(extractTwoLevelDomain("Example.Com")).toBe("example.com");
    expect(extractTwoLevelDomain("*.CDN.CLOUDFLARE.COM")).toBe("cloudflare.com");
  });

  test("returns null for invalid input", () => {
    expect(extractTwoLevelDomain("")).toBeNull();
    expect(extractTwoLevelDomain("*.")).toBeNull();
    expect(extractTwoLevelDomain("*")).toBeNull();
    // @ts-expect-error - testing invalid input
    expect(extractTwoLevelDomain(null)).toBeNull();
    // @ts-expect-error - testing invalid input
    expect(extractTwoLevelDomain(undefined)).toBeNull();
  });

  test("handles trailing dots", () => {
    // psl should handle these gracefully
    expect(extractTwoLevelDomain("example.com.")).toBe("example.com");
    expect(extractTwoLevelDomain("www.example.com.")).toBe("example.com");
  });

  test("handles IP addresses", () => {
    // IP addresses are not valid domains for psl
    expect(extractTwoLevelDomain("192.168.1.1")).toBeNull();
    expect(extractTwoLevelDomain("10.0.0.1")).toBeNull();
  });
});

describe("isWildcardDomain", () => {
  test("identifies wildcard domains", () => {
    expect(isWildcardDomain("*.example.com")).toBe(true);
    expect(isWildcardDomain("*.cdn.cloudflare.com")).toBe(true);
  });

  test("returns false for non-wildcard domains", () => {
    expect(isWildcardDomain("example.com")).toBe(false);
    expect(isWildcardDomain("www.example.com")).toBe(false);
    expect(isWildcardDomain("*")).toBe(false);
    expect(isWildcardDomain("*example.com")).toBe(false);
  });

  test("handles empty string", () => {
    expect(isWildcardDomain("")).toBe(false);
  });
});
