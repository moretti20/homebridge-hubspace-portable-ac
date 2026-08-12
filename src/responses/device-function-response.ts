export interface DeviceValues{
    type: string;
    key: string;
    /** Exact device byte/category value advertised by Hubspace. */
    value?: string;
}

export interface ValuesRange{
    min?: number;
    max?: number;
    step?: number;
}

export interface DeviceFunctionValues{
    name: string;
    deviceValues: DeviceValues[];
    /** Populated for numeric functions; an empty object for category functions. */
    range?: ValuesRange;
}

export interface DeviceFunctionResponse{
    functionClass: string;
    /** Absent for functions a device exposes only once (for example `mode`). */
    functionInstance?: string;
    /** Either `category` or `numeric`. */
    type?: string;
    values: DeviceFunctionValues[];
}
