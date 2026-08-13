const fs = require("fs");
const path = require("path");
const express = require("express");

const router = express.Router();

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  let listOpen = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      htmlParts.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      htmlParts.push("</ul>");
      listOpen = false;
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
      if (!listOpen) {
        htmlParts.push("<ul>");
        listOpen = true;
      }
      htmlParts.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return htmlParts.join("\n");
}

function renderLegalPage(title, mdPath) {
  return (req, res) => {
    let markdown;
    try {
      markdown = fs.readFileSync(mdPath, "utf8");
    } catch (err) {
      return res.status(404).send("Not found");
    }
    const body = markdownToHtml(markdown);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Bes</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 1.8rem; }
  h2 { font-size: 1.3rem; margin-top: 2rem; }
  h3 { font-size: 1.1rem; }
  a { color: #ef445b; }
  ul { padding-left: 1.4rem; }
</style>
</head>
<body>
${body}
</body>
</html>`);
  };
}

const legalRoot = path.join(__dirname, "..", "legal");

router.get("/privacy", renderLegalPage("Privacy Policy", path.join(legalRoot, "privacy-policy.md")));
router.get("/terms", renderLegalPage("Terms of Service", path.join(legalRoot, "terms-of-service.md")));
router.get("/data-deletion", renderLegalPage("Delete Your Data", path.join(legalRoot, "data-deletion.md")));

module.exports = router;
