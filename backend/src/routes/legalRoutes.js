const fs = require("fs");
const path = require("path");
const express = require("express");

const { markdownToHtml, renderPageHtml } = require("../utils/pageShell");

const router = express.Router();

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
    res.send(renderPageHtml(title, body));
  };
}

const legalRoot = path.join(__dirname, "..", "legal");

router.get("/privacy", renderLegalPage("Privacy Policy", path.join(legalRoot, "privacy-policy.md")));
router.get("/terms", renderLegalPage("Terms of Service", path.join(legalRoot, "terms-of-service.md")));
router.get("/data-deletion", renderLegalPage("Delete Your Data", path.join(legalRoot, "data-deletion.md")));

module.exports = router;
