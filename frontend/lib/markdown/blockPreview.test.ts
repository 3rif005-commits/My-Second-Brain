/**
 * `parseBlockLink` decides which links in a chat answer get hover-card
 * behaviour. Getting it wrong in either direction is a real bug: too loose
 * and an external URL starts firing requests at our own API; too tight and
 * the citations the whole feature exists for stay plain.
 */
import { describe, expect, it } from "vitest";
import { linkBareNoteRefs, parseBlockLink } from "./blockPreview";

const UUID = "3f1c9a2e-4b7d-4e21-9a6f-2c8b17d5e0aa";

describe("parseBlockLink", () => {
  it("recognises the deep-link format retriever.py emits", () => {
    expect(parseBlockLink(`/brain/${UUID}#blk-42`)).toEqual({
      noteId: UUID,
      blockId: "blk-42",
    });
  });

  it("accepts an uppercase uuid", () => {
    expect(parseBlockLink(`/brain/${UUID.toUpperCase()}#b1`)?.noteId).toBe(UUID.toUpperCase());
  });

  it("keeps everything after the first # as the block id", () => {
    // BlockNote ids are uuids in practice, but nothing in the format promises
    // a '#' can never appear — truncating would preview the wrong block.
    expect(parseBlockLink(`/brain/${UUID}#a#b`)?.blockId).toBe("a#b");
  });

  it.each([
    ["an empty hash", `/brain/${UUID}#`],
    ["a bare in-page anchor", "#section-2"],
    ["an external url", "https://example.com/docs"],
    ["a protocol-relative url that merely ends in our path shape", `//evil.example/brain/${UUID}#b1`],
    ["an absolute url to our own path on another host", `https://evil.example/brain/${UUID}#b1`],
    ["a non-uuid note segment", "/brain/not-a-uuid#b1"],
    ["another route entirely", `/workspace/${UUID}#b1`],
    ["undefined", undefined],
  ])("does not treat %s as a citation", (_label, href) => {
    expect(parseBlockLink(href)).toBeNull();
  });
});

describe("parseBlockLink — whole-note links", () => {
  it("previews a note link with no block from its opening passage", () => {
    expect(parseBlockLink(`/brain/${UUID}`)).toEqual({ noteId: UUID, blockId: "_top" });
  });
});

describe("linkBareNoteRefs", () => {
  const U = "09dc0273-e973-4eef-9307-c5703ab54222";
  it("turns a bare [uuid#block] citation into a link", () => {
    expect(linkBareNoteRefs(`see [${U}#n3b2].`)).toBe(`see [↗ note](/brain/${U}#n3b2).`);
    expect(linkBareNoteRefs(`[/brain/${U}]`)).toBe(`[↗ note](/brain/${U})`);
  });
  it("leaves real links and other brackets alone", () => {
    const ok = `[Midterm plan](/brain/${U}#n3b2) and [1] and [not-a-uuid]`;
    expect(linkBareNoteRefs(ok)).toBe(ok);
  });
});
