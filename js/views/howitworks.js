// "How this works" -- the four-minute read, including what this app refuses to do.
//
// This card exists for a specific failure: several of this app's strongest
// opinions read as missing features. Someone looks for "add 2.5 kg next time",
// does not find it, and concludes the app is unfinished rather than that the
// omission is deliberate. A perceived bug costs trust; a stated choice does
// not, even when the reader disagrees with it.
//
// So the last section is the important one, and it is the reason this is not
// simply a list of features. Everything above it can be learned by using the
// app; nothing above it explains an absence.
//
// Scannable, skippable forever, and every concept carries a way to go and look
// at the real thing instead of reading about it. Jargon is tappable (see
// js/glossary.js) rather than explained inline, so the prose stays short.
import { state } from '../store.js';
import { openModal, closeModal } from '../ui.js';
import { termHtml, termBodyHtml, termTitle } from '../glossary.js';

const t = (key, label) => termHtml(key, label, { back: 'how' });

/** A section: a heading, a short body, and a way to go and see it. */
const part = (title, body, show = null) => `
  <div class="card">
    <div class="strong">${title}</div>
    <p class="hint" style="margin:4px 0 0">${body}</p>
    ${show ? `<button type="button" class="btn sm ghost" style="margin-top:8px"
      data-action="how-show" data-to="${show[0]}">${show[1]}</button>` : ''}
  </div>`;

function bodyHtml() {
  return `
    <p class="hint" style="margin-top:0">Four minutes, once. Tap any
      <span class="term-eg">underlined word</span> for what it means here.</p>

    ${part('A routine is the plan. A session is what happened.',
    `A ${t('routine')} lists exercises and targets; starting it copies them into a
     ${t('session')}. Anything you change mid-workout stays in that workout — the routine is only
     updated if you ask for it, with <b>Save session back to routine</b>. That is why editing
     today's weights is safe.`, ['now', 'Show me Now'])}

    ${part('Logging is confirming, not typing.',
    `Numbers are already in each row — that is the ${t('prefill')}, taken from the last time you did
     the exercise. You tap ✓ to say "yes, that happened". The consequence is on the button before
     you press it, and a row you never confirm records <b>nothing</b>, however complete it looks.`,
    ['now', 'Show me Now'])}

    ${part('The clock is never in your way.',
    `Rest starts when you log a set and runs across screens, tabs and app restarts. It is never
     gated behind filling a field in, because rest is time-critical and a weight is not. A hold is
     timed on the same clock: see ${t('isometric')}.`)}

    ${part('Sets come in more shapes than one.',
    `A ${t('warmup')} is logged but excluded from volume and bests. A ${t('dropset')} is one set with
     several stages and no rest between. A ${t('superset')} groups neighbouring exercises onto one
     screen. ${t('unilateral', 'Unilateral')} work splits each set into L and R. Which of these an
     exercise is comes from the ${t('measure')} and flags on it in the library.`,
    ['library', 'Show me the library'])}

    ${part('The numbers in Trends are deliberately not blended.',
    `${t('direct', 'Direct sets')} and indirect sets are counted and shown separately. Because an
     exercise can target several muscles, the per-muscle totals add up to more than your total set
     count — that is correct, not a bug. ${t('e1rm', 'e1RM')} is a calculation from a set you did,
     never something you lifted.`, ['trends', 'Show me Trends'])}

    <div class="card attn">
      <div class="tiny">What this app will not do</div>
      <p class="hint" style="margin:4px 0 8px">These are choices, not gaps. You may disagree with
        them, but nothing here is half-finished.</p>
      <ul class="attn-list">
        <li><b>It will never raise your weights for you.</b> No automatic progression, no "add 2.5 kg
          next time". Prefilled numbers come from what you actually did, and a plan that advances
          while you are ill or deloading is a plan that lies to you.</li>
        <li><b>It will not add direct and indirect sets together.</b> One hard set for a muscle is
          not one set where it assisted, and a single blended number would hide which you did.</li>
        <li><b>It will not estimate what you did not log.</b> A set you never confirmed is absent,
          not inferred. Gaps in the history stay visible.</li>
        <li><b>There is no account, and no server.</b> Your log is in this browser's storage on this
          device until you export it or set up sync. That is also why there is nothing to sign in
          to and nothing collected about you.</li>
        <li><b>Some things the platform refuses.</b> Installed from Safari this cannot use background
          GPS, cannot talk to a watch, and cannot beep while another app is in front — a web app on
          iOS is not allowed to. The rest timer survives being backgrounded; its sound does not.</li>
      </ul>
    </div>

    ${part('Your data, and getting it out.',
    `Everything is on this device. <b>Export</b> writes a JSON backup or a CSV of every set;
     <b>Sync</b> copies the lot to a secret GitHub Gist, which is also how a second device gets it.
     Both live under Routines, and neither needs an account with us, because there is no us.`,
    ['routines', 'Show me export and sync'])}`;
}

export const howActions = {
  'how-open': () => {
    openModal({ title: 'How this works', bodyHtml: bodyHtml(), cancelText: 'Done', wide: true });
  },

  'how-show': ({ to }) => {
    closeModal();
    state.nav = {};
    state.tab = to;
  },

  // Jargon, defined where it is read.
  //
  // A modal replaces whatever modal was already open, so a term tapped from
  // inside the How-this-works sheet would otherwise dead-end there. `data-back`
  // carries the way back explicitly rather than ui.js growing a modal stack for
  // one caller -- a stack of sheets on a phone is its own problem.
  'term-open': ({ term, back }) => {
    openModal({
      title: termTitle(term),
      bodyHtml: termBodyHtml(term)
        + (back ? `<button type="button" class="btn sm ghost block" style="margin-top:12px"
            data-action="how-open">← Back to How this works</button>` : ''),
      cancelText: 'Got it',
    });
  },
};
