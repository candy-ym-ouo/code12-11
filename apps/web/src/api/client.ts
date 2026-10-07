import axios, { AxiosError, type AxiosRequestConfig } from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export const http = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 30_000,
});

let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let refreshing: Promise<string> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

async function refreshAccessToken(): Promise<string> {
  const response = await axios.post(
    `${baseURL}/auth/refresh`,
    {},
    { withCredentials: true, timeout: 15_000 },
  );
  const token = response.data?.data?.accessToken as string;
  setAccessToken(token);
  return token;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (AxiosRequestConfig & { __retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = config?.url ?? "";
    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/refresh");

    if (status === 401 && config && !config.__retried && !isAuthEndpoint) {
      config.__retried = true;
      try {
        refreshing = refreshing ?? refreshAccessToken();
        const token = await refreshing;
        refreshing = null;
        config.headers = { ...(config.headers ?? {}), Authorization: `Bearer ${token}` };
        return http.request(config);
      } catch (refreshError) {
        refreshing = null;
        setAccessToken(null);
        unauthorizedHandler?.();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ error?: { message?: string; code?: string } }>;
  return axiosError?.response?.data?.error?.message ?? (error as Error)?.message ?? "请求失败，请稍后重试";
}
