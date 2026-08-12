import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { HubspacePlatform } from './platform';

export = (api: API) => {
    api.registerPlatform(PLATFORM_NAME, HubspacePlatform);
};
