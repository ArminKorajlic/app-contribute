// Where a project gets updated. Contribute does not update projects itself:
// Möbius Settings owns platform updates and the App Store owns app updates,
// each with its own review and conflict handling. Contribute only says that
// an update exists and opens the place that applies it.
//
// Navigation belongs to the host; the frame only asks for it (the same
// request pattern as openGithubSettings in github-connection.js).
function askHost(message) {
  window.parent.postMessage(message, '*')
}

export function projectUpdater(project) {
  if (!project?.available || !project.canonical_repo || project.builtHere || project.kind === 'external') return null
  if (project.kind === 'platform') {
    return {
      label: 'Open Settings',
      where: 'Update Möbius in Settings → Updates. Your edits stay safe.',
      open: () => askHost({ type: 'moebius:open-settings' }),
    }
  }
  return {
    label: 'Open App Store',
    where: `Update ${project.name || 'this app'} in the App Store. Your edits stay safe.`,
    open: () => askHost({ type: 'moebius:open-app', appId: 'store' }),
  }
}
