#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import {
  applyCoordinateBVelocityAccelClamp,
  applySignedByteAcceleration,
  coordinateADampingStep,
  dampCoordinateAMotion,
  dampCoordinateBMotion,
  integratePackedMotion,
  packedNibbleMotionDelta,
  s16,
  u16,
} from '../shared/wb3/player-physics.js';
import { collisionBufferIndex, lookupCollisionTile } from '../shared/wb3/collision.js';

assert.equal(s16(0xffff), -1);
assert.equal(u16(-0x300), 0xfd00);
assert.equal(applySignedByteAcceleration(0x0000, 0x10, { playerForm: 1, stateFlags: 0 }), 0x0010);
assert.equal(applySignedByteAcceleration(0x03f8, 0x20, { playerForm: 1, stateFlags: 0 }), 0x0400);
assert.equal(applySignedByteAcceleration(0xfd10, 0x80, { playerForm: 2, stateFlags: 0x60 }), 0xfd00);
assert.equal(coordinateADampingStep({ stateFlags: 0x60, playerForm: 3, innerState: 8 }), 0x50);
assert.equal(coordinateADampingStep({ stateFlags: 0, motionFlags: 0x10 }), 0x30);
assert.equal(dampCoordinateAMotion(0x0040, { stateFlags: 0, motionFlags: 0x10 }), 0x0010);
assert.equal(dampCoordinateAMotion(0xffd0, { stateFlags: 0, motionFlags: 0x10 }), 0x0000);
assert.equal(dampCoordinateBMotion(0x0040), 0x0000);
assert.equal(dampCoordinateBMotion(0xffd0), 0x0000);
assert.equal(packedNibbleMotionDelta(0x12), 0x0120);
assert.equal(packedNibbleMotionDelta(0xf2), 0xff20);
assert.equal(integratePackedMotion(0x0100, 0xf2), 0x0020);

const accel = applyCoordinateBVelocityAccelClamp({
  motionB: 0xff00,
  motionBFlags: 0x60,
  motionFlags: 0,
  playerForm: 0,
  innerState: 0,
});
assert.equal(accel.motionB, 0xff00);
assert.equal(accel.specialAccelerationEvent, true);

const gravityClamp = applyCoordinateBVelocityAccelClamp({
  motionB: 0x0780,
  motionBFlags: 0,
  motionFlags: 0,
  playerForm: 0,
  innerState: 0,
});
assert.equal(gravityClamp.motionB, 0x0800);

assert.equal(collisionBufferIndex(0x0030, 0x0020), 0x63);
const collisionBuffer = new Uint8Array(0x80);
collisionBuffer[0x63] = 0x0f;
assert.equal(lookupCollisionTile(collisionBuffer, 0x0030, 0x0020), 0x0f);

console.log('player physics helper smoke ok');
