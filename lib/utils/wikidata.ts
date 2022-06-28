import * as Tp from 'thingpedia';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import { wikibaseSdk } from 'wikibase-sdk'; 
import wikibase from 'wikibase-sdk';
import { Type } from 'thingtalk';
import BootlegUtils from './bootleg';

const URL = 'https://query.wikidata.org/sparql';
export const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
export const PROPERTY_PREFIX = 'http://www.wikidata.org/prop/direct/';
export const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

const SQLITE_SCHEMA = `
create table http_requests (
    url text primary key,
    result text
);

create table labels (
    id varchar(16) primary key,
    label text
);
`;

const PROPERTY_BLACKLIST = [
    'P1889', // different from
    'P1424', // topic's main template
    'P1151', // topic's main Wikimedia portal 
];

interface Constraint {
    key : string,
    value : string
}

interface Qualifier {
    name : string, 
    type : Type
}

type WikibaseType = 'WikibaseItem' | 'CommonsMedia' | 'String' | 'Quantity' | 'Time' | 'Monolingualtext' | 'Url' | 'Unsupported';

function normalizeURL(url : string) {
    return url.trim().replace(/\s+/g, ' ');
}
 
export default class WikidataUtils {
    private _wdk : wikibaseSdk;
    private _cachePath : string;
    private _cache ! : sqlite3.Database;
    private _bootleg : BootlegUtils;
    private _cacheLoaded : boolean;
    private _properties : Record<string, WikibaseType>; // all properties to include with their wikibase type
    public qualifiers : Record<string, Qualifier>; // all qualifiers to include

    constructor(cachePath : string, bootlegPath : string) {
        this._cachePath = cachePath;
        this._wdk = wikibase({ instance: 'https://www.wikidata.org' });
        this._bootleg = new BootlegUtils(bootlegPath);
        this._cacheLoaded = false;
        this._properties = {};
        this.qualifiers = {
            'P580': { name: 'start_time', type: Type.Date }, 
            'P582': { name: 'end_time', type: Type.Date }, 
            'P585': { name: 'point_in_time', type: Type.Date }, 
        };
    }

    /**
     * Load or create sqlite database for caching
     */
    private async _loadOrCreateSqliteCache() {
        const db = new sqlite3.Database(this._cachePath, sqlite3.OPEN_CREATE|sqlite3.OPEN_READWRITE);
        db.serialize(() => {
            if (!fs.existsSync(this._cachePath)) 
                db.exec(SQLITE_SCHEMA);
        });
        this._cache = db;
        this._cacheLoaded = true;
    }

    /**
     * Get cache 
     * @param table the name of the table
     * @param field the filed of projection
     * @param constraint the constraint to apply to the retrieval
     * @returns undefined if not found, otherwise in the format of { result : string }
     */
    private async _getCache(table : string, field : string, constraint : Constraint) : Promise<any> {
        if (!this._cacheLoaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const sql = `select ${field} from ${table} where ${constraint.key} = ?`;
            this._cache.get(sql, constraint.value, (err : Error|null, rows : any) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
    }

    /**
     * Set cache
     * @param table the name of the table
     * @param values all the values to add to the table
     * @returns undefined
     */
    private async _setCache(table : string, ...values : string[]) {
        if (!this._cacheLoaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const placeholders = values.map(() => '?').join(',');
            const sql = `insert into ${table} values (${placeholders})`; 
            this._cache.get(sql, ...values, (err : Error|null, rows : any) => {
                if (err)
                    reject(err);
                else 
                    resolve(rows);
            });
        });
    }

    /**
     * Obtain results of a SPARQL query against Wikidata SPARQL endpoint
     * @param sparql a SPARQL query
     * @returns A list of the results
     */
    private async _query(sparql : string) {
        const result = await this._request(`${URL}?query=${encodeURIComponent(normalizeURL(sparql))}`);
        return result.results.bindings;
    }

    /**
     * Obtain results of URL in JSON form (Wikibase API call)
     * @param url 
     * @param caching enable caching for the request or not
     * @returns An object of the result
     */
    private async _request(url : string, caching = true, attempts = 1) : Promise<any> {
        if (caching) {
            const cached = await this._getCache('http_requests', 'result', { key: 'url', value : url });
            if (cached) 
                return JSON.parse(cached.result);
        }
        try {
            const result = await Tp.Helpers.Http.get(url, { accept: 'application/json' });
            if (caching)
                await this._setCache('http_requests', url, result);
            const parsed = JSON.parse(result);
            return parsed;
        } catch(e) {
            if (attempts < 2)
                return this._request(url, caching, attempts + 1);
            console.log(`Failed to retrieve result for: ${url}`);
            console.log(e);
            return null;
        }
    }

    /**
     * Obtain the values of property for a given entity
     * @param entityId QID of an entity
     * @param propertyId PID of an entity
     * @returns values of the property
     */
    async getPropertyValue(entityId : string, propertyId : string) : Promise<string[]> {
        const sparql = `SELECT ?v WHERE { wd:${entityId} wdt:${propertyId} ?v. }`;
        const res = await this._query(sparql);
        return res.map((r : any) => r.v.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get the domain of a given entity: 
     * if there are multiple domains, pick the one that has the most instances;
     * we skip this on 
     *   human (Q5) 
     *   taxon (Q16521) 
     *   scholar article (Q13442814)
     * since the query will timeout 
     * @param entityId QID of an entity
     * @returns 
     */
    async getDomain(entityId : string) : Promise<string|null> {
        const domains = await this.getPropertyValue(entityId, 'P31');
        if (domains.length === 0)
            return null;
        if (domains.includes('Q5'))
            return 'Q5';
            
        const bootlegType = await this._bootleg.getType(entityId);
        if (bootlegType)
            return bootlegType;

        if (domains.length === 1)
            return domains[0];
        for (const domain of ['Q16521', 'Q13442814']) {
            if (domains.includes(domain))
                return domain;
        }
        
        const sparql = `SELECT ?v (COUNT(?s) as ?count) WHERE {
            wd:${entityId} wdt:P31 ?v.
            ?s wdt:P31 ?v.
        } GROUP BY ?v ORDER BY DESC(?count)`;
        const res = await this._query(sparql);
        return res[0].v.value.slice(ENTITY_PREFIX.length);
    }

    /**
     * Get the Wikidata label for an entity or a property   
     * @param id QID or PID
     * @returns natural language label in English
     */
    async getLabel(id : string) : Promise<string|null> {
        if (!/[P|Q][0-9]+/.test(id))
            return null;
        const result = await this._request(this._wdk.getEntities({ 
            ids: [id],
            languages: ['en'],
            props: ['labels']
        }));
        try {
            return (Object.values(result.entities)[0] as any).labels.en.value;
        } catch(e) {
            console.log(`Failed to retrieve label for ${id}`);
            return null;
        }
    }

    /**
     * Get the Wikidata alt label for an entity or a property
     * @param id QID or PID
     * @returns an array of alternative labels in English
     */
    async getAltLabels(id : string) : Promise<string[]> {
        const result = await this._request(this._wdk.getEntities({
            ids: [id],
            languages: ['en'],
            props: ['aliases']
        }));
        try {
            return (Object.values(result.entities)[0] as any).aliases.en.map((alias : any) => alias.value);
        } catch(e) {
            console.log(`Found no alt label for ${id}`);
            return [];
        }
    }

    /**
     * Get the wikidata label for a list of entities/properties. 
     * The API allows up to 50 entities/properties at a time. 
     * @param qids a list of QIDs or PIDs
     * @returns A map from id to label
     */
    async getLabelsByBatch(...ids : string[]) : Promise<Record<string, string|null>> {
        const result : Record<string, string|null> = {};
        const uncached = [];
        for (const id of ids) {
            if (!/^[P|Q][0-9]+$/.test(id))
                continue;
            const cached = await this._getCache('labels', 'label', { key : 'id', value : id });
            if (cached) 
                result[id] = cached.label;
            else    
                uncached.push(id);
        }
        const uniqueUncached = [...new Set(uncached)];
        for (let i = 0; i < uniqueUncached.length; i += 50) {
            const batch = uniqueUncached.slice(i, i + 50);
            const raw = await this._request(this._wdk.getEntities({
                ids : batch,
                languages: ['en'],
                props: ['labels']
            }));
            for (const [qid, entity] of Object.entries(raw.entities) as any) {
                if (qid !== entity.id) // some entities are simply a redirect of another entity, drop those 
                    continue;
                result[qid] = entity.labels?.en?.value;
                await this._setCache('labels', qid, entity.labels?.en?.value ?? null);
            }
        }
        return result;
    }

    /**
     * Get example entities for the given domain
     * 
     * Examples are sorted based on sitelinks.
     * Order by sitelinks in human (Q5), painting (Q3305213), and taxon (Q16521) domain 
     * will lead to timeout, thus handle these three domains specially
     * 
     * @param domain QID of the domain
     * @param limit the maximum number of entities to return
     * @returns an array of QIDs belongs to the given domain
     */
    async getEntitiesByDomain(domain : string, limit = 100) : Promise<string[]> {
        let sparql;
        if (['Q16521', 'Q5', 'Q3305213'].includes(domain)) {
            sparql = `SELECT ?v ?sitelinks WHERE {
                ?v wdt:P31 wd:${domain} ;
                   wikibase:sitelinks ?sitelinks . 
                FILTER (?sitelinks > ${domain === 'Q3305213' ? 20 : 100}) .
            } LIMIT ${limit}`;
        } else {
            sparql = `SELECT ?v WHERE {
                ?v wdt:P31 wd:${domain} ;
                   wikibase:sitelinks ?sitelinks .  
            } ORDER BY DESC(?sitelinks) LIMIT ${limit}`;
        }
        const res = await this._query(sparql);
        return res.map((r : any) => r.v.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get properties for a given domain
     * 
     * First get 100 example entities in the domain, and then extract all properties 
     * they use
     * 
     * @param domain QID of the domain
     * @param includeNonEntityProperties include properties whose values are not Wikidata entities 
     * @returns an array of PIDs belongs to the given domain
     */
    async getDomainProperties(domain : string, includeNonEntityProperties = false) : Promise<string[]> {
        const propertyCounter : Record<string, number> = {};
        const exampleEntities = await this.getEntitiesByDomain(domain);
        const entityOnlyFilter = `FILTER(STRSTARTS(STR(?v), "${ENTITY_PREFIX}")) .`;
        for (const entity of exampleEntities) {
            const sparql = `SELECT DISTINCT ?p WHERE {
                wd:${entity} ?p ?v .
                FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
                BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
                ?p2 wikibase:propertyType ?type ..
                FILTER (?type != wikibase:ExternalId) .
                ${includeNonEntityProperties ? '' : entityOnlyFilter }
            } `;
            const res = await this._query(sparql);
            res.forEach((r : any) => {
                const property = r.p.value.slice(PROPERTY_PREFIX.length);
                if (property === 'P31' || PROPERTY_BLACKLIST.includes(property)) {
                    if (!(property in propertyCounter))
                        propertyCounter[property] = 0;
                    propertyCounter[property] += 1;
                }
            });
        }
        // a property is included only if at least two entities have it
        return Object.keys(propertyCounter).filter((p) => propertyCounter[p] >= 2);
    }

    /**
     * Given a domain and a property, find if the property has the pre-selected qualifiers
     * Currently, only start time, end time, and point in time 
     * @param domain QID
     * @param property PID
     * @returns a list of qualifiers PID 
     */
    async getQualifiersByProperty(domain : string, property : string) : Promise<string[]> {
        const qualifierCount : Record<string, number> = Object.keys(this.qualifiers).reduce((counter, q) => 
            Object.assign(counter, { [q]: 0 }), {}
        );
        const optionalStatements = Object.keys(this.qualifiers).map((q) => `OPTIONAL { ?statement pq:${q} ?${q}. }`);
        const sparql = `SELECT DISTINCT ?entity ${Object.keys(this.qualifiers).map((q) => `?${q}`).join(' ')} WHERE {
            ?entity wdt:P31 wd:${domain} .
            ?entity p:${property} ?statement .
            ${optionalStatements.join(' ')}
        } LIMIT 100`;
        const res = await this._query(sparql);
        res.forEach((r : any) => {
            for (const qualifier in this.qualifiers) {
                if (qualifier in r)
                    qualifierCount[qualifier] += 1;
            }
        });
        // a qualifier is included only if there are two instances among the examples
        return Object.keys(this.qualifiers).filter((q) => qualifierCount[q] >= 2);
    } 

    /**
     * Get properties and their values for a given domain
     * 
     * First get 100 example entities in the domain, and then extract all properties 
     * they use and their values
     * 
     * @param domain QID of the domain
     * @param includeNonEntityProperties include properties whose values are not Wikidata entities 
     * @returns an object where key is property PID, values are either an array of string/entity objects, or a type 
     */
    async getDomainPropertiesAndValues(domain : string, includeNonEntityProperties = false) : Promise<Record<string, any>> {
        const properties : Record<string, string[]> = {};
        const propertyCounter : Record<string, number> = {};
        const exampleEntities = await this.getEntitiesByDomain(domain);
        const entityOnlyFilter = `FILTER(STRSTARTS(STR(?v), "${ENTITY_PREFIX}")) .`;
        for (const entity of exampleEntities) {
            const sparql = `SELECT DISTINCT ?p ?v WHERE {
                wd:${entity} ?p ?v .
                FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
                BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
                ?p2 wikibase:propertyType ?type .
                FILTER (?type != wikibase:ExternalId) .
                ${includeNonEntityProperties ? '' : entityOnlyFilter }
            } `;
            const res = await this._query(sparql);
            res.forEach((r : any) => {
                const property = r.p.value.slice(PROPERTY_PREFIX.length);
                if (property === 'P31' || PROPERTY_BLACKLIST.includes(property))
                    return;
                const value = r.v.value.startsWith(ENTITY_PREFIX) ? r.v.value.slice(ENTITY_PREFIX.length) : r.v.value; 
                if (!(property in properties))
                    properties[property] = [];
                if (!(property in propertyCounter))
                    propertyCounter[property] = 0;
                properties[property].push(value);
                propertyCounter[property] += 1;
            });
        }
        // a property is included only if at least two entities have it
        Object.entries(propertyCounter).forEach(([property, count]) => {
            if (count < 2)
                delete properties[property];
        });
        return properties;
    }


    /**
     * Get properties that are marked as "Wikidata property with datatype 'time'"
     * 
     * @returns a list of property ids 
     */
    async getTimeProperties() {
        const sparql = `SELECT DISTINCT ?p WHERE {
            ?p wdt:P31 wd:Q18636219 ;
        }`;
        const res = await this._query(sparql);
        return res.map((r : any) => r.p.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get the allowed units (Q21514353) of a property
     * This allows to detect Measure types
     *
     * @param propertyId
     * @returns A list of allowed units
     */
    async getAllowedUnits(propertyId : string) : Promise<string[]> {
        const query = `SELECT ?value ?valueLabel WHERE {
            wd:${propertyId} p:P2302 ?statement .
            ?statement ps:P2302 wd:Q21514353 .
            ?statement pq:P2305 ?value .
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }`;
        const result = await this._query(query);
        return result.map((r : any) => r.valueLabel.value);
    }

    /**
     * Get range constraint
     *
     * @param propertyId
     * @returns range or null
     */
    async getRangeConstraint(propertyId : string) : Promise<Record<string, number>|null> {
        const query = `SELECT ?max ?min WHERE {
            wd:${propertyId} p:P2302 ?statement .
            ?statement ps:P2302 wd:Q21510860 .
            ?statement pq:P2312 ?max .
            ?statement pq:P2313 ?min .
        }`;
        const result = await this._query(query);
        if (result.length > 0) {
            const range : Record<string, number> = {};
            if (result[0].max)
                range.max = result[0].max.value;
            if (result[0].min)
                range.min = result[0].min.value;
            if (Object.keys(range).length > 0)
                return range;
        }
        return null;
    }

    /**
     * Return 
     * @param propertyId 
     * @returns wikibaseType 
     */
    async getPropertyType(propertyId : string) : Promise<string> {
        if (Object.keys(this._properties).length === 0) {   
            const query = `SELECT ?p ?type WHERE {
                ?p wikibase:propertyType ?type . 
                FILTER (?type != wikibase:ExternalId)
            }`;
            const result = await this._query(query);
            result.forEach((r : any) => {
                const property : string = r.p.value;
                const type : string = r.type.value;
                let wikibaseType = type.slice('http://wikiba.se/ontology#'.length);
                if (!['WikibaseItem', 'String', 'Quantity', 'Time', 'Monolingualtext', 'Url'].includes(wikibaseType))
                    wikibaseType = 'Unsupported';
                this._properties[property.slice(ENTITY_PREFIX.length)] = wikibaseType as WikibaseType;
            });
        }
        return this._properties[propertyId];
    }

    /**
     * guess if the thingtalk type of a value is string
     * @param value a string of value
     * @returns if the value is a string value
     */
    isStringValue(value : string) : boolean {
        // preprocessed entity type 
        if (/^Q[0-9]+$/.test(value))
            return false;
        // raw entity, url, pictures
        if (value.startsWith('http://') || value.startsWith('https://'))
            return false;
        // date
        if (!isNaN(Date.parse(value)))
            return false;
        // number, measurement
        if (!isNaN(+value))
            return false;
        return true;
    }

    /**
     * guess if the thingtalk type of a value is number
     * @param value a string of value
     * @returns if the value is a number value
     */
    isNumber(value : string) : boolean {
        return !isNaN(+value);
    }

    /**
     * guess if the thingtalk type of a value is entity
     * @param value a string of value
     * @returns if the value is a entity value
     */
    isEntity(value : string) : boolean {
        return /^Q[0-9]+$/.test(value);
    }
}