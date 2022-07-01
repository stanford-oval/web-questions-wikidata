import fs from 'fs';
import path from 'path';

export class FB2WDMapper {
    private entityMappings : Record<string, string>;
    private propertyMappings : Record<string, string>;
    private reversePropertyMappings : Record<string, string>;

    constructor() {
        const entityMappings = {
            official: JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/entity-mappings.json'), 'utf-8')),
            manual: JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/manual-entity-mappings.json'), 'utf-8')),
        };
        const propertyMappings = {
            official: JSON.parse(fs.readFileSync(path.join(__dirname, `../../../data/property-mappings.json`), 'utf-8')),
            manual: JSON.parse(fs.readFileSync(path.join(__dirname, `../../../data/manual-property-mappings.json`), 'utf-8'))
        };
        const reversePropertyMappings = {
            official: JSON.parse(fs.readFileSync(path.join(__dirname, `../../../data/reverse-property-mappings.json`), 'utf-8')),
            manual: JSON.parse(fs.readFileSync(path.join(__dirname, `../../../data/manual-reverse-property-mappings.json`), 'utf-8'))
        };
        this.entityMappings = { ...entityMappings.official, ...entityMappings.manual };
        this.propertyMappings = { ...propertyMappings.official, ...propertyMappings.manual };
        this.reversePropertyMappings = { ...reversePropertyMappings.official, ...reversePropertyMappings.manual };
    }

    hasEntity(fb_id : string) : boolean {
        return fb_id in this.entityMappings;
    }

    addEntity(fb_id : string, wd_id : string) {
        this.entityMappings[fb_id] = wd_id;
    }

    hasProperty(fb_id : string) : boolean {
        return fb_id in this.propertyMappings;
    }

    hasReverseProperty(fb_id : string) : boolean {
        return fb_id in this.reversePropertyMappings;
    }

    map(fb_id : string) : string|null {
        if (this.hasEntity(fb_id))
            return this.entityMappings[fb_id];
        if (this.hasProperty(fb_id))
            return this.propertyMappings[fb_id];
        if (this.hasReverseProperty(fb_id))
            return this.reversePropertyMappings[fb_id];
        return null;
    }
}