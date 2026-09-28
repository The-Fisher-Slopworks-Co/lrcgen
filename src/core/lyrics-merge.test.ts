import { describe, expect, test } from "bun:test";
import { groupsFromLrcLines, type LrcLine } from "./lrc-lines";
import { groupsFromText, groupText, setMetadata } from "./lyrics";
import { adoptWordTimings, applyAlignment, replaceLyrics } from "./lyrics-merge";
import { doc, docOf, endsOf, group, startsOf, textsOf } from "./testing";

const wordTimed: LrcLine = {
  timestamp: 1000,
  text: "Never gonna give",
  words: [
    { start: 1000, text: "Never " },
    { start: 1500, text: "gonna " },
    { start: 2000, text: "give" },
  ],
  end: 2500,
};

const song = (...lines: LrcLine[]) => setMetadata(docOf(...lines), { title: "Song" });
const lines = (...l: LrcLine[]) => groupsFromLrcLines(l);

describe("replaceLyrics", () => {
  test("keeps line and word timings for lines that still match, in order", () => {
    const d = song({ timestamp: 500, text: "Intro" }, wordTimed, { timestamp: 3000, text: "Old line" });
    const { doc: next, kept } = replaceLyrics(d, groupsFromText("Intro\nNew line\nNever gonna give"));
    expect(kept).toBe(2);
    expect(next.metadata.title).toBe("Song");
    expect(next.groups.map(groupText)).toEqual(["Intro", "New line", "Never gonna give"]);
    expect(startsOf(next.groups[0])).toEqual([500]);
    expect(startsOf(next.groups[1])).toEqual([null, null]);
    expect(next.groups[2]).toBe(d.groups[1]!);
  });

  test("ids stay unique: matched groups keep theirs, new ones get fresh ones", () => {
    const d = song({ timestamp: 500, text: "Intro" });
    const { doc: next } = replaceLyrics(d, groupsFromText("New\nIntro"));
    expect(next.groups[1]!.id).toBe(d.groups[0]!.id);
    const ids = next.groups.flatMap((g) => [g.id, ...g.words.map((w) => w.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("matches only forward: a repeated line takes the next occurrence", () => {
    const d = song({ timestamp: 1000, text: "La" }, { timestamp: 2000, text: "Mid" }, { timestamp: 3000, text: "La" });
    const { doc: next } = replaceLyrics(d, groupsFromText("La\nLa\nMid"));
    expect(next.groups.map((g) => startsOf(g)[0])).toEqual([1000, 3000, null]);
  });

  test("untimed old lines keep nothing and are not counted; new timings stay", () => {
    const { doc, kept } = replaceLyrics(song({ timestamp: null, text: "Hello" }), lines({ timestamp: 4000, text: "Hello" }));
    expect(kept).toBe(0);
    expect(startsOf(doc.groups[0])).toEqual([4000]);
  });

  test("old timings win over the new lines' own", () => {
    const { doc } = replaceLyrics(song({ timestamp: 1000, text: "Hello" }), lines({ timestamp: 4000, text: "Hello" }));
    expect(startsOf(doc.groups[0])).toEqual([1000]);
  });

  test("matches despite case and punctuation, keeping word timings when the parts still line up", () => {
    const old: LrcLine = {
      timestamp: 1000,
      text: "Я не могу иначе",
      words: [{ start: 1000, text: "Я " }, { start: 1200, text: "не " }, { start: 1400, text: "могу " }, { start: 1800, text: "иначе" }],
      end: 2500,
    };
    const { doc, kept } = replaceLyrics(song(old), groupsFromText("я не могу иначе,"));
    expect(kept).toBe(1);
    expect(textsOf(doc.groups[0])).toEqual(["я", "не", "могу", "иначе,"]);
    expect(startsOf(doc.groups[0])).toEqual([1000, 1200, 1400, 1800]);
    expect(endsOf(doc.groups[0])).toEqual([null, null, null, 2500]);
  });

  test("keeps joined words when the text changes but the parts line up", () => {
    const joined: LrcLine = { ...wordTimed, words: [{ start: 1000, text: "Never gonna " }, { start: 2000, text: "give" }] };
    const { doc } = replaceLyrics(song(joined), groupsFromText("Never, gonna give!"));
    expect(textsOf(doc.groups[0])).toEqual(["Never, gonna", "give!"]);
    expect(startsOf(doc.groups[0])).toEqual([1000, 2000]);
  });

  test("keeps only the line start when the number of parts differs", () => {
    const { doc, kept } = replaceLyrics(song(wordTimed), groupsFromText("Never-gonna give"));
    expect(kept).toBe(1);
    expect(textsOf(doc.groups[0])).toEqual(["Never-gonna", "give"]);
    expect(startsOf(doc.groups[0])).toEqual([1000, null]);
  });

  test("a line timing survives a punctuation change", () => {
    const { doc, kept } = replaceLyrics(song({ timestamp: 500, text: "Don't stop" }), groupsFromText("don’t stop..."));
    expect(kept).toBe(1);
    expect(groupText(doc.groups[0]!)).toBe("don’t stop...");
    expect(startsOf(doc.groups[0])[0]).toBe(500);
  });

  test("labels: the old group's win; new ones come in with new groups", () => {
    const old = replaceLyrics(song({ timestamp: 500, text: "(ooh)" }), groupsFromText("ooh")).doc;
    expect(old.groups[0]!.labels).toEqual(["backing"]);
    const fresh = replaceLyrics(song({ timestamp: 500, text: "ooh" }), lines({ timestamp: null, text: "(ooh)" })).doc;
    expect(fresh.groups[0]!.labels).toEqual(["backing"]);
  });
});

describe("adoptWordTimings", () => {
  const source = lines(
    { timestamp: 900, text: "never gonna give", words: [{ start: 900, end: 1300, text: "never " }, { start: 1400, text: "gonna " }, { start: 1900, text: "give" }], end: 2400 },
    { timestamp: 3000, text: "dont stop", words: [{ start: 3000, text: "dont " }, { start: 3400, text: "stop" }], end: 3900 },
  );

  test("copies word starts, keeping the document's text and ids; no word gets an end", () => {
    const d = song({ timestamp: 1000, text: "Never gonna give!" }, { timestamp: null, text: "Don’t stop" });
    const { doc: next, adopted } = adoptWordTimings(d, source);
    expect(adopted).toBe(2);
    expect(textsOf(next.groups[0])).toEqual(["Never", "gonna", "give!"]);
    expect(startsOf(next.groups[0])).toEqual([900, 1400, 1900]);
    expect(endsOf(next.groups[0])).toEqual([null, null, null]);
    expect(next.groups[0]!.words.map((w) => w.id)).toEqual(d.groups[0]!.words.map((w) => w.id));
    expect(textsOf(next.groups[1])).toEqual(["Don’t", "stop"]);
    expect(startsOf(next.groups[1])).toEqual([3000, 3400]);
  });

  test("keeps the document's joined words", () => {
    const joined: LrcLine = { timestamp: 1000, text: "Never, gonna give", words: [{ start: 1000, text: "Never, gonna " }, { start: 2000, text: "give" }] };
    const { doc } = adoptWordTimings(song(joined), source);
    expect(textsOf(doc.groups[0])).toEqual(["Never, gonna", "give"]);
    expect(startsOf(doc.groups[0])).toEqual([900, 1900]);
    expect(endsOf(doc.groups[0])).toEqual([null, null]);
  });

  test("the words it times lose the ends they had", () => {
    const d = setMetadata(doc(group("dont stop", [2900, 3300], [3200, 3800])), { title: "Song" });
    const { doc: next } = adoptWordTimings(d, source);
    expect(startsOf(next.groups[0])).toEqual([3000, 3400]);
    expect(endsOf(next.groups[0])).toEqual([null, null]);
  });

  test("ignores case, quotes and punctuation in Russian too", () => {
    const ru = lines({ timestamp: 500, text: "ещё раз", words: [{ start: 500, text: "ещё " }, { start: 900, text: "раз" }] });
    const { doc, adopted } = adoptWordTimings(song({ timestamp: null, text: "«Еще — раз!»" }), ru);
    expect(adopted).toBe(1);
    expect(textsOf(doc.groups[0])).toEqual(["«Еще", "—", "раз!»"]);
    expect(startsOf(doc.groups[0])).toEqual([500, null, 900]);
  });

  test("skips lines whose words don't line up, and lines without word timings", () => {
    const d = song({ timestamp: 1000, text: "Never-gonna give" }, { timestamp: 2000, text: "dont stop" });
    const { doc: next, adopted } = adoptWordTimings(d, [source[0]!, ...lines({ timestamp: 3000, text: "dont stop" })]);
    expect(adopted).toBe(0);
    expect(next.groups).toEqual(d.groups);
  });

  test("matches in order and leaves unmatched lines alone", () => {
    const d = song({ timestamp: 100, text: "Intro" }, { timestamp: null, text: "dont stop" }, { timestamp: null, text: "never gonna give" });
    const { doc: next, adopted } = adoptWordTimings(d, source);
    expect(adopted).toBe(1);
    expect(next.groups[0]).toBe(d.groups[0]!);
    expect(startsOf(next.groups[1])).toEqual([3000, 3400]);
    expect(next.groups[2]).toBe(d.groups[2]!);
  });
});

describe("applyAlignment", () => {
  test("takes starts and word timings, keeping the document's text and leaving unmatched lines alone", () => {
    const d = song(
      { timestamp: 100, text: "Never gonna give" },
      { timestamp: null, text: "[Chorus]" },
      wordTimed,
      { timestamp: 7000, text: "Edited while syncing" },
    );
    const source = lines(
      { timestamp: 900, text: "Never gonna give", words: [{ start: 900, end: 1200, text: "Never " }, { start: 1400, text: "gonna " }, { start: 1900, text: "give" }], end: 2400 },
      { timestamp: null, text: "[Chorus]" },
      { timestamp: 3000, text: "Never gonna give" },
      { timestamp: 5000, text: "Original line" },
    );
    const { doc: next, synced } = applyAlignment(d, source);
    expect(synced).toBe(2);
    expect(startsOf(next.groups[0])).toEqual([900, 1400, 1900]);
    expect(endsOf(next.groups[0])).toEqual([null, null, null]);
    expect(next.groups[1]).toBe(d.groups[1]!);
    // Only the start was found: the old word timings would no longer fit.
    expect(startsOf(next.groups[2])).toEqual([3000, null, null]);
    expect(endsOf(next.groups[2])).toEqual([null, null, null]);
    expect(next.groups[3]).toBe(d.groups[3]!);
  });
});
