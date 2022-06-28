import fs from 'fs';
import path from 'path';
import * as argparse from 'argparse';

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
    private entityMappings : Record<string, string>;
    private propertyMappings : Record<string, string>;

    constructor() {
        this.entityMappings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/entity-mappings.json'), 'utf-8'));
        this.propertyMappings = JSON.parse(fs.readFileSync(path.join(__dirname, `../../data/property-mappings.json`), 'utf-8'));
    }

    getEntity(fb_id : string) {
        return this.entityMappings[fb_id];
    }

    getProperty(fb_id : string) {
        return this.propertyMappings[fb_id];
    }

    convert(sparql : string) {
        return sparql;
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