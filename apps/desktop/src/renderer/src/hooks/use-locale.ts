import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from '../../../shared/localization.ts';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
