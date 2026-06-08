import axios from 'axios';
import { BASE_URL } from '../../config';
import { supabase } from '../supabase';

export const api = axios.create({
  baseURL: BASE_URL,
});

const getAuthenticatedSession = async ({ refresh = false } = {}) => {
  if (refresh) {
    const {
      data: { session },
      error,
    } = await supabase.auth.refreshSession();

    if (error || !session?.access_token) {
      throw new Error('No Supabase session');
    }

    return session;
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error('No Supabase session');
  }

  return session;
};

const withAuthHeader = (config, accessToken) => {
  config.headers = {
    ...(config.headers ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };

  return config;
};

api.interceptors.request.use(async (config) => {
  const session = await getAuthenticatedSession();
  return withAuthHeader(config, session.access_token);
});

api.interceptors.response.use(undefined, async (error) => {
  const originalRequest = error.config;

  if (error.response?.status === 401 && originalRequest && !originalRequest._authRetry) {
    originalRequest._authRetry = true;
    const session = await getAuthenticatedSession({ refresh: true });
    return api(withAuthHeader(originalRequest, session.access_token));
  }

  return Promise.reject(error);
});
