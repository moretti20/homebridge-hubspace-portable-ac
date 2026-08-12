export interface DeviceStatusResponse{
    deviceId: string;
    attributes: {
        id: number;
        data: string;
        value: string;
        updatedTimestamp: number;
    }[];
    deviceState: {
        available: boolean;
    };
}
