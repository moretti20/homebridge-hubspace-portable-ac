import type { PlatformAccessory } from 'homebridge';
import type { Device } from '../models/device';
import { DeviceType } from '../models/device-type';
import type { HubspacePlatform } from '../platform';
import { AirConditionerAccessory } from './air-conditioner-accessory';
import { FanAccessory } from './fan-accessory';
import { HubspaceAccessory } from './hubspace-accessory';
import { LightAccessory } from './light-accessory';
import { OutletAccessory } from './outlet-accessory';
import { SprinklerAccessory } from './sprinkler-accessory';

export function createAccessoryForDevice(
    device: Device,
    platform: HubspacePlatform,
    accessory: PlatformAccessory
): HubspaceAccessory{
    switch(device.type){
        case DeviceType.Light:
            return new LightAccessory(platform, accessory);
        case DeviceType.Fan:
            return new FanAccessory(platform, accessory);
        case DeviceType.Outlet:
            return new OutletAccessory(platform, accessory);
        case DeviceType.Sprinkler:
            return new SprinklerAccessory(platform, accessory);
        case DeviceType.AirConditioner:
            return new AirConditionerAccessory(platform, accessory);
        default:
            throw new Error(`Accessory of type '${device.type}' is not supported.`);
    }
}
