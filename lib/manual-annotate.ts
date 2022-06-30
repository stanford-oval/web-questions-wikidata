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
    PREFIXES,
    PROPERTY_PREFIX
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

    constructor(rl : readline.Interface, examples : Array<WebQuestionExample>) {
        super();

        this._ex = undefined;
        this._rl = rl;
        this._nextExample = examples[Symbol.iterator]();
        this._sparql = [];
        this._parser = new Parser();
        this._generator = new Generator();
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
        const parsed = this._parser.parse(PREFIXES.join('\n') + ' ' + sparql);
        const normalized = this._generator.stringify(parsed);
        return normalized;
    }

    private _init() {
        this._sparql = ['SELECT DISTINCT'];
        this._rl.setPrompt('SELECT DISTINCT ');
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
        const entities = /(?<=ns:)m\.[^\s\(\)\\]*/g.exec(sparql) ?? [];
        for (const entity of entities) {
            if (this._mapper.hasEntity(entity)) {
                hasHint = true;
                const wdEntity = this._mapper.map(entity)!;
                const label = await this._wikidata.getLabel(wdEntity);
                console.log(`${entity}: ${label} (${wdEntity})`);
            }
        }
        const properties = /(?<=ns:)(?!m\.)[^\s\(\)\\]+/g.exec(sparql) ?? [];
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
            `"d": drop the example,` +
            `"d $comment": drop the example with some comment.`
    });
    parser.add_argument('--annotated', {
        required: false,
        default: './annotated.tsv',
    });
    parser.add_argument('--dropped', {
        required: false,
        default: './dropped.tsv',
    });
    parser.add_argument('input', {
        help: `The script expects a tsv input file with columns: id, utterance, preprocessed, target_code`
    });

    const args = parser.parse_args();
    const webQuestions = JSON.parse(fs.readFileSync(args.input, 'utf-8'));

    // if file exists, load the existing annotated/dropped files
    const annotated : Array<WebQuestionExample> =   
        fs.existsSync(args.annotated) ? JSON.parse(fs.readFileSync(args.annotated, 'utf-8')) : [];
    const dropped : Array<WebQuestionExample> = 
        fs.existsSync(args.dropped) ? JSON.parse(fs.readFileSync(args.dropped, 'utf-8')) : [];

    // offset examples based on the the length of annotated and dropped
    const examples : Array<WebQuestionExample> = webQuestions.Questions.slice(annotated.length + dropped.length);
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const annotator = new Annotator(rl, examples);
    annotator.next();

    function quit() {
        fs.writeFileSync(args.annotated, JSON.stringify(annotated, null, 2));
        fs.writeFileSync(args.dropped, JSON.stringify(dropped, null, 2));
        console.log('\nBye\n');
        rl.close();
    }
    annotator.on('end', quit);
    annotator.on('annotated', (ex : WebQuestionExample) => {
        annotated.push(ex);
    });
    annotator.on('dropped', (ex : WebQuestionExample) => {
        dropped.push(ex);
    });
    rl.on('SIGINT', quit);
}

if (require.main === module)
    main();