import * as argparse from 'argparse';
import * as fs from 'fs';
import * as events from 'events';
import * as readline from 'readline';
import {
    WebQuestionExample,
    loadExample,
    preprocessWebQuestionsSparql
} from './utils/web-questions';
import { 
    Parser, 
    SparqlParser, 
    Generator,
    SparqlGenerator
} from 'sparqljs';
import {
    ENTITY_PREFIX,
    PROPERTY_PREFIX,
    PREFIXES,
    postprocessSparql
} from './utils/wikidata';
import WikidataUtils from './utils/wikidata';
import { FB2WDMapper } from './utils/mappings';

class Annotator extends events.EventEmitter {
    private _ex ?: WebQuestionExample;
    private _rl : readline.Interface;
    private _nextExample : Iterator<WebQuestionExample>;
    private _sparql : string[];
    private _parser : SparqlParser;
    private _generator : SparqlGenerator;
    private _wikidata : WikidataUtils;
    private _mapper : FB2WDMapper;

    constructor(rl : readline.Interface, 
                examples : WebQuestionExample[], 
                skipped : WebQuestionExample[]) {
        super();

        this._ex = undefined;
        this._rl = rl;
        this._nextExample = [...examples, ...skipped][Symbol.iterator]();
        this._sparql = [];
        this._parser = new Parser({ prefixes: PREFIXES });
        this._generator = new Generator({ prefixes: PREFIXES });
        this._wikidata = new WikidataUtils('wikidata.sqlite');
        this._mapper = new FB2WDMapper();

        rl.on('line', async (line) => {
            // an empty line indicates a SPARQL is finished, run test
            if (line.trim().length === 0) {
                await this._testSparql(this._sparql.join(' '));
                return;
            }
            // drop an example, and continue to the next one
            if (line === 'd' || line.startsWith('d ')) {
                this._ex!.comment = line.substring(2).trim();
                this.emit('dropped', this._ex);
                this.next();
                return;
            }
            // skip an example, and continue to the next one
            if (line === 's' || line.startsWith('s ')) {
                this._ex!.comment = line.substring(2).trim();
                this.emit('skipped', this._ex);
                this.next();
                return;
            }
            // reject an annotation, restart the same example
            if (line === 'n') {
                this._init();
                return;
            }
            // accept an annotation, and continue to the next example
            if (line === 'y') {
                console.log('Example annotated.\n');
                this._ex!.Parses[0].Sparql = this._sparql.join(' ');
                this.emit('annotated', this._ex);
                this.next();
                return;
            }
            // in progress of writing a SPARQL query 
            rl.setPrompt('');
            this._sparql.push(line.trim());
        });
    }

    private async _testSparql(sparql : string) {
        try {
            const normalized = this._normalizeSparql(sparql);
            console.log('After normalization:\n' + normalized);
            const response = await this._wikidata.query(sparql);
            const wdAnswers = [];
            for (const item of response) {
                const values : any[] = Object.values(item);
                for (const v of values) {
                    if (v.value.startsWith(ENTITY_PREFIX))
                        wdAnswers.push(await this._wikidata.getLabel(v.value.slice(ENTITY_PREFIX.length)));
                    else if (v.value.startsWith(PROPERTY_PREFIX))
                        wdAnswers.push(await this._wikidata.getLabel(v.value.slice(PROPERTY_PREFIX.length)));
                    else 
                        wdAnswers.push(v.value);
                }
            }
            console.log('Wikidata answers:', wdAnswers.flat().join(', '));
            const fbAnswers = this._ex!.Parses[0].Answers.map((a) => a.EntityName ?? a.AnswerArgument);
            console.log('Freebase answers:', fbAnswers.join(', '));
            console.log('\nDoes the result look good? y/n/d');
        } catch(e) {
            console.log('Failed to run the SPARQL: ', (e as Error).message);
            console.log('Try rewrite the SPARQL.\n');
            this._init();
        }
    }

    private _normalizeSparql(sparql : string) {
        const parsed = this._parser.parse(sparql);
        const normalized = this._generator.stringify(parsed);
        return postprocessSparql(normalized);
    }

    private _init() {
        this._sparql = ['SELECT DISTINCT ?x WHERE {'];
        this._rl.setPrompt('SELECT DISTINCT ?x WHERE { ');
        this._rl.prompt();
    }

    next() {
        this._next().catch((e) => this.emit('error', e));
    }

    private async _next() {
        const { value: example, done } = this._nextExample.next();
        if (done) {
            this.emit('end');
            return;
        }
        this._ex = loadExample(example);
        const sparql = preprocessWebQuestionsSparql(example.Parses[0].Sparql).trim();
        console.log('------');
        console.log('Example ID: ', example.QuestionId);
        console.log('Question: ', example.RawQuestion);
        console.log('SPARQL: ', sparql, '\n');
        await this._hint(sparql);
        this._init();
    }

    private async _hint(sparql : string) {
        let hasHint = false;
        const entities = sparql.match(/(?<=ns:)m\.[^\s()\\]*/g) ?? [];
        for (const entity of entities) {
            if (this._mapper.hasEntity(entity)) {
                hasHint = true;
                const wdEntity = this._mapper.map(entity)!;
                const label = await this._wikidata.getLabel(wdEntity);
                console.log(`${entity}: ${label} (${wdEntity})`);
            } else {
                const wdEntity = await this._wikidata.getEntityByFreebaseId(entity);
                if (wdEntity) {
                    const label = await this._wikidata.getLabel(wdEntity);
                    console.log(`${entity}: ${label} (${wdEntity})`);
                }
            }
        }
        const properties = sparql.match(/(?<=ns:)(?!m\.)[^\s()\\]+/g) ?? [];
        for (const property of properties) {
            const reverse = this._mapper.hasReverseProperty(property);
            if (this._mapper.hasProperty(property) || reverse) {
                hasHint = true;
                const wdProperty = this._mapper.map(property)!;
                const label = await this._wikidata.getLabel(wdProperty);
                console.log(`${property}: ${label} (${wdProperty}) ${reverse ? '(reverse)': ''}`);
            }
        }
        // output a new line break
        if (hasHint)
            console.log('');
    }
}

function main() {
    const parser = new argparse.ArgumentParser({
        add_help: true,
        description: `Manually annotate examples in WebQuestionsSP ` +
            `"d": drop the example (the example can not be annotated),` +
            `"d $comment": drop the example with some comment.` +
            `"s": skip the example (to be annotated later),` +
            `"s $comment": skip the example with some comment.`
    });
    parser.add_argument('input', {
        help: `The script expects a tsv input file with columns: id, utterance, preprocessed, target_code`
    });

    const args = parser.parse_args();
    const data = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    args.annotated = args.input.slice(0, -'.json'.length) + '-annotated.json';
    args.dropped = args.input.slice(0, -'.json'.length) + '-dropped.json';
    args.skipped = args.input.slice(0, -'.json'.length) + '-skipped.json';

    // if file exists, load the existing annotated/dropped files
    const annotated : WebQuestionExample[] =   
        fs.existsSync(args.annotated) ? JSON.parse(fs.readFileSync(args.annotated, 'utf-8')) : [];
    const dropped : WebQuestionExample[] = 
        fs.existsSync(args.dropped) ? JSON.parse(fs.readFileSync(args.dropped, 'utf-8')) : [];
    const skipped : WebQuestionExample[] = 
        fs.existsSync(args.skipped) ? JSON.parse(fs.readFileSync(args.skipped, 'utf-8')) : [];

    // offset examples based on the the length of annotated, dropped, and skipped
    const offset = annotated.length + dropped.length + skipped.length;
    const examples : WebQuestionExample[] = data.slice(offset);
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const annotator = new Annotator(rl, examples, skipped);
    annotator.next();

    function quit() {
        fs.writeFileSync(args.annotated, JSON.stringify(annotated, null, 2));
        fs.writeFileSync(args.dropped, JSON.stringify(dropped, null, 2));
        fs.writeFileSync(args.skipped, JSON.stringify(skipped, null, 2));
        console.log('\nBye\n');
        rl.close();
    }
    
    function updateSkipped(ex : WebQuestionExample) {
        const index = skipped.findIndex((s) => s.QuestionId === ex.QuestionId);
        if (index !== undefined) 
            skipped.splice(index, 1);
    }

    annotator.on('end', quit);
    annotator.on('annotated', (ex : WebQuestionExample) => {
        updateSkipped(ex);
        annotated.push(ex);
    });
    annotator.on('dropped', (ex : WebQuestionExample) => {
        updateSkipped(ex);
        dropped.push(ex);
    });
    annotator.on('skipped', (ex : WebQuestionExample) => {
        updateSkipped(ex);
        skipped.push(ex);
    });
    rl.on('SIGINT', quit);
}

if (require.main === module)
    main();