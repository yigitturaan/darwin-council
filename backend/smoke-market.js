import { getMarketSnapshot } from './market.js';

try {
  const x = await getMarketSnapshot();
  console.log(JSON.stringify({ mode: 'live', source: x.source, instrument: x.instrument,
    observedAt: new Date(x.observedAt).toISOString(), sourceTimes: x.sourceTimes,
    startClose: x.startClose, dueCandleEnd: new Date(x.dueCandleEnd).toISOString(),
    metrics: x.metrics, sourceHash: x.sourceHash, status: x.status }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
