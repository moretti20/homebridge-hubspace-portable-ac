import { isNullOrUndefined } from '../utils';

export interface AferoErrorResponse{
    timestamp: number;
    status: number;
    error_description: string;
    path: string;
}

export function isAferoError(error: unknown): error is AferoErrorResponse{
    if(error === null || typeof error !== 'object') return false;
    const e = error as Record<string, unknown>;
    return isNullOrUndefined(e.timestamp, e.status, e.status_description, e.path);
}
