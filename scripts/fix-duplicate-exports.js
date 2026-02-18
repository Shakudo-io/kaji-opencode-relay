import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distDir = path.join(__dirname, '..', 'dist');

function extractExportNames(exportLine) {
  const match = exportLine.match(/export\s*\{([^}]+)\}/);
  if (!match) return new Set();
  return new Set(match[1].split(',').map(n => n.trim()).filter(Boolean));
}

function fixFile(filePath) {
  if (!fs.existsSync(filePath) || !filePath.endsWith('.js')) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const exportBlocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('export {')) continue;
    
    if (lines[i].includes('}')) {
      exportBlocks.push({ start: i, end: i, names: extractExportNames(lines[i]) });
    } else {
      let blockContent = lines[i];
      let j = i + 1;
      while (j < lines.length && !lines[j].includes('}')) {
        blockContent += ' ' + lines[j];
        j++;
      }
      if (j < lines.length) blockContent += ' ' + lines[j];
      exportBlocks.push({ start: i, end: j, names: extractExportNames(blockContent) });
    }
  }

  if (exportBlocks.length <= 1) return;

  const allNames = new Set();
  for (const block of exportBlocks) {
    for (const name of block.names) allNames.add(name);
  }

  for (let i = exportBlocks.length - 1; i >= 0; i--) {
    const block = exportBlocks[i];
    for (let j = block.end; j >= block.start; j--) {
      lines.splice(j, 1);
    }
  }

  const mergedExport = `export {\n  ${[...allNames].join(',\n  ')}\n};`;
  lines.push(mergedExport, '');

  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(`Merged ${exportBlocks.length} export blocks (${allNames.size} names) in ${path.basename(filePath)}`);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) fixFile(full);
  }
}

walk(distDir);
