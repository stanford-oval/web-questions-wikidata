import re
import json

def normalize(sparql):
    sparql = re.sub(r'\s+', ' ', sparql).strip()
    sparql =  re.sub(r'(?<=ns:)m\.[^\s\(\)\\]*', 'ENTITY', sparql)
    return sparql

templates = set()

with open('../data/train.json', 'r') as f:
    data = json.load(f)
    for example in data["Questions"]:   
        for parse in example["Parses"]:
            templates.add(normalize(parse["Sparql"]))

count_unseen = 0
count_seen = 0
with open('../data/test.json', 'r') as f:
    data = json.load(f)
    for example in data["Questions"]:
        seen = False
        for parse in example["Parses"]:
            normalized = normalize(parse["Sparql"])
            if normalized in templates:
                seen = True
                break
        if seen:
            count_seen += 1
        else:
            count_unseen += 1


print(count_unseen, count_seen)
