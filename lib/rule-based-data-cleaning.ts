import * as argparse from 'argparse';
import * as fs from 'fs';
import * as path from 'path';

import WikidataUtils from './utils/wikidata';

interface Example {
    id : string,
    question : Array<{ language : string, string : string, keywords : string }>,
    query : { sparql : string }
}

class DataUpdater {
    private _examples : Record<string, Example>;
    private _wikidata : WikidataUtils;

    constructor(trainSet : Example[], testSet : Example[]) {
        this._wikidata = new WikidataUtils('wikidata.sqlite');
        this._examples = {};
        for (const example of [...trainSet, ...testSet])
            this._examples[example.id] = example;
    }

    async update() {
        const regex = new RegExp('(ps|pq|wdt|p):(P725|P161)\\|(ps|pq|wdt|p):(P725|P161)', 'g');
        for (const [id, example] of Object.entries(this._examples)) {
            if (!regex.test(example.query.sparql))
                continue;
            const answer = await this._wikidata.query(example.query.sparql);
            if (answer.length === 0) {
                console.log(`Example ${id}: no answer found, replaced by P161`);
                example.query.sparql = example.query.sparql.replace(regex, '$1:P161');
                continue;
            }
            let updated = false;
            for (const p of ['P161', 'P725']) {
                const sparql = example.query.sparql.replace(regex, '$1:' + p);
                const newAnswer = await this._wikidata.query(sparql);
                if (newAnswer.length > 0) {
                    example.query.sparql = sparql;
                    updated = true;
                    console.log(`Example ${id}: replaced by ${p}`);
                    break;
                }
            }
            if (!updated)
                console.log(`Example ${id}: not updated`);
        }
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

async function main() {
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
    
    const updater = new DataUpdater(trainData.questions, testData.questions);
    await updater.update();
    updater.save(args.output);
}

if (require.main === module)
    main();