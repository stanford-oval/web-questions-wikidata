import sys
import json

path = sys.argv[1]

with open(path, 'r') as f:
    data = json.load(f)
    print(len(data['questions']))