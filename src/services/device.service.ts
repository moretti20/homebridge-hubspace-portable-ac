import type { HubspacePlatform } from '../platform';
import { Endpoints } from '../api/endpoints';
import { createHttpClientWithBearerInterceptor } from '../api/http-client-factory';
import type { AxiosError, AxiosResponse } from 'axios';
import type { DeviceStatusResponse } from '../responses/device-status-response';
import type { CharacteristicValue } from 'homebridge';
import { convertNumberToHexReverse } from '../utils';
import { isAferoError } from '../responses/afero-error-response';
import type { MetadeviceStateResponse, MetadeviceStateValue } from '../responses/metadevice-state-response';

export class DeviceService{
    private readonly _httpClient = createHttpClientWithBearerInterceptor({
        baseURL: Endpoints.API_BASE_URL
    });

    /**
     * Client for the Afero "semantics" API. That API speaks in the same human
     * readable function values a device advertises in its own metadata, which
     * avoids having to guess at raw attribute byte encodings.
     */
    private readonly _semanticsClient = createHttpClientWithBearerInterceptor({
        baseURL: Endpoints.API_BASE_URL,
        headers: {
            host: 'semantics2.afero.net',
            'content-type': 'application/json; charset=utf-8'
        }
    });

    /** De-duplicates concurrent state reads for the same metadevice. */
    private readonly _inflightStateReads = new Map<string, Promise<MetadeviceStateValue[] | undefined>>();

    constructor(private readonly _platform: HubspacePlatform){ }

    /**
     * Reads the full semantic state for a metadevice.
     *
     * HomeKit requests every characteristic of an accessory at roughly the same
     * moment, so concurrent calls for one device share a single HTTP request.
     */
    async getMetadeviceState(metadeviceId: string): Promise<MetadeviceStateValue[] | undefined>{
        const existing = this._inflightStateReads.get(metadeviceId);
        if(existing) return existing;

        const request = this.fetchMetadeviceState(metadeviceId)
            .finally(() => this._inflightStateReads.delete(metadeviceId));

        this._inflightStateReads.set(metadeviceId, request);
        return request;
    }

    /** Writes a single semantic function value for a metadevice. */
    async setMetadeviceState(
        metadeviceId: string,
        functionClass: string,
        functionInstance: string | undefined,
        value: string | number | boolean
    ): Promise<boolean>{
        const payload = {
            metadeviceId: metadeviceId,
            values: [
                {
                    functionClass: functionClass,
                    functionInstance: functionInstance ?? null,
                    lastUpdateTime: Date.now(),
                    value: value
                }
            ]
        };

        const label = functionInstance ? `${functionClass}/${functionInstance}` : functionClass;

        try{
            const response = await this._semanticsClient.put(
                `accounts/${this._platform.accountService.accountId}/metadevices/${metadeviceId}/state`,
                payload
            );

            if(response.status >= 200 && response.status < 300){
                this._platform.log.debug(`Hubspace accepted ${label} = ${value}.`);
                return true;
            }

            this._platform.log.error(`Hubspace rejected ${label} = ${value} (HTTP ${response.status}).`);
            return false;
        }catch(ex){
            this._platform.log.error(`Failed to write ${label} = ${value}.`);
            this.handleError(<AxiosError>ex);
            return false;
        }
    }

    private async fetchMetadeviceState(metadeviceId: string): Promise<MetadeviceStateValue[] | undefined>{
        try{
            const response = await this._semanticsClient.get<MetadeviceStateResponse>(
                `accounts/${this._platform.accountService.accountId}/metadevices/${metadeviceId}/state`
            );

            return response.data?.values ?? undefined;
        }catch(ex){
            this.handleError(<AxiosError>ex);
            return undefined;
        }
    }

    async setValue(deviceId: string, attributeId: string, value: CharacteristicValue): Promise<void>{
        let response: AxiosResponse;

        try{
            response = await this._httpClient.post(
                `accounts/${this._platform.accountService.accountId}/devices/${deviceId}/actions`,
                {
                    type: 'attribute_write',
                    attrId: attributeId,
                    data: this.getDataValue(value)
                }
            );
        }catch(ex){
            this.handleError(<AxiosError>ex);
            return;
        }

        if(response.status === 200) return;
        this._platform.log.error(`Remote server did not accept new value ${value} for device (ID: ${deviceId}).`);
    }

    async getValue(deviceId: string, attributeId: string): Promise<CharacteristicValue | undefined>{
        let deviceStatus: DeviceStatusResponse;

        try{
            const response = await this._httpClient.get<DeviceStatusResponse>(
                `accounts/${this._platform.accountService.accountId}/devices/${deviceId}?expansions=attributes,state`
            );
            deviceStatus = response.data;
        }catch(ex){
            this.handleError(<AxiosError>ex);
            return undefined;
        }

        if(!deviceStatus.deviceState.available) return undefined;

        const attributeResponse = deviceStatus.attributes.find(a => a.id.toString() === attributeId);

        if(!attributeResponse){
            this._platform.log.error(`Failed to find value for ${attributeId} for device (device ID: ${deviceId})`);
            return undefined;
        }

        return attributeResponse.value;
    }

    async getValueAsBoolean(deviceId: string, attributeId: string): Promise<boolean | undefined>{
        const value = await this.getValue(deviceId, attributeId);
        if(!value) return undefined;
        return value === '1';
    }

    async getAttribute(deviceId: string, attributeId: string): Promise<{value: string, updatedTimestamp: number} | undefined>{
        let deviceStatus: DeviceStatusResponse;

        try{
            const response = await this._httpClient.get<DeviceStatusResponse>(
                `accounts/${this._platform.accountService.accountId}/devices/${deviceId}?expansions=attributes,state`
            );
            deviceStatus = response.data;
        }catch(ex){
            this.handleError(<AxiosError>ex);
            return undefined;
        }

        if(!deviceStatus.deviceState.available) return undefined;
        const attr = deviceStatus.attributes.find(a => a.id.toString() === attributeId);
        if(!attr) return undefined;
        return { value: attr.value, updatedTimestamp: attr.updatedTimestamp };
    }

    async getValueAsInteger(deviceId: string, attributeId): Promise<number | undefined>{
        const value = await this.getValue(deviceId, attributeId);
        if(!value || typeof value !== 'string') return undefined;
        const numberValue = Number.parseInt(value);
        return Number.isNaN(numberValue) ? undefined : numberValue;
    }

    private getDataValue(value: CharacteristicValue): string{
        if(typeof value === 'string') return value;
        if(typeof value === 'boolean') return value ? '01' : '00';
        if(typeof value === 'number') return convertNumberToHexReverse(value);
        throw new Error('The value type is not supported.');
    }

    private handleError(error: AxiosError): void{
        const responseData = error.response?.data;
        const errorMessage = isAferoError(responseData) ? responseData.error_description : error.message;
        this._platform.log.error('The remote service returned an error.', errorMessage);
    }
}
