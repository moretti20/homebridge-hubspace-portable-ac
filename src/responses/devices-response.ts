import type { DeviceFunctionResponse } from './device-function-response';

export interface DeviceResponse{
    id: string;
    deviceId: string;
    children: DeviceResponse[];
    typeId: string;
    friendlyName: string;
    description: {
        device: {
            manufacturerName: string;
            model: string;
            deviceClass: string;
            defaultName?: string;
            deviceInstance?: string;
        };
        functions: DeviceFunctionResponse[];
    };
}
