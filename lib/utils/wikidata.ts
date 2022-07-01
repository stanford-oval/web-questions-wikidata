import * as Tp from 'thingpedia';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import { wikibaseSdk } from 'wikibase-sdk';  
import wikibase from 'wikibase-sdk';

const URL = 'https://query.wikidata.org/sparql';
export const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
export const PROPERTY_PREFIX = 'http://www.wikidata.org/prop/direct/';
export const PREFIXES = {
    'wd': 'http://www.wikidata.org/entity/',
    'wdt': 'http://www.wikidata.org/prop/direct/',
    'ps': 'http://www.wikidata.org/prop/statement/',
    'pq': 'http://www.wikidata.org/prop/qualifier/'
};

export function postprocessSparql(sparql : string) {
    // remove prefixes for simplicity
    return sparql.replace(/PREFIX [\w]+: <[^>]+\s*>/g, '').trim();
}

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
interface Constraint {
    key : string,
    value : string
}

function normalizeURL(url : string) {
    return url.trim().replace(/\s+/g, ' ');
}
 
export default class WikidataUtils {
    private _wdk : wikibaseSdk;
    private _cachePath : string;
    private _cache ! : sqlite3.Database;
    private _cacheLoaded : boolean;

    constructor(cachePath : string) {
        this._wdk = wikibase({ instance: 'https://www.wikidata.org' });
        this._cachePath = cachePath;
        this._cacheLoaded = false;
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
    async query(sparql : string) {
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
     * Get the corresponding Wikidata Entity QID given a Freebase entity
     * @param fb_id Freebase ID
     * @returns QID
     */
    async getEntityByFreebaseId(fb_id : string) : Promise<string|null> {
        if (!fb_id.startsWith('/'))
            fb_id = '/' + fb_id;
        fb_id = fb_id.replace(/\./g, '/');
        const sparql = `SELECT DISTINCT ?x WHERE { ?x wdt:P646 '${fb_id}'. }`;
        const response = await this.query(sparql);
        if (response.length > 0)
            return response[0].x.value.slice(ENTITY_PREFIX.length);
        return null;
    }
}