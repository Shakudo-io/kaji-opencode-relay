import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distDir = path.join(__dirname, '..', 'dist');

function fixFile(filePath) {
  if (!fs.existsSync(filePath) || !filePath.endsWith('.js')) return;
  let content = fs.readFileSync(filePath, 'utf8');
  
  const singleLineExportRe = /^export \{[^}]+\};\s*$/gm;
  const matches = [...content.matchAll(singleLineExportRe)];
  
  if (matches.length === 0) return;
  
  const lastMatch = matches[matches.length - 1];
  const before = content.slice(0, lastMatch.index);
  const hasBlockExport = /export \{\n/m.test(before);
  
  if (!hasBlockExport) return;
  
  content = content.slice(0, lastMatch.index) + content.slice(lastMatch.index + lastMatch[0].length);
  fs.writeFileSync(filePath, content);
  console.log(`Fixed duplicate exports in ${path.basename(filePath)}`);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) fixFile(full);
  }
}

walk(distDir);
