import * as fs from 'fs';
import assert from 'assert';
import FB2WDConverter from '../lib/fb2wd';

function normalize(sparql : string|null) {
    if (!sparql)
        return null;
    return sparql.replace(/\s+/g, ' ').trim();
}

async function main() {
    const converter = new FB2WDConverter();
    const tests = fs.readFileSync('./test/tests.txt', 'utf-8').split('====');
    for (let i = 0; i < tests.length; i++) {
        console.log(`Running test ${i+1} ...`);
        const test = tests[i];
        const fbSparql = test.slice(test.indexOf('Freebase:') + 'Freebase:'.length, test.indexOf('Wikidata:')).trim();
        const wdSparql = test.slice(test.indexOf('Wikidata:') + 'Wikidata:'.length).trim();

        const converted = converter.convert(fbSparql);
        assert.strictEqual(normalize(converted), normalize(wdSparql));
    }
}

main();