/**
 * Which folders in the sessions folder are recorded sessions. The Discord recorder names them
 * `2026-10-04_1930-discord` (a restart in the same minute adds `-2`, `-3`, ...). Anything else
 * there (`livekit-recordings`, `.incoming`, a scratch folder) is not a session and never counts.
 */
export const SESSION_FOLDER_NAME = /^\d{4}-\d{2}-\d{2}.*-discord(?:-\d+)?$/;

export function isSessionFolderName(name: string): boolean {
  return SESSION_FOLDER_NAME.test(name);
}

/**
 * Newest first: the name starts with the date and time, then a restart in the same minute adds
 * `-N`, compared as a number (`-discord-10` is newer than `-discord-9`).
 */
export function newestSessionFirst(a: string, b: string): number {
  const split = (name: string): [string, number] => {
    const m = /^(.*-discord)(?:-(\d+))?$/.exec(name);
    return m ? [m[1] ?? name, m[2] ? Number(m[2]) : 0] : [name, 0];
  };
  const [baseA, restartA] = split(a);
  const [baseB, restartB] = split(b);
  if (baseA !== baseB) return baseA < baseB ? 1 : -1;
  return restartB - restartA;
}
