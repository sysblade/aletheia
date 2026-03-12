import { describe, test, expect } from "bun:test";
import { parseCertStreamMessage } from "./parser.ts";
import { makeCertStreamJson } from "../test-fixtures.ts";

describe("parseCertStreamMessage", () => {
  test("parses valid certificate_update", () => {
    const json = makeCertStreamJson();
    const cert = parseCertStreamMessage(json);
    expect(cert).not.toBeNull();
    expect(cert!.domains.length).toBeGreaterThan(0);
    expect(cert!.issuerOrg).toBe("Test CA");
    expect(cert!.issuerCn).toBe("Test CA CN");
    expect(cert!.logName).toBe("test-log");
    expect(cert!.logUrl).toBe("https://ct.test/log");
    expect(cert!.notBefore).toBe(1700000000);
    expect(cert!.notAfter).toBe(1731536000);
  });

  test("normalizes fingerprint: colons removed, lowercased", () => {
    const json = makeCertStreamJson();
    const cert = parseCertStreamMessage(json);
    expect(cert).not.toBeNull();
    expect(cert!.fingerprint).not.toContain(":");
    expect(cert!.fingerprint).toBe(cert!.fingerprint.toLowerCase());
  });

  test("returns null for heartbeat message", () => {
    const json = JSON.stringify({ message_type: "heartbeat", data: {} });
    expect(parseCertStreamMessage(json)).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseCertStreamMessage("{invalid")).toBeNull();
    expect(parseCertStreamMessage("")).toBeNull();
  });

  test("returns null for missing leaf_cert", () => {
    const json = JSON.stringify({
      message_type: "certificate_update",
      data: { update_type: "X509LogEntry" },
    });
    expect(parseCertStreamMessage(json)).toBeNull();
  });

  test("returns null for empty domains", () => {
    const raw = JSON.parse(makeCertStreamJson());
    raw.data.leaf_cert.all_domains = [];
    expect(parseCertStreamMessage(JSON.stringify(raw))).toBeNull();
  });

  test("filters empty strings from all_domains", () => {
    const raw = JSON.parse(makeCertStreamJson());
    raw.data.leaf_cert.all_domains = ["valid.com", "", "other.com", ""];
    const cert = parseCertStreamMessage(JSON.stringify(raw));
    expect(cert).not.toBeNull();
    expect(cert!.domains).toEqual(["valid.com", "other.com"]);
  });

  test("returns null for missing fingerprint", () => {
    const raw = JSON.parse(makeCertStreamJson());
    raw.data.leaf_cert.fingerprint = "";
    expect(parseCertStreamMessage(JSON.stringify(raw))).toBeNull();
  });

  test("handles missing optional fields", () => {
    const raw = JSON.parse(makeCertStreamJson());
    delete raw.data.leaf_cert.issuer.O;
    delete raw.data.leaf_cert.issuer.CN;
    delete raw.data.leaf_cert.subject.CN;
    delete raw.data.source;
    delete raw.data.cert_link;
    const cert = parseCertStreamMessage(JSON.stringify(raw));
    expect(cert).not.toBeNull();
    expect(cert!.issuerOrg).toBeNull();
    expect(cert!.issuerCn).toBeNull();
    expect(cert!.subjectCn).toBeNull();
    expect(cert!.logName).toBeNull();
    expect(cert!.certLink).toBeNull();
  });
});
