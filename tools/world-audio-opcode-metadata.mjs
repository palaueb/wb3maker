#!/usr/bin/env node
'use strict';

// Metadata-only description of the bank-3 music stream control opcodes.
// The $F0-$FF handler targets are confirmed by _LABEL_C37B_ and the
// dispatch table at ROM 0x0C391. argBytes is derived from handler reads
// after _LABEL_C37B_ has already advanced BC past the opcode byte.

export const AUDIO_OPCODE_METADATA = [
  {
    opcode: 0xF0,
    argBytes: 1,
    handlerRomOffset: 0x0C3B1,
    role: 'instrument_or_effect_select',
    parserAction: 'continue',
    confidence: 'high',
    evidence: 'Handler 0x0C3B1 reads one byte from BC, stores it into stream/hardware selector fields, then increments BC once.',
  },
  {
    opcode: 0xF1,
    argBytes: 2,
    handlerRomOffset: 0x0C3C9,
    role: 'stream_parameter_pair_store',
    parserAction: 'continue',
    confidence: 'high',
    evidence: 'Handler 0x0C3C9 performs two read+increment cycles from BC before returning to the stream interpreter.',
  },
  {
    opcode: 0xF2,
    argBytes: 2,
    handlerRomOffset: 0x0C3DB,
    role: 'stream_parameter_pair_add',
    parserAction: 'continue',
    confidence: 'high',
    evidence: 'Handler 0x0C3DB performs two read+increment cycles from BC and combines both bytes with existing stream fields.',
  },
  {
    opcode: 0xF3,
    argBytes: 1,
    handlerRomOffset: 0x0C3EF,
    role: 'stream_parameter_store',
    parserAction: 'continue',
    confidence: 'high',
    evidence: 'Handler 0x0C3EF reads one byte from BC, stores it, increments BC once, and jumps back to the interpreter tail.',
  },
  {
    opcode: 0xF4,
    argBytes: 1,
    handlerRomOffset: 0x0C3FD,
    role: 'stream_parameter_add_or_clamp',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Handler 0x0C3FD reads one byte from BC, combines it with a stream field, stores a bounded value, then increments BC once.',
  },
  {
    opcode: 0xF5,
    argBytes: 1,
    handlerRomOffset: 0x0C412,
    role: 'indexed_support_table_load',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Handler 0x0C412 reads one byte from BC, increments BC once, then indexes a bank-3 support table before returning.',
  },
  {
    opcode: 0xF6,
    argBytes: 2,
    handlerRomOffset: 0x0C427,
    role: 'call_stream_pointer',
    parserAction: 'enqueue_target_and_continue',
    pointerArg: true,
    confidence: 'high',
    evidence: 'Handler 0x0C427 stores the current BC, skips two bytes, then reloads BC from the two-byte pointer argument.',
  },
  {
    opcode: 0xF7,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'shared_repeat_or_end_handler',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Opcode $F7 dispatches to the shared 0x0C441 handler, which does not consume immediate argument bytes.',
  },
  {
    opcode: 0xF8,
    argBytes: 1,
    handlerRomOffset: 0x0C48D,
    role: 'repeat_counter_setup',
    parserAction: 'continue',
    confidence: 'high',
    evidence: 'Handler 0x0C48D reads one byte from BC, increments BC once, and stores stream repeat state.',
  },
  {
    opcode: 0xF9,
    argBytes: 0,
    handlerRomOffset: 0x0C49F,
    role: 'repeat_or_loop_end',
    parserAction: 'stop_segment',
    confidence: 'medium',
    evidence: 'Handler 0x0C49F is a repeat/loop tail and consumes no immediate bytes; static parsing stops this segment to avoid unbounded loops.',
  },
  {
    opcode: 0xFA,
    argBytes: 2,
    handlerRomOffset: 0x0C4B8,
    role: 'jump_stream_pointer',
    parserAction: 'branch_and_stop_segment',
    pointerArg: true,
    confidence: 'high',
    evidence: 'Handler 0x0C4B8 reads two bytes from BC into the new BC stream pointer.',
  },
  {
    opcode: 0xFB,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'shared_repeat_or_end_handler',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Opcode $FB dispatches to the shared 0x0C441 handler, which does not consume immediate argument bytes.',
  },
  {
    opcode: 0xFC,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'shared_repeat_or_end_handler',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Opcode $FC dispatches to the shared 0x0C441 handler, which does not consume immediate argument bytes.',
  },
  {
    opcode: 0xFD,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'shared_repeat_or_end_handler',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Opcode $FD dispatches to the shared 0x0C441 handler; unlike earlier best-effort parsing, no two-byte immediate pointer is consumed.',
  },
  {
    opcode: 0xFE,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'shared_repeat_or_end_handler',
    parserAction: 'continue',
    confidence: 'medium',
    evidence: 'Opcode $FE dispatches to the shared 0x0C441 handler, which does not consume immediate argument bytes.',
  },
  {
    opcode: 0xFF,
    argBytes: 0,
    handlerRomOffset: 0x0C441,
    role: 'stream_end_or_shared_repeat_handler',
    parserAction: 'stop_segment',
    confidence: 'medium',
    evidence: 'Opcode $FF dispatches to the shared 0x0C441 handler; the static parser treats it as a segment terminator to avoid crossing into adjacent streams.',
  },
];

export const AUDIO_OPCODE_METADATA_BY_OPCODE = new Map(
  AUDIO_OPCODE_METADATA.map(item => [item.opcode, item])
);

export const AUDIO_OPCODE_ARG_BYTES = new Map(
  AUDIO_OPCODE_METADATA.map(item => [item.opcode, item.argBytes])
);

export function audioOpcodeKey(opcode) {
  return '$' + opcode.toString(16).toUpperCase().padStart(2, '0');
}

export function audioOpcodeMetadataObject() {
  return Object.fromEntries(AUDIO_OPCODE_METADATA.map(item => [
    audioOpcodeKey(item.opcode),
    {
      argBytes: item.argBytes,
      handlerRomOffset: '0x' + item.handlerRomOffset.toString(16).toUpperCase().padStart(5, '0'),
      role: item.role,
      parserAction: item.parserAction,
      confidence: item.confidence,
    },
  ]));
}
