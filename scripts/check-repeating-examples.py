import json
import re

annotated = dict()

for path in ['../data/train-000-annotated.json', '../data/train-001-annotated.json']: 
    with open(path, 'r') as f:
        data = json.load(f)
        for example in data:
            annotated[example["QuestionId"]] = example["Parses"][0]["Sparql"]

exactMatcher = dict()
exactMatcherUtterance = dict()

def normalize(sparql):
    sparql = re.sub(r'\s+', ' ', sparql).strip()
    sparql =  re.sub(r'(?<=ns:)m\.[^\s\(\)\\]*', 'ENTITY', sparql)
    return sparql

with open('../data/train.json', 'r') as f:
    data = json.load(f)
    for example in data["Questions"]:   
        if example["QuestionId"] in annotated:
            wdSparql = annotated[example["QuestionId"]]
            fbSparql = example["Parses"][0]["Sparql"]
            normalizedFbSparql = normalize(fbSparql)
            exactMatcher[normalizedFbSparql] = wdSparql
            exactMatcherUtterance[normalizedFbSparql] = example["RawQuestion"]

count = 0
with open('../data/train-rest.json', 'r') as f:
    data = json.load(f)
    for example in data:
        for parse in example["Parses"]:
            normalizedSparql = normalize(parse["Sparql"]) 
            if normalizedSparql in exactMatcher:
                count += 1


print(count)