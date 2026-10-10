// Shared HTML page rendering for the public, server-rendered pages (legal
// pages, SMS consent, the SMS program page). Self-contained: inline CSS
// only, no external scripts, fonts or images.

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[(.+?)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function markdownToHtml(markdown) {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lines = withoutComments.split("\n");
  const htmlParts = [];
  let listOpen = false; // false | "ul" | "ol"
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      htmlParts.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      htmlParts.push(`</${listOpen}>`);
      listOpen = false;
    }
  };
  const openList = (kind) => {
    if (listOpen !== kind) {
      closeList();
      htmlParts.push(`<${kind}>`);
      listOpen = kind;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      openList("ul");
      htmlParts.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      openList("ol");
      htmlParts.push(`<li>${inline(orderedMatch[1])}</li>`);
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      closeList();
      htmlParts.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return htmlParts.join("\n");
}

function renderPageHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Bes</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 1.8rem; }
  h2 { font-size: 1.3rem; margin-top: 2rem; }
  h3 { font-size: 1.1rem; }
  a { color: #ef445b; }
  ul, ol { padding-left: 1.4rem; }
  blockquote { margin: 12px 0; padding: 10px 16px; border-left: 4px solid #ef445b; background: #fafafa; }
  .card { border: 1px solid #e5e5e5; border-radius: 14px; padding: 18px 20px; margin: 18px 0; background: #fafafa; }
  .muted { color: #555; font-size: 0.95rem; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
  button { font: inherit; font-weight: 700; border-radius: 12px; padding: 12px 22px; cursor: pointer; }
  .primary { background: #ef445b; color: #fff; border: 0; }
  .secondary { background: #fff; color: #1a1a1a; border: 1px solid #bbb; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

module.exports = { escapeHtml, inline, markdownToHtml, renderPageHtml };
