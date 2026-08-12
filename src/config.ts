import type { PlatformConfig } from 'homebridge';

export function isConfigValid(config: PlatformConfig): boolean{
    return !(
        !config.username ||
        !config.password ||
        !config.name
    );
}
