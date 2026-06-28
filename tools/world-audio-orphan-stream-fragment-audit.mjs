#!/usr/bin/env node
'use strict';

// Compatibility wrapper: the original orphan-stream audit over-promoted
// disassembler .dw labels that start inside audio header records. The
// replacement audit records those labels as rejected header-field words.
import './world-audio-header-false-dw-audit.mjs';
