export enum DeviceType{
    Light = 'light',
    Fan = 'fan',
    Outlet = 'power-outlet',
    Sprinkler = 'sprinkler',
    AirConditioner = 'portable-air-conditioner'
}

export function getDeviceTypeForKey(key: string): DeviceType | undefined{
    switch(key){
        case 'light':
            return DeviceType.Light;
        case 'fan':
            return DeviceType.Fan;
        case 'power-outlet':
            return DeviceType.Outlet;
        case 'water-timer':
            return DeviceType.Sprinkler;
        case 'portable-air-conditioner':
            return DeviceType.AirConditioner;
        default:
            return undefined;
    }
}
