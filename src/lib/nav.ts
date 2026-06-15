import { router } from 'expo-router';

/**
 * Go back if there is history, otherwise fall back to Home. Prevents the
 * dev-only "The action 'GO_BACK' was not handled by any navigator" warning that
 * happens when back() runs with an empty stack (e.g. after a web refresh on a
 * deep screen, or after a router.replace that consumed the previous entry).
 */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
