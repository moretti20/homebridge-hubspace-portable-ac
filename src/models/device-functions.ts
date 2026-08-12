import type { DeviceFunctionDef } from './device-function-def';
import type { DeviceFunctionResponse } from '../responses/device-function-response';

export enum DeviceFunction{
    Power = 'power',
    Brightness = 'brightness',
    FanLightPower = 'light-power',
    FanPower = 'fan-power',
    FanSpeed = 'fan-speed',
    OutletPower = 'power',
    LightTemperature = 'color-temperature',
    LightColor = 'color-rgb',
    ColorMode = 'color-mode',

    Toggle = 'toggle',
    MaxOnTime = 'max-on-time',
    BatteryLevel = 'battery-level',
    Timer = 'timer',
    Spigot1 = 'spigot-1',
    Spigot2 = 'spigot-2',

    CurrentTemperature = 'temperature',
    CoolingTarget = 'temperature',
    AcFanSpeed = 'fan-speed',
    Mode = 'mode'
}

export const DeviceFunctions: DeviceFunctionDef[] = [
    { functionClass: DeviceFunction.Power, functionInstanceName: DeviceFunction.FanLightPower },
    { functionClass: DeviceFunction.Power, functionInstanceName: DeviceFunction.FanPower },
    { functionClass: DeviceFunction.FanSpeed, functionInstanceName: DeviceFunction.FanSpeed },
    { functionClass: DeviceFunction.Power },
    { functionClass: DeviceFunction.Brightness },
    { functionClass: DeviceFunction.OutletPower },
    { functionClass: DeviceFunction.LightTemperature },
    { functionClass: DeviceFunction.LightColor },
    { functionClass: DeviceFunction.ColorMode },
    { functionClass: DeviceFunction.BatteryLevel },

    { functionClass: DeviceFunction.Toggle, functionInstanceName: DeviceFunction.Spigot1 },
    { functionClass: DeviceFunction.MaxOnTime, functionInstanceName: DeviceFunction.Spigot1 },
    { functionClass: DeviceFunction.Timer, functionInstanceName: DeviceFunction.Spigot1 },
    { functionClass: DeviceFunction.Toggle, functionInstanceName: DeviceFunction.Spigot2 },
    { functionClass: DeviceFunction.MaxOnTime, functionInstanceName: DeviceFunction.Spigot2 },
    { functionClass: DeviceFunction.Timer, functionInstanceName: DeviceFunction.Spigot2 },

    { functionClass: DeviceFunction.CurrentTemperature, functionInstanceName: 'current-temp' },
    { functionClass: DeviceFunction.CoolingTarget, functionInstanceName: 'cooling-target' },
    { functionClass: DeviceFunction.AcFanSpeed, functionInstanceName: 'ac-fan-speed' },
    { functionClass: DeviceFunction.Mode }
];

/** Looks up a function definition, returning undefined instead of throwing. */
export function tryGetDeviceFunctionDef(
    deviceFunctionResponse: DeviceFunctionResponse[],
    deviceFunction: DeviceFunction | string,
    deviceFunctionInstance?: DeviceFunction | string
): DeviceFunctionResponse | undefined{
    return deviceFunctionResponse.find(fc => fc.functionClass === deviceFunction &&
        (deviceFunctionInstance ? fc.functionInstance === deviceFunctionInstance : true));
}

export function getDeviceFunctionDef(
    deviceFunctionResponse: DeviceFunctionResponse[],
    deviceFunction: DeviceFunction,
    deviceFunctionInstance?: DeviceFunction | string
): DeviceFunctionResponse{
    const fc = tryGetDeviceFunctionDef(deviceFunctionResponse, deviceFunction, deviceFunctionInstance);

    if(!fc){
        throw new Error(`Failed to get function definition for '${deviceFunction}'. Each function requires to set a definition.`);
    }

    return fc;
}
