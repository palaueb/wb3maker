// Pure player-motion helpers reconstructed from confirmed WORLD ASM routines.
// These functions operate on caller-provided state values only; they do not
// contain or load ROM bytes.

export function u8(value) {
  return value & 0xff;
}

export function u16(value) {
  return value & 0xffff;
}

export function s8(value) {
  const byte = u8(value);
  return byte & 0x80 ? byte - 0x100 : byte;
}

export function s16(value) {
  const word = u16(value);
  return word & 0x8000 ? word - 0x10000 : word;
}

export function word(lo, hi) {
  return u16((u8(hi) << 8) | u8(lo));
}

export function loByte(value) {
  return u8(value);
}

export function hiByte(value) {
  return u8(value >>> 8);
}

function clampSignedMagnitude(value, limit) {
  const signed = s16(value);
  if (signed >= limit) return u16(limit);
  if (signed <= -limit) return u16(-limit);
  return u16(signed);
}

export function motionAccelClampLimit({ playerForm, stateFlags }) {
  if (playerForm === 0x03 || playerForm === 0x01) return 0x0400;
  return (stateFlags & 0x60) ? 0x0300 : 0x0400;
}

export function applySignedByteAcceleration(wordValue, accelByte, context = {}) {
  const limit = motionAccelClampLimit(context);
  const delta = limit === 0x0300 ? s8(accelByte) >> 1 : s8(accelByte);
  return clampSignedMagnitude(s16(wordValue) + delta, limit);
}

export function applyCoordinateBMotionAccel(state) {
  return {
    ...state,
    motionB: applySignedByteAcceleration(state.motionB, state.accelB, state),
  };
}

export function applyCoordinateAMotionAccel(state) {
  return {
    ...state,
    motionA: applySignedByteAcceleration(state.motionA, state.accelA, state),
  };
}

export function dampSignedWordTowardZero(wordValue, step) {
  const signed = s16(wordValue);
  if (signed === 0) return 0;
  if (signed > 0) return u16(Math.max(0, signed - step));
  return u16(Math.min(0, signed + step));
}

export function coordinateADampingStep({ stateFlags = 0, playerForm = 0, innerState = 0, motionFlags = 0 } = {}) {
  if (stateFlags & 0x60) {
    if (playerForm === 0x03 && (innerState & 0x0f) === 0x08) return 0x50;
    return 0x80;
  }
  return (motionFlags & 0x10) ? 0x30 : 0x70;
}

export function dampCoordinateAMotion(wordValue, context = {}) {
  return dampSignedWordTowardZero(wordValue, coordinateADampingStep(context));
}

export function dampCoordinateBMotion(wordValue) {
  return dampSignedWordTowardZero(wordValue, 0x60);
}

export function packedNibbleMotionDelta(packedByte) {
  const byte = u8(packedByte);
  const swapped = ((byte & 0x0f) << 4) | (byte >>> 4);
  const highNibble = swapped & 0x0f;
  const deltaHigh = highNibble & 0x08 ? highNibble | 0xf0 : highNibble;
  const deltaLow = swapped & 0xf0;
  return word(deltaLow, deltaHigh);
}

export function integratePackedMotion(wordValue, packedByte) {
  return u16(wordValue + packedNibbleMotionDelta(packedByte));
}

export function applyPackedCoordinateBIntegrator(state) {
  return {
    ...state,
    motionB: integratePackedMotion(state.motionB, state.packedAccelB),
  };
}

export function applyPackedCoordinateAIntegrator(state) {
  return {
    ...state,
    motionA: integratePackedMotion(state.motionA, state.packedAccelA),
  };
}

export function coordinateBGravityStep({ motionFlags = 0, playerForm = 0, innerState = 0 } = {}) {
  if (motionFlags & 0x60) return { delta: 0x0040, positiveClampHighByte: 0x03 };
  if (playerForm === 0x05 && (innerState & 0x0f) === 0x08) return { delta: 0x0020, positiveClampHighByte: 0x03 };
  return { delta: 0x0100, positiveClampHighByte: 0x08 };
}

export function applyCoordinateBVelocityAccelClamp(state) {
  let motionB = u16(state.motionB);
  let specialAccelerationEvent = false;

  if (
    s16(motionB) < 0
    && (state.motionBFlags & 0x60)
    && !(state.motionFlags & 0x60)
  ) {
    motionB = u16(motionB << 1);
    if (hiByte(motionB) < 0xf4) motionB = 0xf400;
    specialAccelerationEvent = true;
  }

  const step = coordinateBGravityStep({
    motionFlags: state.motionFlags,
    playerForm: state.playerForm,
    innerState: state.innerState,
  });
  motionB = u16(motionB + step.delta);
  if (s16(motionB) >= 0 && hiByte(motionB) >= step.positiveClampHighByte) {
    motionB = word(0x00, step.positiveClampHighByte);
  }

  return {
    ...state,
    motionB,
    specialAccelerationEvent,
  };
}
