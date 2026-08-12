import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import type { HubspacePlatform } from '../platform';
import { HubspaceAccessory } from './hubspace-accessory';
import { isNullOrUndefined } from '../utils';
import { DeviceFunction, getDeviceFunctionDef } from '../models/device-functions';

export class FanAccessory extends HubspaceAccessory{
    constructor(platform: HubspacePlatform, accessory: PlatformAccessory) {
        super(platform, accessory, [platform.Service.Fanv2]);
        this.configureActive();
        this.configureRotationSpeed();
        this.removeStaleServices();
    }

    private configureActive(): void{
        this.services[0].getCharacteristic(this.platform.Characteristic.Active)
            .onGet(this.getActive.bind(this))
            .onSet(this.setActive.bind(this));
    }

    private configureRotationSpeed(): void{
        this.services[0].getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .onGet(this.getRotationSpeed.bind(this))
            .onSet(this.setRotationSpeed.bind(this))
            .setProps({ minValue: 0, maxValue: 100, minStep: 25 });
    }

    private async setActive(value: CharacteristicValue): Promise<void>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.FanPower);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }

    private async getActive(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.FanPower);
        const value = await this.deviceService.getValue(this.device.deviceId, func.values[0].deviceValues[0].key);

        if(isNullOrUndefined(value)){
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        return value!;
    }

    private async getRotationSpeed(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.FanSpeed);
        const value = await this.deviceService.getValue(this.device.deviceId, func.values[0].deviceValues[0].key);

        if(isNullOrUndefined(value)){
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        return value!;
    }

    private async setRotationSpeed(value: CharacteristicValue): Promise<void>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.FanSpeed);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }
}
