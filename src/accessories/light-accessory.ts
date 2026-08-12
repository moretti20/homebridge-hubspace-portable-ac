import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import type { HubspacePlatform } from '../platform';
import { HubspaceAccessory } from './hubspace-accessory';
import { isNullOrUndefined } from '../utils';
import { DeviceFunction, getDeviceFunctionDef } from '../models/device-functions';

export class LightAccessory extends HubspaceAccessory{
    constructor(platform: HubspacePlatform, accessory: PlatformAccessory) {
        super(platform, accessory, [platform.Service.Lightbulb]);
        this.services[0].getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));

        if(this.supportsFunction(DeviceFunction.Brightness)){
            this.services[0].getCharacteristic(this.platform.Characteristic.Brightness)
                .onGet(this.getBrightness.bind(this))
                .onSet(this.setBrightness.bind(this));
        }

        this.removeStaleServices();
    }

    private async getOn(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Power);
        const value = await this.deviceService.getValueAsBoolean(this.device.deviceId, func.values[0].deviceValues[0].key);
        if(isNullOrUndefined(value)) {
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return value!;
    }

    private async setOn(value: CharacteristicValue): Promise<void>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Power);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }

    private async getBrightness(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Brightness);
        const value = await this.deviceService.getValueAsInteger(this.device.deviceId, func.values[0].deviceValues[0].key);
        if(isNullOrUndefined(value)) {
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return value!;
    }

    private async setBrightness(value: CharacteristicValue): Promise<void>{
        if(Number(value) === 0) return;
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Brightness);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }
}
