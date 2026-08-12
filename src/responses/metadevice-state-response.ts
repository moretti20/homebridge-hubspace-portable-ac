/**
 * A single semantic state value as returned by the Afero "semantics" API
 * (`accounts/{accountId}/metadevices/{metadeviceId}/state`).
 *
 * Unlike the raw attribute API, these values are the human readable names that
 * the device advertises in its function metadata (for example `cool`,
 * `fan-speed-2-050`) or plain numbers for numeric functions.
 */
export interface MetadeviceStateValue{
    functionClass: string;
    functionInstance?: string | null;
    value: unknown;
    lastUpdateTime?: number;
}

export interface MetadeviceStateResponse{
    metadeviceId: string;
    values: MetadeviceStateValue[];
}

/** Builds the lookup key used to index state values. */
export function stateKey(functionClass: string, functionInstance?: string | null): string{
    return functionInstance ? `${functionClass}::${functionInstance}` : functionClass;
}
