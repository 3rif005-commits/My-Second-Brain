// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./fetchPlugin";

describe("isPrivateAddress — installs never reach the server's own network", () => {
  it("refuses loopback, private, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "nonsense"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["140.82.112.3", "151.101.1.229", "2606:4700::6810:84e5"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
