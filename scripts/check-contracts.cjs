const fs = require('fs');
const path = require('path');

const contractsDir = path.resolve(__dirname, '../contracts');
const routesDir = path.resolve(__dirname, '../server/routes');

function checkRawStrings(routesDir, errors) {
    const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    const rawStringRegex = /router\.(get|post|put|delete|patch)\s*\(\s*(['"`])/;

    const refactoredFiles = ['receipts.js', 'receipt-prices.js'];

    for (const file of routeFiles) {
        if (refactoredFiles.includes(file)) {
            continue;
        }
        const filePath = path.join(routesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        if (rawStringRegex.test(content)) {
            errors.push(`Raw string route found in ${file}. Please refactor to use constants from contracts/naming.ts.`);
        }
    }
}

function main() {
    console.log('Running contract checks...');

    // 1. Read contract files
    const apiMatrix = JSON.parse(fs.readFileSync(path.join(contractsDir, 'api.matrix.json'), 'utf8'));
    const namingFileContent = fs.readFileSync(path.join(contractsDir, 'naming.ts'), 'utf8');
    const glossaryContent = fs.readFileSync(path.join(contractsDir, 'glossary.md'), 'utf8');

    // 2. Perform validations
    const errors = [];

    // Validation: No duplicate naming in naming.ts
    const namingConstants = namingFileContent.match(/export const \w+ = {([^}]+)}/g);
    if (namingConstants) {
        const allValues = namingConstants.flatMap(c => {
            const block = c.match(/{([^}]+)}/)[1];
            return block.split(',').map(s => s.split(':')[1].trim().replace(/"/g, ''));
        });
        const uniqueValues = new Set(allValues);
        if (allValues.length !== uniqueValues.size) {
            errors.push('Duplicate route definitions found in contracts/naming.ts');
        }
    }

    checkRawStrings(routesDir, errors);

    // More validations to be added here...

    if (errors.length > 0) {
        console.error('Contract violations found:');
        errors.forEach(err => console.error(`- ${err}`));
        process.exit(1);
    }

    console.log('All contract checks passed!');
}

main();
