const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const API_BASE_URL =
  configuredApiBaseUrl || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '');

export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL.replace(/\/$/, '')}${normalizedPath}`;
};

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;
const DATA_URL_REGEX = /^data:/i;
const LOCAL_IMAGE_PREFIX = '/images/';

export const resolveImageUrl = (imageUrl: string | null | undefined): string => {
  const normalized = imageUrl?.trim();

  if (!normalized) {
    return `${LOCAL_IMAGE_PREFIX}gaumaya-ghee.jpg`;
  }

  if (ABSOLUTE_URL_REGEX.test(normalized) || DATA_URL_REGEX.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith(LOCAL_IMAGE_PREFIX)) {
    return normalized;
  }

  const normalizedPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const apiBase = API_BASE_URL.replace(/\/$/, '');

  if (!apiBase) {
    return normalizedPath;
  }

  return `${apiBase}${normalizedPath}`;
};
