import { DirectFileOutput, EgressClient, WebhookReceiver } from 'livekit-server-sdk';
import { loadConfig, loadLabels } from './config.js';
import { createHandler } from './handler.js';
import { createServer } from './server.js';

const config = loadConfig();
const client = new EgressClient(config.livekitHost, config.apiKey, config.apiSecret);

// Adapter: the handler passes a plain { filepath } object.
const egress = {
  startTrackEgress: (room, output, trackSid) =>
    client.startTrackEgress(room, new DirectFileOutput({ filepath: output.filepath }), trackSid),
};

const handler = createHandler({ config, egress, labels: loadLabels(config.labelsFile) });
const receiver = new WebhookReceiver(config.apiKey, config.apiSecret);
const server = createServer({ receiver, handler });

server.listen(config.port, () => {
  console.info(
    `recorder listening on :${config.port}, output ${config.outDir}, audio=${config.recordAudio} video=${config.recordVideo} screen=${config.recordScreenShare}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
