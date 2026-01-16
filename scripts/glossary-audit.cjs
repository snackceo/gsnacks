// scripts/glossary-audit.cjs
// Node.js script to audit business terms and auto-insert missing glossary templates

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Config
const GLOSSARY_PATH = path.resolve(__dirname, '../GLOSSARY.md');
const AUTO_SECTION_HEADER = '## [AUTO-GENERATED: Review and Complete]';

// Helper: Recursively get all relevant files
function getAllFiles() {
  return glob.sync(path.resolve(__dirname, '../**/*.{js,ts,tsx,md}'), {
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.git/**',
      '**/scripts/**', // Don't scan this script
    ],
    nodir: true,
  });
}

// Helper: Extract candidate terms from file content
function extractTerms(content) {
  const terms = new Set();
  // Identifiers: camelCase, PascalCase, UPPER_CASE, kebab-case
  const idRegex = /\b([A-Z][a-zA-Z0-9]+|[a-z]+[A-Z][a-zA-Z0-9]+|[A-Z_]{2,}|[a-z0-9]+-[a-z0-9-]+)\b/g;
  let match;
  while ((match = idRegex.exec(content))) {
    terms.add(match[1]);
  }
  // Markdown headings and bolded terms
  const mdHeading = /^#+\s+([A-Za-z0-9 _-]{3,})/gm;
  while ((match = mdHeading.exec(content))) {
    terms.add(match[1].trim());
  }
  const bolded = /\*\*([A-Za-z0-9 _-]{3,})\*\*/g;
  while ((match = bolded.exec(content))) {
    terms.add(match[1].trim());
  }
  return terms;
}

// Helper: Parse glossary terms
function parseGlossaryTerms(glossaryText) {
  const terms = new Set();
  // Match: term (type):
  const entryRegex = /^([A-Za-z0-9 _-]+) \([^)]+\):/gm;
  let match;
  while ((match = entryRegex.exec(glossaryText))) {
    terms.add(match[1].trim());
  }
  return terms;
}

// Helper: Insert templates into glossary
function insertTemplates(glossaryText, templates) {
  let newGlossary = glossaryText;
  if (!glossaryText.includes(AUTO_SECTION_HEADER)) {
    newGlossary += `\n\n${AUTO_SECTION_HEADER}\n`;
  }
  // Insert after header
  const idx = newGlossary.indexOf(AUTO_SECTION_HEADER) + AUTO_SECTION_HEADER.length;
  const before = newGlossary.slice(0, idx);
  const after = newGlossary.slice(idx);
  const templateText = templates.map(t => `\n${t} (type): [Add definition here. Usage/context: ...]`).join('');
  return before + templateText + after;
}

// Main
function main() {
  const files = getAllFiles();
  const allTerms = new Set();
  files.forEach(file => {
    // Add base file name (without extension) as a candidate term
    const baseName = path.basename(file, path.extname(file));
    // Add all file names, regardless of format
    allTerms.add(baseName);
    const content = fs.readFileSync(file, 'utf8');
    extractTerms(content).forEach(t => allTerms.add(t));
  });
  const glossaryText = fs.readFileSync(GLOSSARY_PATH, 'utf8');
  const glossaryTerms = parseGlossaryTerms(glossaryText);
  // Only add terms not already in glossary
  const missing = Array.from(allTerms).filter(t => !glossaryTerms.has(t));
  if (missing.length === 0) {
    console.log('No missing terms found. Glossary is up to date.');
    return;
  }
  // Avoid duplicate insertions
  const autoSection = glossaryText.includes(AUTO_SECTION_HEADER)
    ? glossaryText.split(AUTO_SECTION_HEADER)[1]
    : '';
  const alreadyInserted = new Set();
  if (autoSection) {
    const autoRegex = /^([A-Za-z0-9 _-]+) \(type\):/gm;
    let match;
    while ((match = autoRegex.exec(autoSection))) {
      alreadyInserted.add(match[1].trim());
    }
  }
  const toInsert = missing.filter(t => !alreadyInserted.has(t));
  if (toInsert.length === 0) {
    console.log('No new missing terms to insert.');
    return;
  }
  const updatedGlossary = insertTemplates(glossaryText, toInsert);
  fs.writeFileSync(GLOSSARY_PATH, updatedGlossary, 'utf8');
  console.log(`Inserted ${toInsert.length} missing term templates into GLOSSARY.md under [AUTO-GENERATED: Review and Complete].`);
}

main();
