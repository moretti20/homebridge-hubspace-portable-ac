import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { DeviceFunction, getDeviceFunctionDef } from '../models/device-functions';
import type { HubspacePlatform } from '../platform';
import { isNullOrUndefined } from '../utils';
import { HubspaceAccessory } from './hubspace-accessory';

export class SprinklerAccessory extends HubspaceAccessory{
    constructor(platform: HubspacePlatform, accessory: PlatformAccessory) {
        super(platform, accessory, [
            new platform.Service.Valve('Spigot 1', '1'),
            new platform.Service.Valve('Spigot 2', '2'),
            platform.Service.Battery
        ]);

        this.configureValve(0, DeviceFunction.Spigot1);
        this.configureValve(1, DeviceFunction.Spigot2);

        if(this.supportsFunction(DeviceFunction.BatteryLevel)){
            this.services[2].getCharacteristic(this.platform.Characteristic.BatteryLevel)
                .onGet(this.getBatteryLevel.bind(this));
        }

        this.removeStaleServices();
    }

    private configureValve(index: number, instance: DeviceFunction): void{
        this.services[index].getCharacteristic(this.platform.Characteristic.Active)
            .onGet(() => this.getActive(instance))
            .onSet(value => this.setActive(instance, value));

        this.services[index].getCharacteristic(this.platform.Characteristic.InUse)
            .onGet(() => this.getInUse(instance));

        this.services[index].getCharacteristic(this.platform.Characteristic.ValveType)
            .onGet(() => this.platform.api.hap.Characteristic.ValveType.IRRIGATION);
    }

    private async getActive(instance: DeviceFunction): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Toggle, instance);
        const value = await this.deviceService.getValueAsBoolean(this.device.deviceId, func.values[0].deviceValues[0].key);
        if(isNullOrUndefined(value)) throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        return value ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
    }

    private async setActive(instance: DeviceFunction, value: CharacteristicValue): Promise<void>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.Toggle, instance);
        await this.deviceService.setValue(this.device.deviceId, func.values[0].deviceValues[0].key, value);
    }

    private async getInUse(instance: DeviceFunction): Promise<CharacteristicValue>{
        const active = await this.getActive(instance);
        return active === this.platform.Characteristic.Active.ACTIVE
            ? this.platform.Characteristic.InUse.IN_USE
            : this.platform.Characteristic.InUse.NOT_IN_USE;
    }

    private async getBatteryLevel(): Promise<CharacteristicValue>{
        const func = getDeviceFunctionDef(this.device.functions, DeviceFunction.BatteryLevel);
        const value = await this.deviceService.getValueAsInteger(this.device.deviceId, func.values[0].deviceValues[0].key);
        if(isNullOrUndefined(value)) throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        return value!;
    }
}
