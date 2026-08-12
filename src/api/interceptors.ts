import type { InternalAxiosRequestConfig } from 'axios';
import { TokenService } from '../services/token.service';

export async function addBearerToken(config: InternalAxiosRequestConfig<unknown>): Promise<InternalAxiosRequestConfig<unknown>>{
    const token = await TokenService.instance.getToken();

    if(token){
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
}
