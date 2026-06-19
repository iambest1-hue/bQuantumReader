// Markdown generator for extracted video content

import { formatDuration, formatTimestamp } from './bilibili-api.js';

export function generateMarkdown({ title, url, upName, duration, pubdate, subtitles, segments, comments }) {
  const lines = [];

  // Header
  lines.push(`# ${title}`);
  lines.push('');

  // Metadata block
  const metaLines = [];
  metaLines.push(`来源: ${url}`);
  const metaParts = [];
  if (upName) metaParts.push(`UP主: ${upName}`);
  if (duration) metaParts.push(`时长: ${duration}`);
  if (pubdate) metaParts.push(`日期: ${pubdate}`);
  if (metaParts.length > 0) metaLines.push(metaParts.join(' | '));
  metaLines.push(`提取时间: ${new Date().toISOString().slice(0, 10)}`);

  for (const line of metaLines) {
    lines.push(`> ${line}`);
  }
  lines.push('');

  // If AI segments are provided, use structured format
  if (segments && segments.length > 0) {
    for (const segment of segments) {
      lines.push(`## ${segment.title}`);
      lines.push('');
      if (segment.entries && segment.entries.length > 0) {
        for (const entry of segment.entries) {
          const ts = formatTimestamp(entry.from);
          lines.push(`[${ts}] ${entry.content}`);
        }
      } else if (segment.content) {
        lines.push(segment.content);
      }
      lines.push('');
    }
  } else if (subtitles && subtitles.length > 0) {
    // Fallback: raw timestamp-based layout
    for (const sub of subtitles) {
      const ts = formatTimestamp(sub.from);
      lines.push(`[${ts}] ${sub.content}`);
    }
    lines.push('');
  }

  // Comments section
  if (comments && comments.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 💬 视频评论');
    lines.push('');
    lines.push(`> 共 ${comments.length} 条评论（按时间正序）`);
    lines.push('');

    for (const c of comments) {
      const date = new Date(c.time * 1000).toISOString().slice(0, 19).replace('T', ' ');
      lines.push(`- **${c.user}** (${date})`);
      lines.push(`  ${c.content}`);
      if (c.likes > 0) {
        lines.push(`  *👍 ${c.likes}*`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
