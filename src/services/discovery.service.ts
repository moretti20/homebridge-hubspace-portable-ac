import type { PlatformAccessory } from 'homebridge';
import type { HubspacePlatform } from '../platform';
import type { DeviceResponse } from '../responses/devices-response';
import { PLATFORM_NAME, PLUGIN_NAME } from '../settings';
import { Endpoints } from '../api/endpoints';
import { createHttpClientWithBearerInterceptor } from '../api/http-client-factory';
import { getDeviceTypeForKey } from '../models/device-type';
import type { Device } from '../models/device';
import { createAccessoryForDevice } from '../accessories/device-accessory-factory';
import type { AxiosError } from 'axios';
import { DeviceFunctions } from '../models/device-functions';
import type { DeviceFunctionResponse } from '../responses/device-function-response';

export class DiscoveryService{
    private readonly _httpClient = createHttpClientWithBearerInterceptor({
        baseURL: Endpoints.API_BASE_URL,
        headers: { host: 'semantics2.afero.net' }
    });

    private _cachedAccessories: PlatformAccessory[] = [];

    constructor(private readonly _platform: HubspacePlatform) { }

    configureCachedAccessory(accessory: PlatformAccessory): void{
        this._cachedAccessories.push(accessory);
    }

    async discoverDevices() {
        const devices = await this.getDevicesForAccount();

        for (const device of devices) {
            let existingAccessory = this._cachedAccessories.find(accessory => accessory.UUID === device.uuid);

            if (existingAccessory) {
                this._platform.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                this.registerCachedAccessory(existingAccessory, device);
            } else {
                this._platform.log.info('Adding new accessory:', device.name);
                existingAccessory = this.registerNewAccessory(device);
            }

            try{
                createAccessoryForDevice(device, this._platform, existingAccessory);
            }catch(ex){
                // One misbehaving device must not stop the rest from loading.
                const message = ex instanceof Error ? ex.message : String(ex);
                this._platform.log.error(`Failed to configure '${device.name}' (${device.type}): ${message}`);
            }
        }

        this.clearStaleAccessories(this._cachedAccessories.filter(a => !devices.some(d => d.uuid === a.UUID)));
    }

    private clearStaleAccessories(staleAccessories: PlatformAccessory[]): void{
        if(staleAccessories.length === 0) return;

        this._platform.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);

        for(const accessory of staleAccessories){
            const cacheIndex = this._cachedAccessories.findIndex(a => a.UUID === accessory.UUID);
            if(cacheIndex < 0) continue;
            this._platform.log.info('Removing stale accessory:', accessory.displayName);
            this._cachedAccessories.splice(cacheIndex, 1);
        }
    }

    private registerCachedAccessory(accessory: PlatformAccessory, device: Device): void{
        accessory.context.device = device;
        this._platform.api.updatePlatformAccessories([ accessory ]);
    }

    private registerNewAccessory(device: Device): PlatformAccessory{
        const accessory = new this._platform.api.platformAccessory(device.name, device.uuid);
        accessory.context.device = device;
        this._platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        return accessory;
    }

    private async getDevicesForAccount(): Promise<Device[]>{
        try{
            const response = await this._httpClient.get<DeviceResponse[]>(
                `accounts/${this._platform.accountService.accountId}/metadevices`
            );

            return response.data
                .filter(d => d.children.length === 0 && d.typeId === 'metadevice.device')
                .map(this.mapDeviceResponseToModel.bind(this))
                .filter(d => d !== undefined) as Device[];
        }catch(ex){
            this._platform.log.error('Failed to get devices for account.', (<AxiosError>ex).message);
            return [];
        }
    }

    private mapDeviceResponseToModel(response: DeviceResponse): Device | undefined{
        const deviceClass = response.description?.device?.deviceClass ?? '';
        const type = getDeviceTypeForKey(deviceClass);

        if(!type){
            this._platform.log.debug(
                `Skipping '${response.friendlyName}': device class '${deviceClass}' is not supported by this plugin.`
            );
            return undefined;
        }

        const model = response.description.device.model;

        return {
            id: response.id,
            uuid: this._platform.api.hap.uuid.generate(response.id),
            deviceId: response.deviceId,
            name: (response.friendlyName ?? '').trim() || response.description.device.defaultName || 'Hubspace Device',
            type: type,
            manufacturer: response.description.device.manufacturerName,
            model: typeof model === 'string' && model.length > 0 ? model.split(',').map(m => m.trim()) : [],
            functions: this.getSupportedFunctionsFromResponse(response.description.functions ?? [])
        };
    }

    private getSupportedFunctionsFromResponse(supportedFunctions: DeviceFunctionResponse[]): DeviceFunctionResponse[]{
        const output: DeviceFunctionResponse[] = [];

        for(const df of DeviceFunctions){
            const type = supportedFunctions.find(
                fc => df.functionInstanceName === fc.functionInstance && df.functionClass === fc.functionClass
            );

            if(type === undefined || output.indexOf(type) >= 0) continue;
            output.push(type);
        }

        return output;
    }
}
