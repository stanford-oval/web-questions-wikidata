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
    ENTITY_PREFIX as FB_ENTITY_PREFIX,
    PROPERTY_PREFIX as FB_PROPERTY_PREFIX,
    PREFIXES as FB_PREFIXES
} from './utils/freebase';
import WikidataUtils, {
    ENTITY_PREFIX as WD_ENTITY_PREFIX,
    PROPERTY_PREFIX as WD_PROPERTY_PREFIX,
    PREFIXES as WD_PREFIXES,
    postprocessSparql
} from './utils/wikidata';
import {
    ConversionErrorCode,
    ConversionError
} from './utils/errors';
import {
    FB2WDMapper
} from './utils/mappings';
import {
    PatternMatcher
} from './utils/pattern-matcher';
import {
    loadExample,
    preprocessWebQuestionsSparql,
    WebQuestionParse
} from './utils/web-questions';

export default class FB2WDConverter {
    private parser : SparqlParser;
    private generator : SparqlGenerator;
    private mapper : FB2WDMapper;
    private matcher : PatternMatcher;
    private wikidata : WikidataUtils;
    public counter : Record<string, number>;
    public missingEntityMappings : Set<string>;
    public missingPropertyMappings : Set<string>;

    constructor(wikidata : WikidataUtils) {
        this.parser = new Parser({ prefixes: { ...FB_PREFIXES, ...WD_PREFIXES } });
        this.generator = new Generator({ prefixes: WD_PREFIXES });
        this.mapper = new FB2WDMapper();
        this.matcher = new PatternMatcher(this.mapper);
        this.wikidata = wikidata;
        this.counter = {};
        this.missingEntityMappings = new Set();
        this.missingPropertyMappings = new Set();
    }

    private count(key : ConversionErrorCode|'success') {
        if (!(key in this.counter))
            this.counter[key] = 0;
        this.counter[key] += 1;
    }

    private async convertEntity(entity : any) {
        if (isNamedNode(entity)) {
            if (!entity.value.startsWith(FB_ENTITY_PREFIX))
                throw new ConversionError('UnknownEntity', 'Not recognized entity: ' + entity.value);
            const fb_id = entity.value.slice(FB_ENTITY_PREFIX.length);
            if (!this.mapper.hasEntity(fb_id)) {
                const wd_id = await this.wikidata.getEntityByFreebaseId(fb_id);
                if (wd_id) {
                    this.mapper.addEntity(fb_id, wd_id);
                } else {
                    this.missingEntityMappings.add(fb_id);
                    throw new ConversionError('NoEntityMapping', 'Entity missing in the mapping: ' + entity.value);
                }
            }
            entity.value = WD_ENTITY_PREFIX + this.mapper.map(fb_id);
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
            property.value = WD_PROPERTY_PREFIX + this.mapper.map(fb_id);
            return this.mapper.hasReverseProperty(fb_id);
        } else if (!isVariable(property)) {
            throw new ConversionError('UnsupportedPropertyType', 'Not supported node: ' + property);
        }
        return false;
    }

    private async convertTriple(triple : Triple) {
        await this.convertEntity(triple.subject);
        await this.convertEntity(triple.object);
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

    private async convertBGP(clause : BgpPattern) {
        if (clause.triples.length > 1)
            throw new ConversionError('Unsupported');
        for (const triple of clause.triples)
            await this.convertTriple(triple); 
    }

    private async convertWhereClause(clause : Pattern) {
        if (isBasicGraphPattern(clause)) 
            await this.convertBGP(clause);
        else
            throw new ConversionError('Unsupported');
    }

    async convert(sparql : string) {
        const match = this.matcher.match(sparql);
        if (match) {
            this.count('success');
            return match;
        }

        const preprocessedSparql = preprocessWebQuestionsSparql(sparql);
        try {
            const parsed = this.parser.parse(preprocessedSparql) as SelectQuery|AskQuery;
            if (parsed.where) {
                if (parsed.where.length > 1)
                    throw new ConversionError('Unsupported');
                for (const clause of parsed.where)
                    await this.convertWhereClause(clause);
            }
            if ('having' in parsed || 'group' in parsed) 
                throw new ConversionError('Unsupported');
            if ('order' in parsed && parsed.order) 
                throw new ConversionError('Unsupported');
            const converted = this.generator.stringify(parsed);
            this.count('success');
            return converted;
        } catch(e) {
            if (e instanceof ConversionError) 
                this.count(e.code);
            else    
                this.count('Unknown');
            return null;
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
    parser.add_argument('--annotated', {
        required: true,
        help: 'path to the file for annotated examples'
    });
    parser.add_argument('--skipped', {
        required: true,
        help: 'path to the file for skipped examples'
    });
    const args = parser.parse_args();
    const fbQuestions = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    const wikidata = new WikidataUtils('wikidata.sqlite');
    const converter = new FB2WDConverter(wikidata);
    const annotated = [];
    const skipped = [];
    for (const ex of fbQuestions.Questions) {
        const example = loadExample(ex);
        const noAnswer = example.Parses[0].Answers.length === 0;
        let skip = true;
        for (const p of example.Parses) {
            const converted = await converter.convert(p.Sparql);
            if (!converted)
                continue;
            
            const sparql = postprocessSparql(converted);
            const parse : WebQuestionParse = {
                Sparql: sparql,
                Answers: []
            };
            try {
                const response = await wikidata.query(sparql!);
                const rawAnswers = response.map((r : any) => Object.values(r).map((v : any) => v.value)).flat();

                // if there is no answer from wikidata, but there is answer in the original dataset
                // skip
                if (!noAnswer && rawAnswers.length === 0) 
                    continue;
                for (const answer of rawAnswers) {
                    if (answer.startsWith(WD_ENTITY_PREFIX)) {
                        const qid = answer.slice(WD_ENTITY_PREFIX.length);
                        const label = await wikidata.getLabel(qid);
                        parse.Answers.push({ AnswerType : 'Entity', AnswerArgument: qid, EntityName : label });
                    } else {
                        parse.Answers.push({ AnswerType : 'Value', AnswerArgument: answer, EntityName : null });
                    }
                }
                example.Parses = [parse];
                annotated.push(example);
            } catch(e) {
                console.log('Failed when querying Wikidata endpoint');
                console.log('Question:', example.RawQuestion);
                console.log('SPARQL:', sparql);
            }

            // if the code reaches here, it means we have found a valid parse for the example 
            // and the example has been added to the `annotated` array.
            // so we don't add this example to `skipped` array, and ignore the rest of the parses for the example 
            skip = false;
            break;
        } 
        if (skip)
            skipped.push(example);
    }
    console.log(converter.counter);
    console.log('Annotated: ', annotated.length);
    console.log('Skipped: ', skipped.length);
    fs.writeFileSync('data/missing-entity-mappings.tsv', [...converter.missingEntityMappings].join('\n'));
    fs.writeFileSync('data/missing-property-mappings.tsv', [...converter.missingPropertyMappings].join('\n'));
    fs.writeFileSync(args.annotated, JSON.stringify(annotated, null, 2));
    fs.writeFileSync(args.skipped, JSON.stringify(skipped, null, 2));    
}

if (require.main === module)
    main();