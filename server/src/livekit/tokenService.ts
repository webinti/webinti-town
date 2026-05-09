import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config.js';

export async function createLiveKitToken(
  roomSlug: string,
  identity: string,
  displayName: string,
): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity,
    name: displayName,
    ttl: '6h',
  });
  at.addGrant({
    roomJoin: true,
    room: roomSlug,
    canPublish: true,
    canSubscribe: true,
  });
  return await at.toJwt();
}
