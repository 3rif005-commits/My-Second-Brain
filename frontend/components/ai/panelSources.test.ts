import { describe, it, expect, beforeEach } from "vitest";
import { fileTitle, pageNoteIdOf } from "./panelSources";
import { stageDraft, takeStagedDraft, offerDraft, DRAFT_EVENT } from "@/lib/noteDraft";

const ID = "0685d321-364c-4c2e-af21-9a317fa09ce3";

describe("where the panel's files go", () => {
  it("knows the open note only on a note page", () => {
    expect(pageNoteIdOf(`/brain/${ID}`)).toBe(ID);
    // the workspace, a database, home: no note to fill
    expect(pageNoteIdOf(`/brain/workspace/${ID}`)).toBeNull();
    expect(pageNoteIdOf("/brain")).toBeNull();
    expect(pageNoteIdOf(null)).toBeNull();
  });

  it("names a new note after the first file", () => {
    expect(fileTitle("Lect10-IML26.pdf")).toBe("Lect10-IML26");
    expect(fileTitle("notes.v2.md")).toBe("notes.v2");
    expect(fileTitle("README")).toBe("README");
  });
});

describe("handing a draft to a note page", () => {
  beforeEach(() => sessionStorage.clear());

  it("a staged draft is taken once", () => {
    const d = { noteId: ID, html: "<h1>x</h1>", sourceIds: ["s1"], mode: "replace" as const };
    stageDraft(d);
    expect(takeStagedDraft(ID)).toEqual(d);
    expect(takeStagedDraft(ID)).toBeNull();      // a remount cannot apply it twice
  });

  it("an open page claims the draft; with none open the caller is told to stage it", async () => {
    const d = { noteId: ID, html: "<p>x</p>", sourceIds: [], mode: "append" as const };
    expect(await offerDraft(d, 20)).toBe(false);
    const claim = (e: Event) => (e as CustomEvent).detail.respond(true);
    window.addEventListener(DRAFT_EVENT, claim);
    expect(await offerDraft(d, 20)).toBe(true);
    window.removeEventListener(DRAFT_EVENT, claim);
  });
});

describe("links as sources", async () => {
  const { parseLink, attachmentName, attachmentsTitle } = await import("./panelSources");
  it("accepts only a whole http(s) link", () => {
    expect(parseLink(" https://youtu.be/abc ")).toBe("https://youtu.be/abc");
    expect(parseLink("see https://x.org")).toBeNull();
    expect(parseLink("ftp://x.org/a")).toBeNull();
  });
  it("names a link by its host and path", () => {
    const a = { kind: "url" as const, url: "https://www.example.com/ml/lecture-3" };
    expect(attachmentName(a)).toBe("example.com/ml/lecture-3");
    expect(attachmentsTitle([a])).toBe("example.com/ml/lecture-3");
  });
});
