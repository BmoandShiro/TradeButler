// Finnhub API key management utility

export const FINNHUB_API_KEY = "tradebutler_finnhub_api_key";

export const getFinnhubApiKey = (): string | null => {
  return localStorage.getItem(FINNHUB_API_KEY);
};

export const setFinnhubApiKey = (apiKey: string): void => {
  localStorage.setItem(FINNHUB_API_KEY, apiKey);
};

export const removeFinnhubApiKey = (): void => {
  localStorage.removeItem(FINNHUB_API_KEY);
};

export const hasFinnhubApiKey = (): boolean => {
  const key = getFinnhubApiKey();
  return key !== null && key.trim().length > 0;
};
