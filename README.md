# WebQuestions Conversion Tool

## Auto conversion
A conversion tool is provided to convert a subset of WebQuestions dataset automatically into the Wikidata Equivalent. 
This only covers simple questions that are very straightforward. 
For example, the following command will automatically convert the training data. 

```bash
node dist/lib/fb2wd.js -i data/train.json -r data/annotated -d data/dropped --annotated data/train-auto-annotated.json --skipped data/train-auto-skipped.json --dropped data/train-auto-dropped.json
```

For test data.

```bash
node dist/lib/fb2wd.js -i data/test.json -r data/annotated -d data/dropped --annotated data/test-auto-annotated.json --skipped data/test-auto-skipped.json --dropped data/test-auto-dropped.json
```


## Manual conversion

To annotate the skipped examples in auto conversion, first run the following command to split the train set into batches:

```bash
node dist/lib/split-data.js --prefix train data/train-auto-skipped.json 
```

This will generate files `data/train-000.json`, `data/train-001.json`, etc. 
By default, there are 50 examples in each batch. This makes it easy to have multiple people working on the anntoation.

Run the same command to split the test set into batches:

```bash
node dist/lib/split-data.js --prefix test data/test-skipped.json 
```

Then, run the following command to annotate a single batch:

```bash
node dist/lib/manual-annotate.js data/train-000.json
```

This script starts a command-line tool for manual annotation. It shows the original SPARQL for Freebase, as well as 
the equivalent Wikidata entities and properties we found. Note that, it's very likely the list of entities and properties
are incomplete, in which case, annotator has to manually look it up. 

Here is an example of the prompt:

```
Example ID:  WebQTest-0
Question:  what does jamaican people speak?
SPARQL:  PREFIX ns: <http://rdf.freebase.com/ns/>
SELECT DISTINCT ?x
WHERE {
ns:m.03_r3 ns:location.country.languages_spoken ?x .
} 

m.03_r3: Jamaica (http://www.wikidata.org/entity/Q766)
```

Here, the entity Jamaica is provided, while the Wikidata equivlent property for `language_spoken` is unknown.
A trick is to ctrl+click the link for Jamaica to quickly check what properties are there for the entity. 

Then the annotator can start typing in the SPARQL for Wikidata. 
For entity variables, use `x`, `y`, `z`, `w`, in order of their appearance in the triples. 
For predicate variables, use `p`, `q`. 
Line breaks are allowed when annotating. 
Two consecutive line breaks will inform the system to take the input and verify it. 
It will check the basic syntax and normalize the SPARQL, then it will run the SPARQL against the Wikidata SPARQL endpoint to retrieve the answers: 

```
SELECT DISTINCT ?x WHERE { wd:Q766 wdt:P2936 ?x. } 

After normalization:
SELECT DISTINCT ?x WHERE { wd:Q766 wdt:P2936 ?x. }
Wikidata answers: Jamaican English, Jamaican Country Sign Language, Jamaican Sign Language, English, Jamaican Patois
Freebase answers: Jamaican English, Jamaican Creole English Language

Does the result look good? y/n/s/d
```

The annotator can choose one the following 
- `y`: accept the SPARQL, the example will be added to `data/train-000-annotated.json`
- `n`: reject the SPARQL, the tool will prompt to rewrite the SPARQL
- `s`: skip the example, the example will be added to `data/train-000-skipped.json`, and annotator can annotate them later
- `d`: drop the example, the example will be added to `data/train-000-dropped.json`, this means there is no way we can annotate it and we won't include the example in our dataset.

At any time, the annotator can stop the annotation by CTRL+c, the tool will resume to the same location next time. 

