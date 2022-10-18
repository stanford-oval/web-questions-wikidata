import fs from 'fs';
import path from 'path';
import { FB2WDMapper } from './mappings';
import { preprocessWebQuestionsSparql } from './web-questions';

export class PatternMatcher {
    private _patterns : Record<string, string>;
    private _allPatterns : Record<string, Record<string, number>>;
    private _mapper : FB2WDMapper;

    constructor(mapper : FB2WDMapper, referencePath ?: string) {
        this._patterns = {};
        this._allPatterns = {};
        this._mapper = mapper;
        const raw : Record<string, string> = {};
        for (const fname of ['train.json', 'test.json']) {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data', fname), 'utf-8'));
            for (const example of data.Questions) 
                raw[example.QuestionId] = example.Parses[0].Sparql;
        }
        let parentDir : string;
        if (!referencePath)
            parentDir = path.join(__dirname, '../../../data/annotated');
        else
            parentDir = referencePath;
        const annotated : Record<string, string> = {};
        const dirCont = fs.readdirSync(parentDir);
        const annotatedFiles = dirCont.filter( (fname) => fname.match(/.*\.(json?)/ig));
        for (const fname of annotatedFiles) {
            const examples = JSON.parse(fs.readFileSync(path.join(parentDir, fname), 'utf-8'));
            for (const example of examples) 
                annotated[example.QuestionId] = example.Parses[0].Sparql;
        }
        for (const id in annotated) {
            const fbSPARQL = raw[id];
            const wdSPARQL = annotated[id];
            this.add(fbSPARQL, wdSPARQL);
        }
        console.log(`${Object.keys(this._patterns).length} patterns found`);
        fs.writeFileSync('patterns.json', JSON.stringify(this._allPatterns, null, 2));
    }

    private _preprocessFbSPARQL(sparql : string) : [string, string[]] {
        sparql = preprocessWebQuestionsSparql(sparql);
        let count = 0;
        const entities : string[] = []; 
        for (const match of sparql.match(/(?<=ns:)m\.[^\s()\\]*/g) ?? []) {
            sparql = sparql.replace(new RegExp(match, 'g'), '_e_' + count);
            entities.push(match);
            count ++;
        }
        return [sparql, entities];
    }

    add(fbSPARQL : string, wdSPARQL : string) {
        const [preprocessedSPARQL, entities] = this._preprocessFbSPARQL(fbSPARQL);
        for (const [i, entity] of entities.entries()) {
            if (!this._mapper.hasEntity(entity))
                return;
            const qid = this._mapper.map(entity)!;
            wdSPARQL = wdSPARQL.replace(new RegExp(qid, 'g'), `_e_` + i);
        }
        wdSPARQL = wdSPARQL.replace(/\s+/g, ' ');
        if (!(preprocessedSPARQL in this._patterns))
            this._patterns[preprocessedSPARQL] = wdSPARQL;
        if (!(preprocessedSPARQL in this._allPatterns))
            this._allPatterns[preprocessedSPARQL] = { [wdSPARQL]: 1 };
        else {
            if (wdSPARQL in this._allPatterns[preprocessedSPARQL])
                this._allPatterns[preprocessedSPARQL].wdSPARQL =  this._allPatterns[preprocessedSPARQL].wdSPARQL + 1;
            else
                this._allPatterns[preprocessedSPARQL][wdSPARQL] = 1;
        }
    }

    match(sparql : string) : string|null {
        const [preprocessedSPARQL, entities] = this._preprocessFbSPARQL(sparql);
        if (!(preprocessedSPARQL in this._patterns))
            return null;
        let wdSPARQL = this._patterns[preprocessedSPARQL];
        for (const [i, entity] of entities.entries()) {
            if (!this._mapper.hasEntity(entity)) 
                return null;
            const qid = this._mapper.map(entity)!;
            wdSPARQL = wdSPARQL.replace(new RegExp('_e_' + i, 'g'), qid);
        }
        return wdSPARQL;
    }
}

