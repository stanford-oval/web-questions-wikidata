import fs from 'fs';
import * as argparse from 'argparse';
import { 
    Parser, 
    SparqlParser, 
    Generator,
    SparqlGenerator
} from 'sparqljs';
import {
    PREFIXES
} from './utils/wikidata';
import {
    WebQuestionExample
} from './utils/web-questions';

export class Normalizer {
    private parser : SparqlParser;
    private generator : SparqlGenerator;

    constructor() {
        this.parser = new Parser({ prefixes: PREFIXES });
        this.generator = new Generator({ prefixes: PREFIXES });
    }

    normalize(sparql : string, oneline = true) {
        sparql = this.generator.stringify(this.parser.parse(sparql));
        // remove prefixes:
        sparql = sparql.replace(/PREFIX [\w]+: <[^>]+\s*>/g, '').trim();
        // replace parenthesis around variables for order by and group by
        sparql = sparql.replace(/ORDER BY \((\?[^)]+)\)/g, 'ORDER BY $1');
        sparql = sparql.replace(/GROUP BY \((\?[^)]+)\)/g, 'GROUP BY $1');
        // remove parenthesis around property path
        const matches = sparql.matchAll(/ ([(]+(wdt:|p:|ps:|pq:)[^)]+[)]+) /g);
        for (const match of matches)
            sparql = sparql.split(match[1]).join(match[1].replace(/\(|\)/g, ''));
        // remove line breaks and indents
        if (oneline)
            sparql = sparql.replace(/\s+/g, ' ');
        return sparql;
    }
}

async function main() {
    const parser = new argparse.ArgumentParser({
        add_help: true,
        description: "Normalize SPARQL in the annotated data"
    });
    parser.add_argument('input', {
        help: "Path to the annotated data"
    });
    const args = parser.parse_args();
    const data : WebQuestionExample[] = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    const normalizer = new Normalizer();

    for (const ex of data) {
        const sparql = ex.Parses[0].Sparql;
        const normalized = normalizer.normalize(sparql);
        ex.Parses[0].Sparql = normalized;
    }
    fs.writeFileSync(args.input, JSON.stringify(data, null, 2));
}

if (require.main === module)
    main();