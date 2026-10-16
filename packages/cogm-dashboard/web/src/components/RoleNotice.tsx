import { useSyncExternalStore, type JSX } from 'react';

import { getRoleNotice, subscribeRoleNotice } from '../lib/role';

/** One line under the header when the server answered this page as a player but left it here. */
export function RoleNotice(): JSX.Element | null {
  const notice = useSyncExternalStore(subscribeRoleNotice, getRoleNotice);
  if (!notice) return null;
  return (
    <div className="link-banner" role="alert">
      {notice}
    </div>
  );
}
