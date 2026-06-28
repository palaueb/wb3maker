#!/usr/bin/env node
'use strict';

import process from 'node:process';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function rpc(baseUrl, method, params = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method,
      params,
    }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { rawText: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

async function main() {
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const initialize = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-probe', version: '1' },
  });
  const tools = await rpc(baseUrl, 'tools/list');
  const resources = await rpc(baseUrl, 'resources/list');
  console.log(JSON.stringify({
    ok: initialize.ok && tools.ok,
    baseUrl,
    initialize,
    toolNames: tools.json?.result?.tools?.map(tool => tool.name).sort() || [],
    resourceCount: resources.json?.result?.resources?.length || 0,
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
  }, null, 2));
  if (!initialize.ok || !tools.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    hint: 'Start Gearsystem first: node tools/world-gearsystem-launch.mjs --port 7777',
  }, null, 2));
  process.exitCode = 1;
});
