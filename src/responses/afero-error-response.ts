import { isNullOrUndefined } from '../utils';

export interface AferoErrorResponse{
    timestamp: number;
    status: number;
    error_description: string;
    path: string;
}

export function isAferoError(error: any): error is AferoErrorResponse{
    if(error === null || typeof error !== 'object') return false;
    return isNullOrUndefined(error.timestamp, error.status, error.status_description, error.path);
}
