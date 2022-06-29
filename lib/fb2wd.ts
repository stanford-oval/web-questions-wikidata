import fs from 'fs';
import * as argparse from 'argparse';
import { 
    Parser, 
    SparqlParser, 
    Generator,
    SparqlGenerator,
    SelectQuery, 
    AskQuery, 
    Pattern,
    BgpPattern,
    Triple
} from 'sparqljs';
import {
    isBasicGraphPattern, 
    isLiteral, 
    isNamedNode,
    isVariable
} from './utils/sparqljs-typeguard';
import {
    FB_ENTITY_PREFIX,
    FB_PROPERTY_PREFIX
} from './utils/freebase';
import {
    ENTITY_PREFIX,
    PROPERTY_PREFIX
} from './utils/wikidata'
import {
    ConversionErrorCode,
    ConversionError
} from './utils/errors';
import {
    FB2WDMapper
} from './utils/mappings';
import {
    WebQuestionExample,
    preprocessWebQuestionsSparql
} from './utils/web-questions'

class FB2WDConverter {
    private parser : SparqlParser;
    private generator : SparqlGenerator;
    private mapper : FB2WDMapper;
    public counter : Record<string, number>;
    public missingEntityMappings : Set<string>;
    public missingPropertyMappings : Set<string>;

    constructor() {
        this.parser = new Parser();
        this.generator = new Generator();
        this.mapper = new FB2WDMapper();
        this.counter = {};
        this.missingEntityMappings = new Set();
        this.missingPropertyMappings = new Set();
    }

    private count(key : ConversionErrorCode|'success') {
        if (!(key in this.counter))
            this.counter[key] = 0;
        this.counter[key] += 1;
    }

    private convertEntity(entity : any) {
        if (isNamedNode(entity)) {
            if (!entity.value.startsWith(FB_ENTITY_PREFIX))
                throw new ConversionError('UnknownEntity', 'Not recognized entity: ' + entity.value);
            const fb_id = entity.value.slice(FB_ENTITY_PREFIX.length);
            if (!this.mapper.hasEntity(fb_id)) {
                this.missingEntityMappings.add(fb_id);
                throw new ConversionError('NoEntityMapping', 'Entity missing in the mapping: ' + entity.value);
            }
            entity.value = ENTITY_PREFIX + this.mapper.map(fb_id);
        } else if (!isVariable(entity)) {
            throw new ConversionError('UnsupportedNodeType', 'Not supported node: ' + entity);
        }
    }

    /**
     * convert a fb property into a wd property, and return if we need to reverse the subject and object
     * @param property a predicate in the parsed Triple
     * @return if the property i
     */
    private checkAndConvertProperty(property : any) : boolean {
        if (isNamedNode(property)) {
            if (!property.value.startsWith(FB_PROPERTY_PREFIX))
                throw new ConversionError('UnknownProperty', 'Not recognized property: ' + property.value);
            const fb_id = property.value.slice(FB_PROPERTY_PREFIX.length);
            if (!this.mapper.hasProperty(fb_id) && !this.mapper.hasReverseProperty(fb_id)) {
                this.missingPropertyMappings.add(fb_id);
                throw new ConversionError('NoPropertyMapping', 'Entity missing in the mapping: ' + property.value);
            }
            property.value = PROPERTY_PREFIX + this.mapper.map(fb_id);
            return this.mapper.hasReverseProperty(fb_id);
        } else if (!isVariable(property)) {
            throw new ConversionError('UnsupportedPropertyType', 'Not supported node: ' + property);
        }
        return false;
    }

    private convertTriple(triple : Triple) {
        this.convertEntity(triple.subject);
        this.convertEntity(triple.object);
        const reverse = this.checkAndConvertProperty(triple.predicate);
        if (reverse) {
            if (!isLiteral(triple.object)) {
                const tmp = triple.subject;
                triple.subject = triple.object;
                triple.object = tmp;
            } else {
                throw new ConversionError('NotReversibleTriple', 'Failed to reverse triple: ' + triple);
            }
        }
    }

    private convertBGP(clause : BgpPattern) {
        for (const triple of clause.triples)
            this.convertTriple(triple); 
    }

    private convertWhereClause(clause : Pattern) {
        if (isBasicGraphPattern(clause)) 
            this.convertBGP(clause);
        else
            throw new ConversionError('Unsupported');
    }

    convert(sparql : string) {
        const preprocessedSparql = preprocessWebQuestionsSparql(sparql);
        try {
            const parsed = this.parser.parse(preprocessedSparql) as SelectQuery|AskQuery;
            if (parsed.where) {
                for (const clause of parsed.where)
                    this.convertWhereClause(clause);
            }
            const converted = this.generator.stringify(parsed);
            this.count('success');
            return converted;
        } catch(e) {
            if (e instanceof ConversionError) 
                this.count(e.code);
            else    
                this.count('Unknown');
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
        const converted = ex.Parses.map((parse) => converter.convert(parse.Sparql)).filter(Boolean);
        return {
            question: ex.RawQuestion,
            sparql: converted.length > 0 ? converted[0] : null
        }
    });
    console.log(converter.counter);
    console.log('Total: ', examples.length);
    fs.writeFileSync('data/missing-entity-mappings.tsv', [...converter.missingEntityMappings].join('\n'));
    fs.writeFileSync('data/missing-property-mappings.tsv', [...converter.missingPropertyMappings].join('\n'));
    fs.writeFileSync(args.output, JSON.stringify(examples, null, 2));    
}

if (require.main === module)
    main();