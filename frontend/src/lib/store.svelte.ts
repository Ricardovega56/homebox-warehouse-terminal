import { HomeboxApi, type HomeboxConfig } from './api';

export const config = $state<HomeboxConfig>({
  baseUrl: '',
  token: '',
  relayUrl: '',
  receivingLocationId: '',
  stagingLocationId: '',
  receivingLocationName: '_RECEIVING',
  stagingLocationName: '_STAGING',
  labelType: '62red',
  blePrefix: 'Tera'
});

export const connected = $state({ value: false });

export function saveConfig() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('hb_config', JSON.stringify(config));
  }
}

export function loadConfig() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('hb_config');
    if (saved) {
      Object.assign(config, JSON.parse(saved));
    }
  }
}

export function clearConfig() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('hb_config');
  }
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
