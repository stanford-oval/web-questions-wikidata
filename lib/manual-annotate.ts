import * as argparse from 'argparse';
import * as fs from 'fs';
import * as events from 'events';
import * as readline from 'readline';
import {
    WebQuestionExample,
    loadExample,
    preprocessWebQuestionsSparql,
    WebQuestionAnswer
} from './utils/web-questions';
import {
    ENTITY_PREFIX,
    PROPERTY_PREFIX
} from './utils/wikidata';
import { Normalizer } from './sparql-normalizer';
import WikidataUtils from './utils/wikidata';
import { FB2WDMapper } from './utils/mappings';

class Annotator extends events.EventEmitter {
    private _ex ?: WebQuestionExample;
    private _rl : readline.Interface;
    private _nextExample : Iterator<WebQuestionExample>;
    private _sparql : string[];
    private _answers : WebQuestionAnswer[];
    private _wikidata : WikidataUtils;
    private _normalizer : Normalizer;
    private _mapper : FB2WDMapper;

    constructor(rl : readline.Interface, 
                examples : WebQuestionExample[], 
                skipped : WebQuestionExample[]) {
        super();

        this._ex = undefined;
        this._rl = rl;
        this._nextExample = [...examples, ...skipped][Symbol.iterator]();
        this._sparql = [];
        this._answers = [];
        this._wikidata = new WikidataUtils('wikidata.sqlite');
        this._normalizer = new Normalizer();
        this._mapper = new FB2WDMapper();

        rl.on('line', async (line) => {
            // an empty line indicates a SPARQL is finished, run test
            if (line.trim().length === 0) {
                await this._testSparql(this._sparql.join(' '));
                return;
            }
            // drop an example, and continue to the next one
            if (line === 'd' || line.startsWith('d ')) {
                if (line.length > 1)
                    this._ex!.Comment = line.substring(2).trim();
                this.emit('dropped', this._ex);
                this.next();
                return;
            }
            // skip an example, and continue to the next one
            if (line === 's' || line.startsWith('s ')) {
                if (line.length > 1)
                    this._ex!.Comment = line.substring(2).trim();
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
            if (line === 'y' || line.startsWith('y ')) {
                console.log('Example annotated.\n');
                this._ex!.Parses[0].Sparql = this._normalizeSparql(this._sparql.join(' '), true);
                this._ex!.Parses[0].Answers = this._answers;
                if (line.length > 1)
                    this._ex!.Comment = line.substring(2).trim();
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
            const normalized = this._normalizeSparql(sparql, false);
            console.log('After normalization:\n' + normalized);
            const response = await this._wikidata.query(sparql);
            this._answers = [];
            for (const item of response) {
                const values : any[] = Object.values(item);
                for (const v of values) {
                    if (v.value.startsWith(ENTITY_PREFIX)) {
                        const qid = v.value.slice(ENTITY_PREFIX.length);
                        const label = await this._wikidata.getLabel(qid);
                        this._answers.push({
                            AnswerType: 'Entity',
                            AnswerArgument: qid,
                            EntityName: label
                        });
                    } else {
                        this._answers.push({
                            AnswerType: 'Value',
                            AnswerArgument: v.value,
                            EntityName: null
                        });
                    }
                }
            }
            const wdAnswers = this._answers.map((a) => a.EntityName ?? a.AnswerArgument);
            console.log('Wikidata answers:', wdAnswers.join(', '));
            const fbAnswers = this._ex!.Parses[0].Answers.map((a) => a.EntityName ?? a.AnswerArgument);
            console.log('Freebase answers:', fbAnswers.join(', '));
            console.log('\nDoes the result look good? y/n/s/d');
        } catch(e) {
            console.log('Failed to run the SPARQL: ', (e as Error).message);
            console.log('Try rewrite the SPARQL.\n');
            this._init();
        }
    }

    private _normalizeSparql(sparql : string, oneline : boolean) {
        return this._normalizer.normalize(sparql, oneline);
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
        const hinted = new Set();
        const entities = sparql.match(/(?<=ns:)m\.[^\s()\\]*/g) ?? [];
        for (const entity of entities) {
            if (hinted.has(entity))
                continue;
            if (this._mapper.hasEntity(entity)) {
                hinted.add(entity);
                const wdEntity = this._mapper.map(entity)!;
                const label = await this._wikidata.getLabel(wdEntity);
                console.log(`${entity}: ${label} (${ENTITY_PREFIX + wdEntity})`);
            } else {
                const wdEntity = await this._wikidata.getEntityByFreebaseId(entity);
                if (wdEntity) {
                    hinted.add(entity);
                    const label = await this._wikidata.getLabel(wdEntity);
                    console.log(`${entity}: ${label} (${ENTITY_PREFIX + wdEntity})`);
                }
            }
        }
        const properties = sparql.match(/(?<=ns:)(?!m\.)[^\s()\\]+/g) ?? [];
        for (const property of properties) {
            if (hinted.has(property))
                continue;
            const reverse = this._mapper.hasReverseProperty(property);
            if (this._mapper.hasProperty(property) || reverse) {
                hinted.add(property);
                const wdProperty = this._mapper.map(property)!;
                const label = await this._wikidata.getLabel(wdProperty);
                console.log(`${property}: ${label} (${PROPERTY_PREFIX + wdProperty}) ${reverse ? '(reverse)': ''}`);
            }
        }
        // output a new line break
        if (hinted.size > 0)
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
            `"s $comment": skip the example with some comment.` + 
            `"y": accept the annotation` +
            `"y $comment": accept the annotation with some comment`
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
        console.log('\n');
        console.log(`Annotated: ${annotated.length}`);
        console.log(`Dropped: ${dropped.length}`);
        console.log(`Skipped: ${skipped.length}`);
        fs.writeFileSync(args.annotated, JSON.stringify(annotated, null, 2));
        fs.writeFileSync(args.dropped, JSON.stringify(dropped, null, 2));
        fs.writeFileSync(args.skipped, JSON.stringify(skipped, null, 2));
        console.log('\nBye\n');
        rl.close();
    }
    
    function updateSkipped(ex : WebQuestionExample) {
        const index = skipped.findIndex((s) => s.QuestionId === ex.QuestionId);
        if (index !== -1) 
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