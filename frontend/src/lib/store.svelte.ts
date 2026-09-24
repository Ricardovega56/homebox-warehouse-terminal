import { HomeboxApi, type HomeboxConfig } from './api';

export const config = $state<HomeboxConfig>({
  baseUrl: '',
  token: '',
  relayUrl: '',
  receivingLocationId: '',
  stagingLocationId: '',
  receivingLocationName: '_RECEIVING',
  stagingLocationName: '_STAGING',
  labelType: '62red'
});

export const connected = $state({ value: false });

export function saveConfig() {
  localStorage.setItem('hb_config', JSON.stringify(config));
}

export function loadConfig() {
  const saved = localStorage.getItem('hb_config');
  if (saved) {
    Object.assign(config, JSON.parse(saved));
  }
}

export function clearConfig() {
  localStorage.removeItem('hb_config');
  config.baseUrl = '';
  config.token = '';
  config.relayUrl = '';
  config.receivingLocationId = '';
  config.stagingLocationId = '';
  connected.value = false;
}

export function getApi() {
  return new HomeboxApi({ baseUrl: config.baseUrl, token: config.token });
}
