import fs from 'fs';
import path from 'path';
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const controllersDir = path.resolve(__dirname, '../controllers');
const modelsDir = path.resolve(__dirname, '../models');

test('Architectural Contract Tests', async (t) => {
    await t.test('Controllers should not import DB models directly', () => {
        const controllerFiles = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));
        const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));

        const errors = [];

        for (const controllerFile of controllerFiles) {
            const filePath = path.join(controllersDir, controllerFile);
            const content = fs.readFileSync(filePath, 'utf8');

            for (const modelFile of modelFiles) {
                const importRegex = new RegExp(`from '../models/${modelFile}.js'`);
                if (importRegex.test(content)) {
                    errors.push(`Controller ${controllerFile} directly imports model ${modelFile}.js. This is not allowed. Please use a service instead.`);
                }
            }
        }

        assert.strictEqual(errors.length, 0, errors.join(`
`));
    });

    // More contract tests to be added here...
});
