#!/usr/bin/env node
/**
 * Verify the chrome maxHeight constraint fix for PR #109.
 *
 * Simulates the SetLogger column layout with the chrome constrained by maxHeight.
 * The constraint ensures buttonRow stays visible when the keyboard squeezes the
 * layout, by computing: maxHeight = containerHeight - buttonRowHeight - slotHeight - margins.
 *
 * Sweeps container heights 150-720pt and six exercise configurations (duration/reps×wt,
 * with/without hint, with/without AI key) to verify buttonRow is fully visible in all cases.
 */
import Yoga, { Edge, FlexDirection, Direction } from 'yoga-layout';

const Y = Yoga;
const S = { half: 2, one: 4, two: 8, three: 16, four: 24 };

// Leaf heights from real StyleSheets
const TXT_DEFAULT = 24;   // themed-text default lineHeight
const TXT_SMALL = 20;     // small/smallBold lineHeight
const TITLE_LH = 26;      // SetLogger.exerciseTitle lineHeight
const TEXTINPUT = 1 + S.two + 21 + S.two + 1; // border+pad+iOS text+pad+border = 43
const CLOCK_LH = 52;      // ExerciseStopwatch.clock lineHeight
const CONTROL = 48;       // ExerciseStopwatch CONTROL_SIZE
const STOPWATCH_H = S.two + TXT_SMALL + CLOCK_LH + CONTROL + S.two; // 136

function node(y, style = {}) {
  const n = Y.Node.create();
  if (style.height !== undefined) n.setHeight(style.height);
  if (style.flexGrow !== undefined) n.setFlexGrow(style.flexGrow);
  if (style.flexShrink !== undefined) n.setFlexShrink(style.flexShrink);
  if (style.flexBasis !== undefined) n.setFlexBasis(style.flexBasis);
  if (style.maxHeight !== undefined) n.setMaxHeight(style.maxHeight);
  if (style.minHeight !== undefined) n.setMinHeight(style.minHeight);
  if (style.marginTop !== undefined) n.setMargin(Edge.Top, style.marginTop);
  if (style.marginBottom !== undefined) n.setMargin(Edge.Bottom, style.marginBottom);
  if (style.row) n.setFlexDirection(FlexDirection.Row);
  return n;
}

/**
 * Build SetLogger column with chrome maxHeight constraint.
 * The chrome is constrained to: containerHeight - buttonRowHeight - slotHeight - 24pt gap/margin buffer.
 */
function build({ containerHeight, duration, hint, aiKey, chromeMaxHeight }) {
  const root = node(Y, { height: containerHeight });

  // ---- chrome View with maxHeight constraint ----
  const chrome = node(Y, {
    ...(chromeMaxHeight !== undefined ? { maxHeight: chromeMaxHeight } : {}),
  });
  let ci = 0;
  chrome.insertChild(node(Y, { height: TITLE_LH }), ci++);              // exerciseTitleRow
  chrome.insertChild(node(Y, { height: TXT_DEFAULT, marginTop: S.one }), ci++); // setPositionText

  if (!duration && hint) {
    chrome.insertChild(
      node(Y, { height: S.two + TXT_DEFAULT + S.two, marginTop: S.two, marginBottom: S.two }),
      ci++
    );
  }

  if (duration) {
    const g = node(Y, { marginTop: S.one, marginBottom: S.one });
    g.insertChild(node(Y, { height: STOPWATCH_H, marginTop: S.one, marginBottom: S.one }), 0);
    g.insertChild(node(Y, { height: TXT_DEFAULT }), 1);
    g.insertChild(node(Y, { height: TEXTINPUT, marginTop: S.one }), 2);
    chrome.insertChild(g, ci++);
  } else {
    const rowN = node(Y, { row: true });
    for (let k = 0; k < 2; k++) {
      const g = node(Y, { marginTop: S.one, marginBottom: S.one, flexGrow: 1, flexBasis: 0 });
      g.insertChild(node(Y, { height: TXT_DEFAULT }), 0);
      g.insertChild(node(Y, { height: TEXTINPUT, marginTop: S.one }), 1);
      rowN.insertChild(g, k);
    }
    chrome.insertChild(rowN, ci++);
  }
  root.insertChild(chrome, 0);

  // ---- loggedSets ScrollView: flex:1 ----
  const scroller = node(Y, {
    flexGrow: 1, flexShrink: 1, flexBasis: 0,
    marginTop: S.two, marginBottom: S.two,
  });
  root.insertChild(scroller, 1);

  // ---- buttonRow ----
  const buttonRow = node(Y, { row: true, marginTop: S.two, minHeight: 48 });
  for (let k = 0; k < 2; k++) {
    buttonRow.insertChild(node(Y, { flexGrow: 1, flexBasis: 0, height: S.two + TXT_DEFAULT + S.two }), k);
  }
  root.insertChild(buttonRow, 2);

  // ---- belowButtonsSlot (ReplaceExercise) ----
  let slot = null;
  if (aiKey) {
    slot = node(Y, {});
    const trigger = node(Y, { marginTop: S.two });
    trigger.insertChild(node(Y, { height: S.two + TXT_DEFAULT + S.two }), 0);
    slot.insertChild(trigger, 0);
    root.insertChild(slot, 3);
  }

  root.calculateLayout(390, containerHeight, Direction.LTR);
  const abs = (n) => {
    let top = 0, cur = n;
    while (cur) { top += cur.getComputedTop(); cur = cur.getParent(); }
    return top;
  };
  const out = {
    chromeH: chrome.getComputedHeight(),
    scrollerH: scroller.getComputedHeight(),
    buttonRowH: buttonRow.getComputedHeight(),
    buttonRowTop: abs(buttonRow),
    buttonRowBottom: abs(buttonRow) + buttonRow.getComputedHeight(),
    slotBottom: slot ? abs(slot) + slot.getComputedHeight() : null,
  };
  root.freeRecursive();
  return out;
}

/**
 * Compute the chrome maxHeight constraint value for a given configuration.
 * Formula: containerHeight - buttonRowHeight - slotHeight - 24pt gap/margin buffer
 */
function computeChromeMaxHeight(cfg) {
  // First pass: no constraint to measure buttonRow and slot
  const initial = build({ ...cfg, chromeMaxHeight: undefined });
  const slotHeight = initial.slotBottom === null ? 0 : (initial.slotBottom - (initial.buttonRowTop - initial.buttonRowH));
  // Constraint: leave room for buttonRow, slot, and 24pt buffer
  const maxHeight = Math.max(100, cfg.containerHeight - initial.buttonRowH - slotHeight - 24);
  return maxHeight;
}

const configs = [
  { name: 'duration + AI key',      duration: true,  hint: false, aiKey: true },
  { name: 'duration, no AI key',    duration: true,  hint: false, aiKey: false },
  { name: 'reps/wt+hint + AI key',  duration: false, hint: true,  aiKey: true },
  { name: 'reps/wt+hint, no key',   duration: false, hint: true,  aiKey: false },
  { name: 'reps/wt no hint + key',  duration: false, hint: false, aiKey: true },
  { name: 'reps/wt no hint, nokey', duration: false, hint: false, aiKey: false },
];

const heights = [];
for (let h = 150; h <= 720; h += 10) heights.push(h);

console.log('cfg | containerH | buttonRowBottom | slotBottom | brFullyVisible | slotVisible');
const summary = {};
for (const cfg of configs) {
  const bad = [];
  const badSlot = [];
  let firstOk = null;

  for (const h of heights) {
    const chromeMaxHeight = computeChromeMaxHeight({ ...cfg, containerHeight: h });
    const result = build({ ...cfg, containerHeight: h, chromeMaxHeight });
    const brOk = result.buttonRowBottom <= h + 0.01;
    const slotOk = result.slotBottom === null || result.slotBottom <= h + 0.01;

    if (!brOk) bad.push(h); else if (firstOk === null) firstOk = h;
    if (!slotOk) badSlot.push(h);

    if ([200, 300, 380, 420, 500, 600, 700].includes(h)) {
      console.log(
        `${cfg.name} | ${h} | ${result.buttonRowBottom.toFixed(1)} | ${result.slotBottom?.toFixed(1) || 'N/A'} | ${brOk} | ${slotOk}`
      );
    }
  }
  summary[cfg.name] = { bad, badSlot, firstOk };
}

console.log('\n=== SUMMARY ===');
let allGood = true;
for (const [k, v] of Object.entries(summary)) {
  const brStatus = v.bad.length === 0 ? '✓ PASS (all heights)' : `✗ FAIL (${v.bad.length}/${heights.length})`;
  const slotStatus = v.badSlot.length === 0 ? '✓ PASS (all heights)' : `✗ FAIL (${v.badSlot.length}/${heights.length})`;
  console.log(`\n${k}`);
  console.log(`  buttonRow: ${brStatus}`);
  console.log(`  slot:      ${slotStatus}`);
  if (v.bad.length > 0 || v.badSlot.length > 0) allGood = false;
}

console.log(`\n${allGood ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
process.exit(allGood ? 0 : 1);
