import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distDir = path.join(__dirname, '..', 'dist');

function fixFile(filePath) {
  if (!fs.existsSync(filePath) || !filePath.endsWith('.js')) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const exportBlockIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('export {')) {
      exportBlockIndices.push(i);
    }
  }
  
  if (exportBlockIndices.length <= 1) return;
  
  // Remove all but the first export block
  for (let j = exportBlockIndices.length - 1; j >= 1; j--) {
    lines.splice(exportBlockIndices[j], 1);
  }
  
  fs.writeFileSync(filePath, lines.join('\n'));
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
