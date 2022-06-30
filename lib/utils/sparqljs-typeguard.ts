import { ENTITY_PREFIX, PROPERTY_PREFIX } from './wikidata';
import { 
    IriTerm,
    VariableTerm,
    LiteralTerm,
    PropertyPath,
    BgpPattern,
    FilterPattern,
    UnionPattern,
    AggregateExpression,
    FunctionCallExpression
} from 'sparqljs';

export function isNamedNode(node : any) : node is IriTerm {
    return 'termType' in node && node.termType === 'NamedNode';
}

export function isWikidataEntityNode(node : any) : node is IriTerm {
    return 'termType' in node && node.termType === 'NamedNode' && node.value.startsWith(ENTITY_PREFIX);
}

export function isWikidataPropertyNode(node : any, pid ?: string) : node is IriTerm {
    if (pid)
        return 'termType' in node && node.termType === 'NamedNode' && node.value === PROPERTY_PREFIX + pid;
    return 'termType' in node && node.termType === 'NamedNode' && node.value.startsWith(PROPERTY_PREFIX);
}

export function isVariable(node : any) : node is VariableTerm {
    return 'termType' in node && node.termType === 'Variable';
}

export function isLiteral(node : any) : node is LiteralTerm {
    return 'termType' in node && node.termType === 'Literal';
}

export function isPropertyPath(node : any) : node is PropertyPath {
    return 'pathType' in node && ['|', '/', '^', '+', '*', '!'].includes(node.pathType);
}

export function isSequencePropertyPath(node : any) : node is PropertyPath {
    return 'pathType' in node && node.pathType === '/' && node.items.length > 1;
}

export function isUnaryPropertyPath(node : any, type ?: '+'|'*'|'!') : node is PropertyPath {
    if (type)
        return 'pathType' in node && node.pathType === type && node.items.length === 1;
    return 'pathType' in node && ['+', '*', '!'].includes(node.pathType) && node.items.length === 1;
}

export function isBasicGraphPattern(node : any) : node is BgpPattern {
    return 'type' in node && node.type === 'bgp';
}

export function isFilterPattern(node : any) : node is FilterPattern {
    return 'type' in node && node.type === 'filter';
}

export function isUnionPattern(node : any) : node is UnionPattern {
    return 'type' in node && node.type === 'union';
}

export function isAggregateExpression(node : any, aggregation ?: string) : node is AggregateExpression {
    if (aggregation)
        return 'type' in node && node.type === 'aggregate' && node.aggregation === aggregation;
    return 'type' in node && node.type === 'aggregate';
}

export function isFunctionCall(node : any) : node is FunctionCallExpression {
    return 'type' in node && node.type === 'functionCall';
}