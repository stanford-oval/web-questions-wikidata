export type ConversionErrorCode =  
    'NoEntityMapping' |
    'NoPropertyMapping' |
    'UnknownEntity' |
    'UnknownProperty' |
    'UnsupportedNodeType' |
    'UnsupportedPropertyType' |
    'Unsupported' |
    'Unknown';

export class ConversionError extends Error {
    public code : ConversionErrorCode;

    constructor(code : ConversionErrorCode, msg ?: string) {
        super(msg);
        this.code = code;
    }
}