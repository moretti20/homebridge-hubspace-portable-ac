import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { DeviceFunction, getDeviceFunctionDef } from '../models/device-functions';
import type { HubspacePlatform } from '../platform';
import { isNullOrUndefined } from '../utils';
import { HubspaceAccessory } from './hubspace-accessory';

export class OutletAccessory extends HubspaceAccessory{
    constructor(platform: HubspacePlatform, accessory: PlatformAccessory) {
        super(platform, accessory, [platform.Service.Outlet]);
        this.configurePower();
        this.removeStaleServices();
    }

    private configurePower(): void{
        if(this.supportsFunction(DeviceFunction.OutletPower)){
            this.services[0].getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.getOn.bind(this))
                .onSet(this.setOn.bind(this));
        }
    }

    private async getOn(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.OutletPower);
        const value = await this.deviceService.getValueAsBoolean(this.device.deviceId, func.values[0].deviceValues[0].key);

        if(isNullOrUndefined(value)){
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        return value!;
    }

    private async setOn(value: CharacteristicValue): Promise<void>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.OutletPower);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }
}
