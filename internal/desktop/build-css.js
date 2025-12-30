const postcss = require("postcss");
const tailwindcss = require("@tailwindcss/postcss");
const autoprefixer = require("autoprefixer");
const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "src/globals.css");
const distDir = path.join(__dirname, "dist");
const outputFile = path.join(distDir, "welcome.css");

// Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

const css = fs.readFileSync(inputFile, "utf8");

postcss([tailwindcss, autoprefixer])
  .process(css, { from: inputFile, to: outputFile })
  .then((result) => {
    fs.writeFileSync(outputFile, result.css);
    console.log("✓ CSS built successfully");
  })
  .catch((err) => {
    console.error("Error building CSS:", err);
    process.exit(1);
  });
