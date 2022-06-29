declare module 'wikibase-sdk' {
    export interface wikibaseSdk {
        getEntities(q : any) : string
    }

    export default function wdk(props : any) : wikibaseSdk;

}