export const defaultReleaseNpmTimeoutMs = 120_000;
export const defaultTagReconcileDelayMs = 1_000;

const defaultStableObservations = 3;
const defaultMaximumObservations = 8;

export function releaseNpmTimeout(environment = process.env) {
  return positiveSafeInteger(
    environment.WEBSCORE_RELEASE_NPM_TIMEOUT_MS,
    'WEBSCORE_RELEASE_NPM_TIMEOUT_MS',
    defaultReleaseNpmTimeoutMs,
  );
}

export function tagReconcileDelay(environment = process.env) {
  return positiveSafeInteger(
    environment.WEBSCORE_RELEASE_TAG_RECONCILE_DELAY_MS,
    'WEBSCORE_RELEASE_TAG_RECONCILE_DELAY_MS',
    defaultTagReconcileDelayMs,
  );
}

/**
 * Reconcile one mutation intent back to its preflight value.
 *
 * A failed npm process is ambiguous: the registry can commit the write before
 * the client observes an error, while subsequent reads can remain stale. Every
 * safe intent therefore receives a compensating write even when the first read
 * already reports the predecessor. If the target resurfaces during the bounded
 * stability window, compensation is repeated. An observed third value is never
 * replaced; npm has no compare-and-swap primitive, so this remains a bounded
 * reconciliation protocol rather than an atomic registry transaction.
 */
export async function reconcileDistTag({
  name,
  tag,
  target,
  previous,
  read,
  compensate,
  wait = delay,
  reconcileDelayMs,
  stableObservations = defaultStableObservations,
  maximumObservations = defaultMaximumObservations,
}) {
  return settleDistTag({
    name,
    tag,
    desired: previous,
    alternate: target,
    read,
    writeDesired: compensate,
    wait,
    reconcileDelayMs,
    stableObservations,
    maximumObservations,
    operation: 'reconciliation',
  });
}

/**
 * Establish durable marker evidence despite an ambiguous npm write result.
 * The marker's expected predecessor is normally an unset value.
 */
export async function establishDistTag({
  name,
  tag,
  target,
  previous,
  read,
  establish,
  wait = delay,
  reconcileDelayMs,
  stableObservations = defaultStableObservations,
  maximumObservations = defaultMaximumObservations,
}) {
  return settleDistTag({
    name,
    tag,
    desired: target,
    alternate: previous,
    read,
    writeDesired: establish,
    wait,
    reconcileDelayMs,
    stableObservations,
    maximumObservations,
    operation: 'establishment',
  });
}

async function settleDistTag({
  name,
  tag,
  desired,
  alternate,
  read,
  writeDesired,
  wait,
  reconcileDelayMs,
  stableObservations,
  maximumObservations,
  operation,
}) {
  if (desired === alternate) {
    throw new Error(`${name}'s ${tag} ${operation} requires two distinct allowed values.`);
  }
  if (!Number.isSafeInteger(reconcileDelayMs) || reconcileDelayMs < 1) {
    throw new Error('Release tag reconciliation delay must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(stableObservations) ||
    stableObservations < 2 ||
    !Number.isSafeInteger(maximumObservations) ||
    maximumObservations < stableObservations
  ) {
    throw new Error('Release tag reconciliation observation bounds are invalid.');
  }

  const initial = await read();
  assertAllowedValue(name, tag, desired, alternate, initial, operation);
  const commandFailures = [];
  await attemptWrite(writeDesired, commandFailures);

  let consecutiveDesired = 0;
  for (let observation = 0; observation < maximumObservations; observation += 1) {
    if (observation > 0) await wait(reconcileDelayMs);
    const current = await read();
    assertAllowedValue(name, tag, desired, alternate, current, operation);
    if (current === desired) {
      consecutiveDesired += 1;
      if (consecutiveDesired >= stableObservations) return {commandFailures};
      continue;
    }

    consecutiveDesired = 0;
    await attemptWrite(writeDesired, commandFailures);
  }

  const failures = commandFailures.length > 0 ? commandFailures : [
    new Error(`${name}'s ${tag} did not remain on ${formatTagValue(desired)}.`),
  ];
  throw new AggregateError(
    failures,
    `${name}'s ${tag} could not settle on ${formatTagValue(desired)} ` +
      'within the bounded stability window.',
  );
}

async function attemptWrite(writeDesired, failures) {
  try {
    await writeDesired();
  } catch (error) {
    failures.push(error);
  }
}

function assertAllowedValue(name, tag, desired, alternate, current, operation) {
  if (current === desired || current === alternate) return;
  throw new Error(
    `${name}'s ${tag} changed to an unexpected value during ${operation} ` +
      `(${formatTagValue(current)}); it will not be overwritten.`,
  );
}

function formatTagValue(value) {
  return value ?? 'an unset value';
}

function positiveSafeInteger(raw, name, fallback) {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return Number(raw);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
