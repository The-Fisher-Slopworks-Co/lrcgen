import React from "react";
import { Text } from "ink";
import type { LrcLine } from "../../core/lrc-document";
import { wordsOf } from "../../core/lrc-document";
import { timeLabel } from "./line-list";

interface WordLineProps {
  line: LrcLine;
  markWords: boolean;
  /** Words that started before this position are lit up, karaoke style. */
  positionMs?: number;
  selectedIndex?: number;
}

export function WordLine({ line, markWords, positionMs, selectedIndex }: WordLineProps) {
  return (
    <Text bold>
      <Text color="cyan">{timeLabel(line, markWords)}</Text>
      {wordsOf(line).map((word, i) => {
        const label = word.text.trimEnd();
        const gap = word.text.slice(label.length);
        if (i === selectedIndex) {
          return <Text key={i}><Text backgroundColor="white" color="black">{label}</Text>{gap}</Text>;
        }
        const sung = positionMs !== undefined && word.start !== null && word.start <= positionMs;
        return <Text key={i} color={sung ? "cyan" : undefined}>{word.text}</Text>;
      })}
    </Text>
  );
}
