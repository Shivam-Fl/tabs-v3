// One open issue per kind of repository-wide trouble, commented on each time it comes back.
//
// Some stops are not one issue's: the day's agent-session ceiling (lib/ceiling.js) and a model
// credential or provider that no longer answers (canary.mjs). Said on every issue they touch, they
// are a dozen comments a person learns to skip; said nowhere, they are the silence this framework
// keeps finding. Said here, once, they are one notification on one issue, as the self-fix digest is.
//
// Labelled sdlc:alert, which nothing starts (lib/deps.js PARKED). Never filed without it: an
// unlabelled issue is one the wake pass would plan as work.
import { gh, ghJson, isPipelineAuthor } from './actions.js';

/** @param {{key: string, title: string, body: string}} alert  `key` tells one kind from another */
export async function raiseAlert(repo, { key, title, body }) {
  const marker = `<!-- sdlc-alert:${key} -->`;
  const open = (await ghJson(['api', `repos/${repo}/issues?state=open&labels=sdlc:alert&per_page=100`]))
    .find((i) => !i.pull_request && isPipelineAuthor(i.user?.login) && String(i.body ?? '').includes(marker));
  if (open) {
    await gh(['issue', 'comment', String(open.number), '--body', body]);
    return open.number;
  }
  // An install from before the label existed lacks it, and `issue create --label` fails on that.
  await gh(['label', 'create', 'sdlc:alert', '--color', 'b60205', '--force',
    '--description', 'The pipeline\'s own alarm — a ceiling reached, a credential failing. Nothing starts it']).catch(() => {});
  const url = await gh(['issue', 'create', '--title', title, '--label', 'sdlc:alert', '--body', `${marker}\n${body}`]);
  return Number(String(url).trim().split('/').pop()) || null;
}
