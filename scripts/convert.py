import csv
import json
import re
import urllib.request
from html_table_parser.parser import HTMLTableParser

FB_PROPERTY_PREFIX = 'https://www.freebase.com/'

def url_get_contents(url):
    req = urllib.request.Request(url=url)
    f = urllib.request.urlopen(req)
    return f.read()

html = url_get_contents('https://www.wikidata.org/wiki/Wikidata:WikiProject_Freebase/Mapping').decode('utf-8')
parser = HTMLTableParser()
parser.feed(html)

propertyMapper = {}

for table in parser.tables:    
    for row in table:
        if row[0].startswith(FB_PROPERTY_PREFIX) and re.search(r'P[\d]+', row[1]):
            fb_property_id = row[0][len(FB_PROPERTY_PREFIX):].replace('/', '.')
            wd_property_id = re.search(r'P[\d]+', row[1]).group()
            propertyMapper[fb_property_id] = wd_property_id

with open('property-mappings.json', 'w') as f:
    json.dump(propertyMapper, f, indent=4)

FB_ENTITY_PREFIX = 'http://rdf.freebase.com/ns/'
WD_ENTITY_PREFIX = 'http://www.wikidata.org/entity/'

entity_mapper = {}

with open('fb2w.nt', 'r') as f:
    tsv_file = csv.reader(f, delimiter='\t')
    for fb_entity, _, wd_entity in tsv_file:
        fb_entity_id = fb_entity[1 + len(FB_ENTITY_PREFIX) : -1]
        wd_entity_id = wd_entity[1 + len(WD_ENTITY_PREFIX) : -3]
        entity_mapper[fb_entity_id] = wd_entity_id

with open('entity-mappings.json', 'w') as f:
    json.dump(entity_mapper, f, indent=4)

def checkEntity(sparql):
    entities = re.findall(r'(?<=ns:)m\.[^\s\(\)\\]*', sparql)
    for entity in entities:
        if entity not in entity_mapper:
            return False
    return True

def checkProperty(sparql):
    properties = re.findall(r'(?<=ns:)(?!m\.)[^\s\(\)\\]+', sparql)
    for property in properties:
        if property not in propertyMapper:
            return False
    return True

count_convertible = 0
count_not_convertible = 0
with open('test.json', 'r') as f:
    data = json.load(f)
    for q in data['Questions']:
        has_convertible_parse = False
        for parse in q['Parses']:
            if checkEntity(parse['Sparql']) and checkProperty(parse['Sparql']):
                has_convertible_parse = True
        if has_convertible_parse:
            count_convertible += 1
        else:
            count_not_convertible += 1

print(count_convertible, count_not_convertible)


