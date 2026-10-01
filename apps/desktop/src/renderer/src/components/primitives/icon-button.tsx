/*
 * `IconButton` lives in `button.tsx` now so it shares the one variant/size vocabulary, but every
 * existing import path points here and those files belong to other packages, so the module stays as
 * the compatibility path rather than being rewritten five times across surfaces this package owns.
 */
export { IconButton } from './button.tsx';
export type { IconButtonProps } from './button.tsx';
