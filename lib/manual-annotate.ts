import * as argparse from 'argparse';
import * as fs from 'fs';
import * as events from 'events';
import * as readline from 'readline';
import {
    WebQuestionExample
} from './utils/web-questions';

class Annotator extends events.EventEmitter {
    private _ex ?: WebQuestionExample;
    private _rl : readline.Interface;
    private _nextExample : Iterator<WebQuestionExample>;

    constructor(rl : readline.Interface, examples : Array<WebQuestionExample>) {
        super();

        this._ex = undefined;
        this._rl = rl;
        this._nextExample = examples[Symbol.iterator]();

        rl.on('line', async (line) => {
            if (line.trim().length === 0) {
                rl.prompt();
                return;
            }

            if (line === 'd' || line.startsWith('d ')) {
                const comment = line.substring(2).trim();
                this.emit('dropped', comment);
                this.next();
                return;
            }

            this.emit('annotated', this._ex);
        });
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
        this._ex = example;
        console.log(example.QuestionId);
        this._rl.setPrompt('$ ');
        this._rl.prompt();
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
    parser.add_argument('--offset', {
        required: false,
        type: parseInt,
        default: 1,
        help: `Start from the nth line of the input tsv file.`
    });

    const args = parser.parse_args();
    const webQuestions = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    let examples : Array<WebQuestionExample> = webQuestions.Questions;
    if (args.offset > 1)
        examples = examples.slice(args.offset - 1);
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('SELECT DISTINCT ');

    const annotator = new Annotator(rl, examples);
    const annotated = [];
    const dropped = [];

    function quit() {

        console.log('Bye\n');
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