export function toJiraStartedFormat(startedAtLocalIso: string): string {
  const match = startedAtLocalIso.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
  );

  if (match) {
    const [, timestamp, rawOffset] = match;
    const offset = rawOffset === 'Z' ? '+0000' : rawOffset.replace(':', '');
    return `${timestamp}.000${offset}`;
  }

  const parsed = new Date(startedAtLocalIso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Jira worklog start time: ${startedAtLocalIso}`);
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, '.000+0000');
}

export function buildAdfComment(text: string): Record<string, unknown> {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const content = (paragraphs.length > 0 ? paragraphs : ['']).map((paragraph) => ({
    type: 'paragraph',
    content: paragraph
      ? paragraph.split('\n').flatMap((line, index) => {
          const nodes: Record<string, unknown>[] = [];
          if (index > 0) {
            nodes.push({ type: 'hardBreak' });
          }
          if (line) {
            nodes.push({
              type: 'text',
              text: line,
            });
          }
          return nodes;
        })
      : [],
  }));

  return {
    type: 'doc',
    version: 1,
    content,
  };
}

export function buildWorklogPayload(
  startedAtLocalIso: string,
  durationSeconds: number,
  commentText: string
): Record<string, unknown> {
  return {
    comment: buildAdfComment(commentText),
    started: toJiraStartedFormat(startedAtLocalIso),
    timeSpentSeconds: durationSeconds,
  };
}
