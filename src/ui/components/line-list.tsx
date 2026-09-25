import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import type { LrcLine } from "../../core/lrc-document";
import { hasWordTimings } from "../../core/lrc-document";
import { msToLrc } from "../../core/time-utils";

interface LineListProps {
  lines: LrcLine[];
  currentIndex: number;
  visibleCount?: number;
  currentLineOverride?: ReactNode;
}

/** "[00:12.00] " — once any line has word timings, those lines get a "*" and the rest a space to stay aligned. */
export function timeLabel(line: LrcLine, markWords: boolean): string {
  const time = line.timestamp !== null ? `[${msToLrc(line.timestamp)}]` : "[  ?.??  ]";
  if (!markWords) return `${time} `;
  return `${time}${hasWordTimings(line) ? "*" : " "} `;
}

export function LineList({ lines, currentIndex, visibleCount = 7, currentLineOverride }: LineListProps) {
  const half = Math.floor(visibleCount / 2);
  let start = Math.max(0, currentIndex - half);
  const end = Math.min(lines.length, start + visibleCount);
  if (end - start < visibleCount) {
    start = Math.max(0, end - visibleCount);
  }
  const visible = lines.slice(start, end);
  const markWords = lines.some(hasWordTimings);
  return (
    <Box flexDirection="column">
      {visible.map((line, i) => {
        const actualIndex = start + i;
        const isCurrent = actualIndex === currentIndex;
        const prefix = isCurrent ? "▸ " : "  ";

        if (isCurrent && currentLineOverride) {
          return (
            <Box key={actualIndex}>
              <Text bold color="cyan">{prefix}</Text>
              {currentLineOverride}
            </Box>
          );
        }

        return (
          <Text key={actualIndex} bold={isCurrent} color={isCurrent ? "cyan" : undefined}>
            {prefix}{timeLabel(line, markWords)}{line.text}
          </Text>
        );
      })}
    </Box>
  );
}
