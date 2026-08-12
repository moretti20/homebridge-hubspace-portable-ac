import type { AxiosInstance, CreateAxiosDefaults } from 'axios';
import axios from 'axios';
import { addBearerToken } from './interceptors';

export function createHttpClientWithBearerInterceptor(config?: CreateAxiosDefaults<unknown> | undefined): AxiosInstance{
    const client = axios.create(config);
    client.interceptors.request.use(addBearerToken);
    return client;
}
