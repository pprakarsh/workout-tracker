// What a backend needs to know about this app's data -- and nothing else.
//
// Pure: no state, no IndexedDB, no network. The impure half is
// js/tombstones.js. That is the same split this codebase uses everywhere else:
// plan.js is what a planned day MEANS and planstore.js persists it; model.js is
// shape and store.js writes it.
//
// There is no backend yet. This exists now because both things in here become a
// DATA MIGRATION if they are discovered later, and one of them is already
// broken in shipped data:
//
//   docId()     The exercise library is keyed on normName(name) -- a NATURAL
//               key, which is what makes tagging retroactive. But normName
//               only trims, lowercases and collapses whitespace, so the key
//               keeps every punctuation character the user typed. The shipped
//               catalogue contains "90/90 Hip Stretch", whose key is
//               "90/90 hip stretch", and a '/' cannot appear in a document id
//               on any path-addressed store -- it IS the path separator. So
//               `users/u1/exercises/90/90 hip stretch` is not a document, it is
//               a malformed path. One in 751 today; users can type anything.
//
//   META_SCOPE  The `meta` store holds three incompatible kinds of thing: data
//               that belongs to the USER and should follow them to a new phone,
//               and data that belongs to THIS DEVICE and must never leave it.
//               Nothing in the code said which was which, so the first sync
//               implementation would have had to guess -- and pushing `timer`
//               would land a running rest clock on the other device.
//
// Note that this is NOT the backup format. A backup is a document, and it
// deliberately carries device state (the live session, the running clock) so a
// restore is byte-for-byte. Sync is a different question with a different
// answer, which is exactly why the two scopes are written down separately.

/* ------------------------------------------------------------------ */
/* document ids                                                       */
/* ------------------------------------------------------------------ */

/**
 * Characters that cannot survive as-is in a document id.
 *
 * `/` is the path separator. `%` is this encoder's own escape, so it has to be
 * escaped first or decoding is ambiguous. `.` is encoded unconditionally rather
 * than only when the whole id is "." or "..", because a conditional encode is
 * where the bugs live. The rest are hostile on one path-addressed store or
 * another (`#$[]` in Realtime Database paths, `*` in some query syntaxes), and
 * encoding them costs nothing.
 */
const RESERVED = /[%/.*#$[\]]/g;

/** A document id has a length cap; 1500 bytes is the smallest common one. */
export const MAX_DOC_ID = 1500;

const hex = (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * A local key, encoded so it is safe as a backend document id.
 *
 * Reversible by design: `localKey(docId(k)) === k` for every k. The alternative
 * -- hashing, or a surrogate id stored in a field -- would mean a document
 * could not be read back without a second lookup, and would make the backend's
 * contents unreadable by a human debugging a sync bug.
 *
 * Throws rather than truncating on an over-long key. Truncation is lossy, and
 * two different exercises silently sharing one document is worse than an error
 * on a 1500-character exercise name.
 */
export function docId(key) {
  const s = String(key ?? '');
  if (!s) throw new Error('docId: empty key');
  let out = s.replace(RESERVED, hex);
  // `__anything__` is reserved on Firestore. Escaping the FIRST character is
  // enough to break the pattern, needs no special case when decoding, and
  // leaves ordinary ids like "r_ltx9f2" untouched -- escaping every underscore
  // would mangle every id this app generates.
  if (/^__/.test(out)) out = hex(out[0]) + out.slice(1);
  if (out.length > MAX_DOC_ID) {
    throw new Error(`docId: key encodes to ${out.length} chars, over the ${MAX_DOC_ID} limit`);
  }
  return out;
}

/** The inverse of docId(). */
export function localKey(id) {
  return String(id ?? '').replace(/%([0-9A-Fa-f]{2})/g,
    (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Whether a string is usable as a document id as-is, without encoding. */
export const isValidDocId = (id) => typeof id === 'string'
  && id.length > 0
  && id.length <= MAX_DOC_ID
  && !id.includes('/')
  && id !== '.' && id !== '..'
  && !/^__.*__$/.test(id);

/* ------------------------------------------------------------------ */
/* what travels, and what does not                                    */
/* ------------------------------------------------------------------ */

/**
 * Every key in the `meta` store, and who it belongs to.
 *
 *   'user'    follows the person to a new device
 *   'device'  describes this installation and must never be pushed
 *
 * A test asserts this covers every key the codebase actually writes, so adding
 * a meta key forces a decision about its scope instead of defaulting to one.
 */
export const META_SCOPE = {
  // the person's own configuration -- units, rest default, which effort scale
  settings: 'user',
  // kept only so a device upgrading from DB v2 can migrate its plan blob into
  // the `plan` store. Nothing writes it any more.
  plan: 'user',

  // the live session pointer and the running clock: both describe what THIS
  // phone is doing right now. Pushing either would start a rest timer on a
  // device sitting in a drawer.
  activeSessionId: 'device',
  timer: 'device',
  // one level of merge undo. The merge itself travels, because it rewrote names
  // across records; the undo buffer is a local affordance.
  lastMerge: 'device',
  // which earned nudges this device has been shown. A new device genuinely has
  // not seen them.
  dismissed: 'device',
  // the sync credential itself. Never, under any circumstances.
  sync: 'device',
};

/** Meta keys that may be pushed to a backend. */
export const userMetaKeys = () => Object.keys(META_SCOPE).filter((k) => META_SCOPE[k] === 'user');

/** True only for a meta key explicitly classified as the user's. */
export const metaSyncs = (key) => META_SCOPE[key] === 'user';

/**
 * Object stores holding one user-owned record per document.
 *
 * These are the stores a per-record sync walks, and the stores that get
 * tombstones. `meta` is absent because it is key-value configuration, not
 * records.
 */
export const RECORD_STORES = ['routines', 'sessions', 'exercises', 'plan'];

/** The keyPath each record store uses, which is also what docId() receives. */
export const KEY_PATH = {
  routines: 'id', sessions: 'id', exercises: 'key', plan: 'key',
};
