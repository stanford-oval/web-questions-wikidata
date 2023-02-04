import * as argparse from 'argparse';
import * as fs from 'fs';
import * as path from 'path';
import * as events from 'events';
import * as readline from 'readline';

interface Example {
    id : string,
    question : Array<{ language : string, string : string, keywords : string }>,
    query : { sparql : string }
}

class Annotator extends events.EventEmitter {
    private _rl : readline.Interface;
    private _examples : Record<string, Example>;
    private _examplesByPattern : Record<string, Example[]>;
    private _currentExample ?: Example;
    private _similarExamples : Example[];
    private _similarExampleIndex : number;

    constructor(rl : readline.Interface, 
                trainSet : Example[],
                testSet : Example[]) {
        super();
        this._rl = rl;
        this._examples = {};
        this._examplesByPattern = {};
        for (const example of [...trainSet, ...testSet]) {
            this._examples[example.id] = example;
            const pattern = this._pattern(example.query.sparql)[0];
            if (!(pattern in this._examplesByPattern))
                this._examplesByPattern[pattern] = [];
            this._examplesByPattern[pattern].push(example);
        }

        this._similarExamples = [];
        this._similarExampleIndex = -1;

        rl.on('line', async (line) => {
            line = line.trim();
            if (line.length === 0)
                return;

            // If a new example ID is entered, retrieve thingtalk and SPARQL
            if (line.startsWith('train ') || line.startsWith('test ')) {
                const dataset = line.startsWith('train ') ? 'WebQTrn' : 'WebQTest';
                const id = dataset + '-' + line.split(' ')[1];
                if (!(id in this._examples)) {
                    console.log('Invalid ID. Please try again.');
                    this.init();
                    return;
                }
                this._currentExample = this._examples[id];
                this._similarExamples = this._findExamplesWithSamePattern();
                rl.setPrompt('Modify the SPARQL here: ');
                rl.write(this._currentExample.query.sparql.replace(/\s+/, ' '));
                rl.prompt();
                return;
            }

            // Do not apply changes to other examples 
            if (line === 'na') {
                this.init();
                return;
            }

            // Do not apply change to the current example
            if (line === 'n') {
                this._next();
                return;
            }

            // Apply changes to the current
            if (line === 'y') {
                const example = this._similarExamples[this._similarExampleIndex];
                example.query.sparql = this._update(example.query.sparql);
                this._next();
                return;
            }


            // Apply changes to all the rest 
            if (line === 'a') {
                const count = this._similarExamples.length - this._similarExampleIndex;
                while (this._similarExampleIndex < this._similarExamples.length) {
                    const example = this._similarExamples[this._similarExampleIndex];
                    example.query.sparql = this._update(example.query.sparql);
                    this._similarExampleIndex ++;
                }
                console.log(`Updated ${count} examples.\n`);
                this.init();
                return;
            }

            // A new SPARQL is entered
            const updated = line;
            this._currentExample!.query.sparql = updated;
            this._next();
        });
    }

    private _findExamplesWithSamePattern() : Example[] {
        const pattern = this._pattern(this._currentExample!.query.sparql)[0];
        if (!(pattern in this._examplesByPattern))
            return [];
        return this._examplesByPattern[pattern].filter((e) => e.id !== this._currentExample!.id);
    }

    init() {
        this._similarExamples = [];
        this._similarExampleIndex = -1;
        console.log('----------------------------------------------------');
        this._rl.setPrompt('Enter example ID you want to clean: ');
        this._rl.prompt();
    }

    private _next() {
        this._similarExampleIndex ++;
        if (this._similarExamples.length === 0) {
            console.log('No examples with the same pattern found. Done with this update.\n');
            this.init();
        } else if (this._similarExampleIndex < this._similarExamples.length) {
            if (this._similarExampleIndex === 0)
                console.log(`Found ${this._similarExamples.length} examples with the same pattern.\n`);
            const example = this._similarExamples[this._similarExampleIndex];
            console.log('\nDo you want to apply this change to the following example as well?');
            console.log('Utterance: ' + example.question[0].string);
            console.log('SPARQL: ' + example.query.sparql);
            console.log('Updated SPARQL: ' + this._update(example.query.sparql));
            this._rl.setPrompt('\nr/y/n/a/na: ');
            this._rl.prompt();
        } else {
            console.log('Done updating all examples with the same pattern.\n');
            this.init();
        }
    }

    private _pattern(sparql : string) : [string, string[]] {
        let count = 0;
        const entities : string[] = []; 
        for (const match of sparql.match(/(?<=wd:)Q[0-9]+/g) ?? []) {
            sparql = sparql.replace(new RegExp(match, 'g'), '_e_' + count);
            entities.push(match);
            count ++;
        }
        return [sparql, entities];
    }

    private _update(sparql : string) : string {
        let newPattern = this._pattern(this._currentExample!.query.sparql)[0];
        const entities = this._pattern(sparql)[1];
        for (let i = 0; i < entities.length; i++) 
            newPattern = newPattern.replace(new RegExp('_e_' + i, 'g'), entities[i]);
        return newPattern;
    }

    save(dir : string) {
        fs.writeFileSync(path.join(dir, 'train.json'), JSON.stringify({
            questions: Object.values(this._examples).filter((e) => e.id.startsWith('WebQTrn'))
        }, undefined, 2));
        fs.writeFileSync(path.join(dir, 'test.json'), JSON.stringify({
            questions: Object.values(this._examples).filter((e) => e.id.startsWith('WebQTest'))
        }, undefined, 2));
    }
}

function main() {
    const parser = new argparse.ArgumentParser({
        add_help: true,
        description: `Manually clean examples in WebQuestionsSP `
    });
    parser.add_argument('input', {
        help: `The directory contains the train/test set with Wikidata SPARQL`
    });
    parser.add_argument('-o', '--output', {
        required: false,
        default: './',
        help: `The directory to output the updated files`
    });

    const args = parser.parse_args();
    const trainData = JSON.parse(fs.readFileSync(args.input + '/train.json', 'utf-8'));
    const testData = JSON.parse(fs.readFileSync(args.input + '/test.json', 'utf-8'));
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const annotator = new Annotator(rl, trainData.questions, testData.questions);
    annotator.init();

    function quit() {
        annotator.save(args.output);
        console.log('\nBye\n');
        rl.close();
    }
    
    rl.on('SIGINT', quit);
}

if (require.main === module)
    main();