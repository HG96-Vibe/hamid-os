#!/bin/sh
# Rebuilds /create-editor.js and /create-docx.js from the pinned packages in package-lock.json.
set -e
cd "$(dirname "$0")"
npm ci --no-audit --no-fund
npx esbuild editor.js --bundle --minify --format=iife --target=es2020 --legal-comments=eof --outfile=../../create-editor.js
npx esbuild docx.js --bundle --minify --format=iife --target=es2020 --legal-comments=eof --outfile=../../create-docx.js
