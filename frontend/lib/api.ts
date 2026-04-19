const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const configuredInternalApiBaseUrl = process.env.INTERNAL_API_BASE_URL?.trim() ?? '';
const configuredInternalApiHostPort = process.env.INTERNAL_API_HOSTPORT?.trim() ?? '';
const normalizeInternalApiBaseUrl = (value: string): string => {
  if (!value) {
    return '';
  }

  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
};
const INTERNAL_API_BASE_URL =
  configuredInternalApiBaseUrl || normalizeInternalApiBaseUrl(configuredInternalApiHostPort);
const PUBLIC_API_BASE_URL =
  configuredApiBaseUrl || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '');
const SERVER_API_BASE_URL =
  INTERNAL_API_BASE_URL || PUBLIC_API_BASE_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '');

export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (typeof window === 'undefined') {
    const serverBaseUrl = SERVER_API_BASE_URL.replace(/\/$/, '');
    return serverBaseUrl ? `${serverBaseUrl}${normalizedPath}` : normalizedPath;
  }

  const publicBaseUrl = PUBLIC_API_BASE_URL.replace(/\/$/, '');
  return publicBaseUrl ? `${publicBaseUrl}${normalizedPath}` : normalizedPath;
};

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;
const DATA_URL_REGEX = /^data:/i;
const LOCAL_IMAGE_PREFIX = '/images/';
const UPLOADS_PREFIX = '/uploads/';
const DEFAULT_PLACEHOLDER = `${LOCAL_IMAGE_PREFIX}gaumaya-ghee.jpg`;

export const resolveImageUrl = (imageUrl: string | null | undefined): string => {
  const normalized = imageUrl?.trim();

  if (!normalized) {
    return DEFAULT_PLACEHOLDER;
  }

  if (ABSOLUTE_URL_REGEX.test(normalized) || DATA_URL_REGEX.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith(UPLOADS_PREFIX)) {
    // Legacy local-upload path: fall back to a bundled placeholder until images are reuploaded to cloud.
    return DEFAULT_PLACEHOLDER;
  }

  if (normalized.startsWith(LOCAL_IMAGE_PREFIX)) {
    return normalized;
  }

  const normalizedPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const apiBase = PUBLIC_API_BASE_URL.replace(/\/$/, '');

  if (!apiBase) {
    return normalizedPath;
  }

  return `${apiBase}${normalizedPath}`;
};
