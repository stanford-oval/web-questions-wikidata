import fs from 'fs';
import path from 'path';
import * as argparse from 'argparse';
import { 
    Parser, 
    SparqlParser, 
    Generator,
    SparqlGenerator,
    SelectQuery, 
    AskQuery, 
    Pattern
} from 'sparqljs';

/**
 * WebQuestion SPARQL misses xsd prefix
 *  - PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
 * WebQuestion SPARQL also comes with some fixed filters for all queries that are unnecessary for parsing
 *  - a filter to make sure the result is not a mentioned entity in the question
 *  - a filter to make sure the result is either (1) an entity (2) language is not specified or English
 * @param sparql the original sparql in web questions dataset
 * @returns a preprocessed sparql that parses
 */
function preprocessWebQuestionsSparql(sparql : string) {
    sparql = 'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n' + sparql;
    sparql = sparql.replace(/\\n/g, '\n');
    sparql = sparql.replace(/FILTER \(\?x \!= ns:m.[^)]+\)/g, '')
    sparql = sparql.replace(`FILTER (!isLiteral(?x) OR lang(?x) = '' OR langMatches(lang(?x), 'en'))`, '');
    sparql = sparql.replace(`FILTER (!isLiteral(?x) OR (lang(?x) = '' OR lang(?x) = 'en'))`, '');
    sparql = sparql.replace(/[\n]+/g, '\n');
    sparql = sparql.replace(/ OR /g, '||');
    sparql = sparql.replace(`Having COUNT(?city) = 2`, `Having (COUNT(?city) = 2)`);
    return sparql;
}

interface WebQuestionExample {
    QuestionId : string,
    RawQuestion : string,
    ProcessedQuestion : string,
    Parses : WebQuestionParse[]
}

interface WebQuestionParse {
    Sparql : string
}

class FB2WDConverter {
    private parser : SparqlParser;
    private generator : SparqlGenerator;
    private entityMappings : Record<string, string>;
    private propertyMappings : Record<string, string>;

    constructor() {
        this.parser = new Parser();
        this.generator = new Generator();
        this.entityMappings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/entity-mappings.json'), 'utf-8'));
        this.propertyMappings = JSON.parse(fs.readFileSync(path.join(__dirname, `../../data/property-mappings.json`), 'utf-8'));
    }

    getEntity(fb_id : string) {
        return this.entityMappings[fb_id];
    }

    getProperty(fb_id : string) {
        return this.propertyMappings[fb_id];
    }

    private _convertWhereClause(clause : Pattern) {

    }

    convert(sparql : string) {
        const preprocessedSparql = preprocessWebQuestionsSparql(sparql);
        try {
            const parsed = this.parser.parse(preprocessedSparql) as SelectQuery|AskQuery;
            if (parsed.where) {
                for (const clause of parsed.where)
                    this._convertWhereClause(clause);
            }
            return this.generator.stringify(parsed);
        } catch(e) {
            console.log(preprocessedSparql);
            console.log((e as Error).message);
        }
    }
}

async function main() {
    const parser = new argparse.ArgumentParser({
        add_help : true,
        description : "Convert Freebase SPARQL into Wikidata SPARQL"
    });
    parser.add_argument('-i', '--input', {
        required: true,
        help: 'path to the input file'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        help: 'path to the output file'
    });
    const args = parser.parse_args();
    const fbQuestions = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    const converter = new FB2WDConverter();
    const examples = fbQuestions.Questions.map((ex : WebQuestionExample) => {
        return {
            question: ex.RawQuestion,
            sparql: converter.convert(ex.Parses[0].Sparql)
        }
    });
    fs.writeFileSync(args.output, JSON.stringify(examples, null, 2));    
}

if (require.main === module)
    main();