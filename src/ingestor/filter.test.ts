import { describe, test, expect } from "bun:test";
import { CertFilter } from "./filter.ts";
import { makeCert } from "../test-fixtures.ts";

describe("CertFilter", () => {
  describe("firehose mode", () => {
    test("matches everything when no filters", () => {
      const filter = new CertFilter([], []);
      expect(filter.isFirehose).toBe(true);
      expect(filter.matches(makeCert())).toBe(true);
      expect(filter.matches(makeCert({ issuerOrg: null }))).toBe(true);
    });

    test("describe returns firehose label", () => {
      const filter = new CertFilter([], []);
      expect(filter.describe()).toBe("firehose (no filters)");
    });

    test("mode returns firehose when no filters", () => {
      const filter = new CertFilter([], []);
      expect(filter.mode).toBe("firehose");
    });
  });

  describe("domain glob", () => {
    test("exact match", () => {
      const filter = new CertFilter(["exact.com"], []);
      expect(filter.matches(makeCert({ domains: ["exact.com"] }))).toBe(true);
      expect(filter.matches(makeCert({ domains: ["other.com"] }))).toBe(false);
    });

    test("wildcard * matches subdomains", () => {
      const filter = new CertFilter(["*.example.com"], []);
      expect(filter.matches(makeCert({ domains: ["sub.example.com"] }))).toBe(true);
      expect(filter.matches(makeCert({ domains: ["deep.sub.example.com"] }))).toBe(true);
      expect(filter.matches(makeCert({ domains: ["example.com"] }))).toBe(false);
    });

    test("? matches single character", () => {
      const filter = new CertFilter(["?.example.com"], []);
      expect(filter.matches(makeCert({ domains: ["a.example.com"] }))).toBe(true);
      expect(filter.matches(makeCert({ domains: ["ab.example.com"] }))).toBe(false);
    });

    test("case-insensitive matching", () => {
      const filter = new CertFilter(["*.EXAMPLE.COM"], []);
      expect(filter.matches(makeCert({ domains: ["sub.example.com"] }))).toBe(true);
    });
  });

  describe("issuer substring", () => {
    test("case-insensitive contains match", () => {
      const filter = new CertFilter([], ["let's encrypt"]);
      expect(filter.matches(makeCert({ issuerOrg: "Let's Encrypt Authority" }))).toBe(true);
      expect(filter.matches(makeCert({ issuerOrg: "DigiCert" }))).toBe(false);
    });

    test("null issuerOrg does not match", () => {
      const filter = new CertFilter([], ["some-issuer"]);
      expect(filter.matches(makeCert({ issuerOrg: null }))).toBe(false);
    });
  });

  describe("combined filters", () => {
    test("matches if either domain OR issuer hits", () => {
      const filter = new CertFilter(["*.example.com"], ["digicert"]);
      // domain match, issuer mismatch
      expect(filter.matches(makeCert({ domains: ["sub.example.com"], issuerOrg: "Other" }))).toBe(true);
      // issuer match, domain mismatch
      expect(filter.matches(makeCert({ domains: ["other.com"], issuerOrg: "DigiCert Inc" }))).toBe(true);
      // neither
      expect(filter.matches(makeCert({ domains: ["other.com"], issuerOrg: "Other" }))).toBe(false);
    });

    test("describe with mixed filters", () => {
      const filter = new CertFilter(["*.com", "*.org"], ["digicert"]);
      expect(filter.describe()).toBe("2 domain pattern(s), 1 issuer filter(s)");
    });

    test("mode returns filtered when filters are configured", () => {
      const filter = new CertFilter(["*.com"], []);
      expect(filter.mode).toBe("filtered");
    });
  });
});
