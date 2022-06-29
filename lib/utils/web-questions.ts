export interface WebQuestionExample {
    QuestionId : string,
    RawQuestion : string,
    ProcessedQuestion : string,
    Parses : WebQuestionParse[]
}

export interface WebQuestionParse {
    Sparql : string
    Answers : WebQuestionAnswer[]
}

export interface WebQuestionAnswer {
    AnswerType : string,
    AnswerArgument : string,
    EntityName : string|null
}

/**
* WebQuestion SPARQL misses xsd prefix
*  - PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
* WebQuestion SPARQL also comes with some fixed filters for all queries that are unnecessary for parsing
*  - a filter to make sure the result is not a mentioned entity in the question
*  - a filter to make sure the result is either (1) an entity (2) language is not specified or English
* @param sparql the original sparql in web questions dataset
* @returns a preprocessed sparql that parses
*/
export function preprocessWebQuestionsSparql(sparql : string) {
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