const fs = require("fs");
const path = require("path");
const express = require("express");

// The React build, produced by `npm run build:web` (Render build command).
const BUILD_DIR = process.env.WEB_BUILD_DIR || path.join(__dirname, "..", "..", "attendance-frontend", "build");

/**
 * Serves the website from this server when a build exists:
 * - /static/* files have content hashes in their names, so browsers keep them for a year;
 * - index.html is never cached, so a new deploy shows up on the next load;
 * - any other GET outside /api returns index.html (React Router handles the page).
 * Returns true when the website is being served.
 */
const serveWebsite = (app) => {
  const indexFile = path.join(BUILD_DIR, "index.html");
  if (!fs.existsSync(indexFile)) return false;

  app.use(
    express.static(BUILD_DIR, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}static${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });
  return true;
};

module.exports = serveWebsite;
module.exports.BUILD_DIR = BUILD_DIR;
