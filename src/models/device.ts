import type { DeviceFunctionResponse } from '../responses/device-function-response';
import { DeviceType } from './device-type';

export interface Device{
    id: string;
    uuid: string;
    deviceId: string;
    name: string;
    type: DeviceType;
    manufacturer: string;
    model: string[];
    functions: DeviceFunctionResponse[];
}
