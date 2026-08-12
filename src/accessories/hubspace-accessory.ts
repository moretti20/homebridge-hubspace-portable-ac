import type { PlatformConfig, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import type { Device } from '../models/device';
import { DeviceFunction } from '../models/device-functions';
import type { HubspacePlatform } from '../platform';
import type { DeviceService } from '../services/device.service';

export abstract class HubspaceAccessory{
    protected readonly services: Service[] = [];
    protected readonly log: Logger;
    protected readonly config: PlatformConfig;
    protected readonly deviceService: DeviceService;
    protected readonly device: Device;

    constructor(
        protected readonly platform: HubspacePlatform,
        protected readonly accessory: PlatformAccessory,
        services: (Service | WithUUID<typeof Service>)[]
    ) {
        for (const service of services) {
            this.services.push(this.resolveService(accessory, service));
        }

        this.config = platform.config;
        this.log = platform.log;
        this.deviceService = platform.deviceService;
        this.device = accessory.context.device;

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, this.device.manufacturer ?? 'N/A')
            .setCharacteristic(this.platform.Characteristic.Model, this.device.model.length > 0 ? this.device.model[0] : 'N/A')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.deviceId ?? 'N/A');
    }

    /**
     * Returns the accessory's existing service, or adds it.
     *
     * Matching is done on UUID + subtype rather than display name so that
     * renaming a service between plugin versions reuses the cached service
     * instead of trying to add a duplicate, which HAP rejects.
     */
    private resolveService(accessory: PlatformAccessory, service: Service | WithUUID<typeof Service>): Service{
        if(service instanceof this.platform.api.hap.Service){
            const template = service as Service;
            const existing = accessory.services.find(s =>
                s.UUID === template.UUID && (s.subtype ?? undefined) === (template.subtype ?? undefined));

            if(existing){
                existing.displayName = template.displayName;
                return existing;
            }

            return accessory.addService(template);
        }

        const constructor = service as WithUUID<typeof Service>;
        // HAP accepts a constructor at runtime; the typings only declare the Service overload.
        return accessory.getService(constructor) ?? accessory.addService(constructor as unknown as Service);
    }

    protected supportsFunction(deviceFunction: DeviceFunction): boolean{
        return this.device.functions.some(fc => fc.functionClass === deviceFunction);
    }

    protected removeStaleServices(): void{
        const keep = new Set<Service>(this.services);
        const protectedUuids = new Set<string>([
            this.platform.Service.AccessoryInformation.UUID,
            this.platform.Service.ProtocolInformation.UUID
        ]);

        const staleServices = this.accessory.services
            .filter(s => !keep.has(s) && !protectedUuids.has(s.UUID));

        for (const staleService of staleServices) {
            this.log.info(`Removing stale service '${staleService.displayName}' from ${this.accessory.displayName}.`);
            this.accessory.removeService(staleService);
        }
    }

    protected configureName(service: Service, name: string): void{
        service.setCharacteristic(this.platform.Characteristic.Name, name);

        // ConfiguredName is what iOS shows for individual tiles, but it is only
        // an optional characteristic on some services.
        try{
            service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
        }catch{
            this.log.debug(`Service '${service.displayName}' does not support ConfiguredName.`);
        }
    }
}
