#!/usr/bin/env node
'use strict';

const cdpJsonUrl = process.env.CDP_JSON_URL || 'http://127.0.0.1:9224/json';
const analyzerPath = '/tools/rom-analyzer.html';

function assertEqual(actual, expected, label, failures) {
  if (String(actual) !== String(expected)) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function assertTruthy(value, label, failures) {
  if (!value) failures.push(`${label}: expected truthy value`);
}

async function cdpClient(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return {
    send(method, params = {}) {
      return new Promise(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const pages = await (await fetch(cdpJsonUrl)).json();
  const page = pages.find(item => item.url.includes(analyzerPath)) || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error(`No debuggable page found at ${cdpJsonUrl}`);

  const client = await cdpClient(page);
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await new Promise(resolve => setTimeout(resolve, 500));

    const expression = `
      (async () => {
        const data = await fetch('/projects/WORLD/map.json').then(r => r.json());
        mapData = data;
        const result = dynamicGraphicsRuntimeFixtureRenderPreview();
        const out = document.getElementById('dynamic-graphics-runtime-fixture-preview');
        const info = document.getElementById('dynamic-graphics-runtime-fixture-info');
        const d = out.dataset;
        return {
          info: info.textContent,
          catalogBacked: d.dynamicGraphicsRuntimeFixtureCatalogBacked,
          previewOk: d.dynamicGraphicsRuntimeFixturePreviewOk,
          tracePlanCount: d.dynamicGraphicsRuntimeFixtureTracePlanCount,
          runtimeHookCount: d.dynamicGraphicsRuntimeFixtureRuntimeHookCount,
          promotionGateCount: d.dynamicGraphicsRuntimeFixturePromotionGateCount,
          planHookEdgeCount: d.dynamicGraphicsRuntimeFixturePlanHookEdgeCount,
          planGateEdgeCount: d.dynamicGraphicsRuntimeFixturePlanGateEdgeCount,
          uniqueCaptureFieldCount: d.dynamicGraphicsRuntimeFixtureUniqueCaptureFieldCount,
          ramSeedCount: d.dynamicGraphicsRuntimeFixtureRamSeedCount,
          addressableRuntimeHookCount: d.dynamicGraphicsRuntimeFixtureAddressableRuntimeHookCount,
          unresolvedRuntimeHookCount: d.dynamicGraphicsRuntimeFixtureUnresolvedRuntimeHookCount,
          validationIssueCount: d.dynamicGraphicsRuntimeFixtureValidationIssueCount,
          readyForRuntimeHarness: d.dynamicGraphicsRuntimeFixtureReadyForRuntimeHarness,
          persistedRomByteCount: d.dynamicGraphicsRuntimeFixturePersistedRomByteCount,
          persistedPixelCount: d.dynamicGraphicsRuntimeFixturePersistedPixelCount,
          persistedHashCount: d.dynamicGraphicsRuntimeFixturePersistedHashCount,
          persistedAudioByteCount: d.dynamicGraphicsRuntimeFixturePersistedAudioByteCount,
          persistedInstructionByteCount: d.dynamicGraphicsRuntimeFixturePersistedInstructionByteCount,
          persistedRegisterTraceCount: d.dynamicGraphicsRuntimeFixturePersistedRegisterTraceCount,
          persistedRuntimeValueCount: d.dynamicGraphicsRuntimeFixturePersistedRuntimeValueCount,
          tableCount: out.querySelectorAll('table').length,
          hookRows: out.querySelectorAll('tbody tr').length,
          textHasA48: out.textContent.includes('a48'),
          textHas9c3: out.textContent.includes('0x009C3'),
          textHasHarnessStatus: out.textContent.includes('metadata_ready_runtime_values_missing'),
          returnReady: result.readyForRuntimeHarness,
          returnIssues: result.validationIssueCount
        };
      })()
    `;
    const evalResult = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evalResult.result?.exceptionDetails) {
      throw new Error(evalResult.result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    const value = evalResult.result?.result?.value;
    const failures = [];
    assertEqual(value.catalogBacked, '1', 'catalogBacked', failures);
    assertEqual(value.previewOk, '1', 'previewOk', failures);
    assertEqual(value.tracePlanCount, '31', 'tracePlanCount', failures);
    assertEqual(value.runtimeHookCount, '18', 'runtimeHookCount', failures);
    assertEqual(value.promotionGateCount, '2', 'promotionGateCount', failures);
    assertEqual(value.planHookEdgeCount, '288', 'planHookEdgeCount', failures);
    assertEqual(value.planGateEdgeCount, '31', 'planGateEdgeCount', failures);
    assertEqual(value.uniqueCaptureFieldCount, '69', 'uniqueCaptureFieldCount', failures);
    assertEqual(value.ramSeedCount, '15', 'ramSeedCount', failures);
    assertEqual(value.addressableRuntimeHookCount, '18', 'addressableRuntimeHookCount', failures);
    assertEqual(value.unresolvedRuntimeHookCount, '0', 'unresolvedRuntimeHookCount', failures);
    assertEqual(value.validationIssueCount, '0', 'validationIssueCount', failures);
    assertEqual(value.readyForRuntimeHarness, '1', 'readyForRuntimeHarness', failures);
    assertEqual(value.persistedRomByteCount, '0', 'persistedRomByteCount', failures);
    assertEqual(value.persistedPixelCount, '0', 'persistedPixelCount', failures);
    assertEqual(value.persistedHashCount, '0', 'persistedHashCount', failures);
    assertEqual(value.persistedAudioByteCount, '0', 'persistedAudioByteCount', failures);
    assertEqual(value.persistedInstructionByteCount, '0', 'persistedInstructionByteCount', failures);
    assertEqual(value.persistedRegisterTraceCount, '0', 'persistedRegisterTraceCount', failures);
    assertEqual(value.persistedRuntimeValueCount, '0', 'persistedRuntimeValueCount', failures);
    assertTruthy(Number(value.tableCount) >= 2, 'tableCount', failures);
    assertTruthy(Number(value.hookRows) >= 49, 'hookRows', failures);
    assertTruthy(value.textHasA48, 'textHasA48', failures);
    assertTruthy(value.textHas9c3, 'textHas9c3', failures);
    assertTruthy(value.textHasHarnessStatus, 'textHasHarnessStatus', failures);
    assertTruthy(value.returnReady, 'returnReady', failures);
    assertEqual(value.returnIssues, 0, 'returnIssues', failures);

    console.log(JSON.stringify({ ok: failures.length === 0, value, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
