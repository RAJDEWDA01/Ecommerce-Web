import { buildApiUrl } from '@/lib/api';

const CUSTOMER_TOKEN_KEY = 'gaumaya_customer_token';

interface RefreshSessionResponse {
  success: boolean;
  message?: string;
  token?: string;
}

export const getCustomerToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(CUSTOMER_TOKEN_KEY);
};

export const setCustomerToken = (token: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
};

export const clearCustomerToken = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(CUSTOMER_TOKEN_KEY);
};

let refreshInFlight: Promise<string | null> | null = null;

export const refreshCustomerSession = async (): Promise<string | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await fetch(buildApiUrl('/api/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      });

      const data = (await response.json()) as RefreshSessionResponse;

      if (!response.ok || !data.success || !data.token) {
        clearCustomerToken();
        return null;
      }

      setCustomerToken(data.token);
      return data.token;
    } catch {
      clearCustomerToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
};

const addAuthHeader = (headers: Headers, token: string | null): Headers => {
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
};

export const customerApiFetch = async (
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  const requestUrl = buildApiUrl(path);
  const existingToken = getCustomerToken();

  const makeRequest = async (token: string | null): Promise<Response> => {
    const headers = addAuthHeader(new Headers(init.headers ?? {}), token);

    return fetch(requestUrl, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  let response = await makeRequest(existingToken);

  if ((response.status === 401 || response.status === 403) && existingToken) {
    const refreshedToken = await refreshCustomerSession();

    if (refreshedToken) {
      response = await makeRequest(refreshedToken);
    } else {
      clearCustomerToken();
    }
  }

  return response;
};

export const logoutCustomerSession = async (): Promise<void> => {
  try {
    await fetch(buildApiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Clear local token regardless of network errors.
  } finally {
    clearCustomerToken();
  }
};
