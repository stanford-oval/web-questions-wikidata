type ConversionErrorCode =  
    'UnmappedEntity' |
    'UnmappedProperty' |
    'UnknownEntity' |
    'UnknownProperty' |
    'Unsupported';

export class ConversionError extends Error {
    public code : ConversionErrorCode;

    constructor(code : ConversionErrorCode, msg ?: string) {
        super(msg);
        this.code = code;
    }
}