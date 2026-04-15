const fs = require('fs');
const path = require('path');
const glob = require('glob');

const contractsDir = path.resolve(__dirname, '../contracts');
const serverDir = path.resolve(__dirname, '../server');
const srcDir = path.resolve(__dirname, '../src');

const FORBIDDEN_TERMS = [
    'product id',
    'scan result',
    'receipt job'
];

function main() {
    console.log('Running terminology checks...');

    const errors = [];

    const files = glob.sync('{**/*.js,**/*.ts,**/*.tsx,**/*.md}', {
        cwd: serverDir,
        ignore: ['**/node_modules/**', '**/dist/**'],
        absolute: true
    }).concat(glob.sync('{**/*.js,**/*.ts,**/*.tsx,**/*.md}', {
        cwd: srcDir,
        ignore: ['**/node_modules/**', '**/dist/**'],
        absolute: true
    }));

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const term of FORBIDDEN_TERMS) {
            if (content.toLowerCase().includes(term)) {
                errors.push(`Forbidden term "${term}" found in ${file}`);
            }
        }
    }

    if (errors.length > 0) {
        console.error('Terminology violations found:');
        errors.forEach(err => console.error(`- ${err}`));
        process.exit(1);
    }

    console.log('All terminology checks passed!');
}

main();
