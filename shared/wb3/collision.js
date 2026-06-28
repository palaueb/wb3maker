// Pure collision helpers reconstructed from confirmed WORLD ASM routines.
// The caller supplies the decoded collision buffer from a local ROM/session.

export function collisionBufferIndex(coordinateA, coordinateB) {
  const rowByte = (coordinateB - 0x10) & 0xf0;
  return ((coordinateA & 0xffff) >>> 4) + rowByte * 6;
}

export function lookupCollisionTile(collisionBuffer, coordinateA, coordinateB) {
  const index = collisionBufferIndex(coordinateA, coordinateB);
  return collisionBuffer[index] ?? 0;
}
