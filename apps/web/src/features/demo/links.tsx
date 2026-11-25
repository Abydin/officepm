import { cn } from '@/lib/utils';

/** The one place the project's address is written. */
export const REPO_URL = 'https://github.com/Abydin/officepm';
/** The README, which is the documentation. */
export const DOCS_URL = `${REPO_URL}#readme`;
/** The Docker steps in the README's Quick start: the shortest way to run your own copy. */
export const SETUP_URL = `${REPO_URL}#with-docker`;

/** The demo's login. The password is public (it is in the README and the seed), so showing it leaks nothing. */
export const DEMO_LOGIN = {
  email: 'maya.okafor@officepm.demo',
  password: 'demo-password',
} as const;
export const DEMO_LOGIN_HINT = `Try it: ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}`;

const link = 'text-fg underline underline-offset-2 hover:no-underline';

/**
 * "Documentation" and "Set up your own", for visitors of the public demo. They open in a new tab
 * without the opener or a referrer, and they leave the app, so they are plain links to the README.
 */
export function DemoLinks({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center justify-center gap-x-3', className)}>
      <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Documentation
      </a>
      <a href={SETUP_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Set up your own
      </a>
    </span>
  );
}
