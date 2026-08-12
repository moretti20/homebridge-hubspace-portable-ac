import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic, PlatformConfig } from 'homebridge';
import { TokenService } from './services/token.service';
import { AccountService } from './services/account.service';
import { DiscoveryService } from './services/discovery.service';
import { DeviceService } from './services/device.service';
import { isConfigValid } from './config';

export class HubspacePlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
    public readonly accountService!: AccountService;
    public readonly deviceService!: DeviceService;

    private readonly _discoveryService!: DiscoveryService;
    private _isInitialized = false;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API
    ) {
        if(!isConfigValid(config)){
            this.log.error('Configuration is invalid. Platform will not start.');
            return;
        }

        TokenService.init(this.config.username, this.config.password, this.api.user.storagePath());
        this._discoveryService = new DiscoveryService(this);
        this.accountService = new AccountService(log);
        this.deviceService = new DeviceService(this);

        this.accountService.onAccountLoaded(this._discoveryService.discoverDevices.bind(this._discoveryService));
        this.api.on('didFinishLaunching', async () => this.accountService.loadAccount());

        this._isInitialized = true;
    }

    configureAccessory(accessory: PlatformAccessory) {
        if(!this._isInitialized) return;
        this._discoveryService.configureCachedAccessory(accessory);
    }
}
