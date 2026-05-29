import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
export const config = {
    port: Number(process.env.PORT ?? 3001),
    clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    tickRateHz: 20,
    proximityRateHz: 4,
    proximityRadiusPx: 5 * 32,
    defaultSpawn: { x: 400, y: 300 },
    livekitUrl: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    hostToken: process.env.HOST_TOKEN ?? '',
};
//# sourceMappingURL=config.js.map