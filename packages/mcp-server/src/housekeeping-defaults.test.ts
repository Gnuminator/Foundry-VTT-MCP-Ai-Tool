/** M0 housekeeping (plan 0.7): safe defaults for the Pi and the GM's PC. */
import { describe, expect, it } from 'vitest';

import { comfyuiAutoStartEnabled } from './comfyui-client.js';
import { foundryLinkBindHost, foundryWebrtcPort } from './foundry-connector.js';

describe('ComfyUI auto-start', () => {
  it('is off unless COMFYUI_AUTOSTART is set to a true value', () => {
    expect(comfyuiAutoStartEnabled({})).toBe(false);
    expect(comfyuiAutoStartEnabled({ COMFYUI_AUTOSTART: 'false' })).toBe(false);
    expect(comfyuiAutoStartEnabled({ COMFYUI_AUTOSTART: '' })).toBe(false);
    for (const on of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(comfyuiAutoStartEnabled({ COMFYUI_AUTOSTART: on })).toBe(true);
    }
  });
});

describe('Foundry link bind host', () => {
  it('is loopback unless FOUNDRY_LINK_HOST opts in', () => {
    expect(foundryLinkBindHost({})).toBe('127.0.0.1');
    expect(foundryLinkBindHost({ FOUNDRY_LINK_HOST: '  ' })).toBe('127.0.0.1');
    expect(foundryLinkBindHost({ FOUNDRY_LINK_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });
});

describe('WebRTC signaling port', () => {
  it('is 31416 unless FOUNDRY_WEBRTC_PORT sets a valid port', () => {
    expect(foundryWebrtcPort({})).toBe(31416);
    expect(foundryWebrtcPort({ FOUNDRY_WEBRTC_PORT: '31516' })).toBe(31516);
    expect(foundryWebrtcPort({ FOUNDRY_WEBRTC_PORT: '80' })).toBe(31416);
    expect(foundryWebrtcPort({ FOUNDRY_WEBRTC_PORT: 'x' })).toBe(31416);
  });
});
