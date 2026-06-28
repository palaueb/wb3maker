#!/usr/bin/env node
'use strict';

const cdpJsonUrl = process.env.CDP_JSON_URL || 'http://127.0.0.1:9225/json';
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
        const result = audioRuntimeOutputFixtureRenderPreview();
        const out = document.getElementById('audio-runtime-output-fixture-preview');
        const info = document.getElementById('audio-runtime-output-fixture-info');
        const d = out.dataset;
        return {
          info: info.textContent,
          catalogBacked: d.audioRuntimeOutputFixtureCatalogBacked,
          eventContractCatalogBacked: d.audioRuntimeOutputFixtureEventContractCatalogBacked,
          previewOk: d.audioRuntimeOutputFixturePreviewOk,
          phaseCount: d.audioRuntimeOutputFixturePhaseCount,
          writeCount: d.audioRuntimeOutputFixtureWriteCount,
          psgPhaseCount: d.audioRuntimeOutputFixturePsgPhaseCount,
          fmPhaseCount: d.audioRuntimeOutputFixtureFmPhaseCount,
          mixedPhaseCount: d.audioRuntimeOutputFixtureMixedPhaseCount,
          psgWriteCount: d.audioRuntimeOutputFixturePsgWriteCount,
          fmWriteCount: d.audioRuntimeOutputFixtureFmWriteCount,
          mixedWriteCount: d.audioRuntimeOutputFixtureMixedWriteCount,
          eventEdgeCount: d.audioRuntimeOutputFixtureEventEdgeCount,
          branchCandidateCount: d.audioRuntimeOutputFixtureBranchCandidateCount,
          globalInputCount: d.audioRuntimeOutputFixtureGlobalInputCount,
          fieldInputKeyCount: d.audioRuntimeOutputFixtureFieldInputKeyCount,
          frameStepTraceOperationCount: d.audioRuntimeOutputFixtureFrameStepTraceOperationCount,
          smokeTimelineGlobalInputRefCount: d.audioRuntimeOutputFixtureSmokeTimelineGlobalInputRefCount,
          validationIssueCount: d.audioRuntimeOutputFixtureValidationIssueCount,
          readyForRuntimeHarness: d.audioRuntimeOutputFixtureReadyForRuntimeHarness,
          eventContractRequiredKeyCount: d.audioRuntimeOutputFixtureEventContractRequiredKeyCount,
          eventContractOptionalKeyCount: d.audioRuntimeOutputFixtureEventContractOptionalKeyCount,
          eventContractForbiddenPayloadKeyCount: d.audioRuntimeOutputFixtureEventContractForbiddenPayloadKeyCount,
          eventContractDerivedModelCount: d.audioRuntimeOutputFixtureEventContractDerivedModelCount,
          eventContractValidationIssueCount: d.audioRuntimeOutputFixtureEventContractValidationIssueCount,
          eventContractReadyForRuntimeHarness: d.audioRuntimeOutputFixtureEventContractReadyForRuntimeHarness,
          persistedRomByteCount: d.audioRuntimeOutputFixturePersistedRomByteCount,
          persistedStreamByteCount: d.audioRuntimeOutputFixturePersistedStreamByteCount,
          persistedRegisterValueCount: d.audioRuntimeOutputFixturePersistedRegisterValueCount,
          persistedRegisterTraceCount: d.audioRuntimeOutputFixturePersistedRegisterTraceCount,
          persistedSampleCount: d.audioRuntimeOutputFixturePersistedSampleCount,
          persistedAudioByteCount: d.audioRuntimeOutputFixturePersistedAudioByteCount,
          tableCount: out.querySelectorAll('table').length,
          rowCount: out.querySelectorAll('tbody tr').length,
          textHasPsg: out.textContent.includes('psg_tone_period_write'),
          textHasFm: out.textContent.includes('fm_pitch_period_write'),
          textHasC232: out.textContent.includes('audio_output_mode_select'),
          textHasEventContract: out.textContent.includes('Runtime output event contract'),
          textHasChannelPortIntent: out.textContent.includes('runtime_output_channel_port_intent'),
          returnReady: result.readyForRuntimeHarness,
          returnEventContractReady: result.eventContractReadyForRuntimeHarness,
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
    assertEqual(value.eventContractCatalogBacked, '1', 'eventContractCatalogBacked', failures);
    assertEqual(value.previewOk, '1', 'previewOk', failures);
    assertEqual(value.phaseCount, '14', 'phaseCount', failures);
    assertEqual(value.writeCount, '39', 'writeCount', failures);
    assertEqual(value.psgPhaseCount, '6', 'psgPhaseCount', failures);
    assertEqual(value.fmPhaseCount, '7', 'fmPhaseCount', failures);
    assertEqual(value.mixedPhaseCount, '1', 'mixedPhaseCount', failures);
    assertEqual(value.psgWriteCount, '7', 'psgWriteCount', failures);
    assertEqual(value.fmWriteCount, '26', 'fmWriteCount', failures);
    assertEqual(value.mixedWriteCount, '6', 'mixedWriteCount', failures);
    assertEqual(value.eventEdgeCount, '7', 'eventEdgeCount', failures);
    assertEqual(value.branchCandidateCount, '14', 'branchCandidateCount', failures);
    assertEqual(value.globalInputCount, '3', 'globalInputCount', failures);
    assertEqual(value.fieldInputKeyCount, '13', 'fieldInputKeyCount', failures);
    assertEqual(value.frameStepTraceOperationCount, '48', 'frameStepTraceOperationCount', failures);
    assertEqual(value.smokeTimelineGlobalInputRefCount, '6336', 'smokeTimelineGlobalInputRefCount', failures);
    assertEqual(value.validationIssueCount, '0', 'validationIssueCount', failures);
    assertEqual(value.readyForRuntimeHarness, '1', 'readyForRuntimeHarness', failures);
    assertEqual(value.eventContractRequiredKeyCount, '25', 'eventContractRequiredKeyCount', failures);
    assertEqual(value.eventContractOptionalKeyCount, '4', 'eventContractOptionalKeyCount', failures);
    assertEqual(value.eventContractForbiddenPayloadKeyCount, '21', 'eventContractForbiddenPayloadKeyCount', failures);
    assertEqual(value.eventContractDerivedModelCount, '5', 'eventContractDerivedModelCount', failures);
    assertEqual(value.eventContractValidationIssueCount, '0', 'eventContractValidationIssueCount', failures);
    assertEqual(value.eventContractReadyForRuntimeHarness, '1', 'eventContractReadyForRuntimeHarness', failures);
    assertEqual(value.persistedRomByteCount, '0', 'persistedRomByteCount', failures);
    assertEqual(value.persistedStreamByteCount, '0', 'persistedStreamByteCount', failures);
    assertEqual(value.persistedRegisterValueCount, '0', 'persistedRegisterValueCount', failures);
    assertEqual(value.persistedRegisterTraceCount, '0', 'persistedRegisterTraceCount', failures);
    assertEqual(value.persistedSampleCount, '0', 'persistedSampleCount', failures);
    assertEqual(value.persistedAudioByteCount, '0', 'persistedAudioByteCount', failures);
    assertTruthy(Number(value.tableCount) >= 2, 'tableCount', failures);
    assertTruthy(Number(value.rowCount) >= 17, 'rowCount', failures);
    assertTruthy(value.textHasPsg, 'textHasPsg', failures);
    assertTruthy(value.textHasFm, 'textHasFm', failures);
    assertTruthy(value.textHasC232, 'textHasC232', failures);
    assertTruthy(value.textHasEventContract, 'textHasEventContract', failures);
    assertTruthy(value.textHasChannelPortIntent, 'textHasChannelPortIntent', failures);
    assertTruthy(value.returnReady, 'returnReady', failures);
    assertTruthy(value.returnEventContractReady, 'returnEventContractReady', failures);
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
