import type { LrcDocument, LrcLine } from "./lrc-document";
import { setWordStart, wordsOf } from "./lrc-document";

interface HistoryEntry {
  lineIndex: number;
  wordIndex: number;
  previousLine: LrcLine;
}

/** Like SyncEngine, but marks every word of every line, starting from `startLine`. */
export class WordSyncEngine {
  private _document: LrcDocument;
  private _lineIndex: number;
  private _wordIndex: number = 0;
  private _history: HistoryEntry[] = [];

  constructor(document: LrcDocument, startLine: number = 0) {
    this._document = document;
    this._lineIndex = startLine;
    this.skipLinesWithoutWords();
  }

  get document(): LrcDocument { return this._document; }
  get lineIndex(): number { return this._lineIndex; }
  get wordIndex(): number { return this._wordIndex; }
  get isComplete(): boolean { return this._lineIndex >= this._document.lines.length; }

  mark(timestampMs: number): void {
    if (this.isComplete) return;
    this.remember();
    this._document = setWordStart(this._document, this._lineIndex, this._wordIndex, timestampMs);
    this.advance();
  }

  skip(): void {
    if (this.isComplete) return;
    this.remember();
    this.advance();
  }

  undo(): void {
    const entry = this._history.pop();
    if (!entry) return;
    const lines = this._document.lines.map((line, i) => i === entry.lineIndex ? entry.previousLine : line);
    this._document = { ...this._document, lines };
    this._lineIndex = entry.lineIndex;
    this._wordIndex = entry.wordIndex;
  }

  private remember(): void {
    this._history.push({
      lineIndex: this._lineIndex,
      wordIndex: this._wordIndex,
      previousLine: this._document.lines[this._lineIndex]!,
    });
  }

  private advance(): void {
    this._wordIndex++;
    if (this._wordIndex >= wordsOf(this._document.lines[this._lineIndex]!).length) {
      this._lineIndex++;
      this._wordIndex = 0;
      this.skipLinesWithoutWords();
    }
  }

  private skipLinesWithoutWords(): void {
    while (!this.isComplete && wordsOf(this._document.lines[this._lineIndex]!).length === 0) {
      this._lineIndex++;
    }
  }
}
