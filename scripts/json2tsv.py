import json
import csv 

with open('../data/train.json', 'r') as fin, open('../data/train.tsv', 'w') as fout:
    tsv_writer = csv.writer(fout, delimiter='\t', lineterminator='\n')
    data = json.load(fin)
    try:
        for example in data["Questions"]:
            tsv_writer.writerow([example["QuestionId"], example["RawQuestion"], example["Parses"][0]["Sparql"].encode('utf-8').replace('\n', '')])
    except Exception as e:
        print(example["QuestionId"])
        print(example["RawQuestion"])
        print(example["Parses"][0]["Sparql"].encode('utf-8'))
        print(e)
