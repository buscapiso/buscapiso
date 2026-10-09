// Ayudantes de test: fixtures HTML y ficheros dorados del motor Python.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/engine');
export const fixture = (name: string) => readFileSync(resolve(DIR, '__fixtures__', name), 'utf-8');
export const golden = (name: string) => JSON.parse(readFileSync(resolve(DIR, '__golden__', `${name}.json`), 'utf-8'));
