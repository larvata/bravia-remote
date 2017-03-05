import { Client } from 'node-ssdp';
import { request, plugins, createTransport } from 'popsicle';
// import wol from 'wol';

// var createProxy = require('popsicle-proxy-agent')
// var proxy = createProxy({
//   proxy: 'http://127.0.0.1:8888'
// });


const ipAddressValidationRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;

const parseSSDPHeaders = (headers) => {
  const result = {};
  const {
    LOCATION,
    USN,
    'X-AV-SERVER-INFO': X_AV_SERVER_INFO,
  } = headers;
  const ipRegex = /http:\/\/(\d+\.\d+\.\d+\.\d+):\d+\//;
  const ipMatch = LOCATION.match(ipRegex);
  if (ipMatch && ipMatch.length === 2) {
    result.ip = ipMatch[1];
  }

  const uuidRegex = /uuid:(\S+-\S+-\S+-\S+-\S+)::urn/;
  const uuidMatch = USN.match(uuidRegex);
  if (uuidMatch && uuidMatch.length === 2) {
    result.uuid = uuidMatch[1];
  }

  const devInfoRegex = /mn="([^"]*)"/;
  const devInfoMatch = X_AV_SERVER_INFO.match(devInfoRegex);
  if (devInfoMatch && devInfoMatch.length === 2) {
    result.model = devInfoMatch[1];
  }

  return result;
};

export default class Bravia{
  constructor(ip, psk){
    if (!ipAddressValidationRegex.test(ip)) {
      throw new Error('ip address format incorrect.', ip);
    }
    this.pskKey = psk || null;
    this.deviceIP = ip;
    this.packetID = 0;
    this.deviceInfo = {
      inputSource: [],
      systemInfo: {},
      controllerInfo: {},
    };
  }

  _getSystemInfo() {
    const url = `http://${this.deviceIP}/sony/system`;
    const postBody = this._buildPostBody('getSystemInformation');
    return this._doPost(url, postBody)
      .then((res) => {
        const isResultAvailable = Array.isArray(res.body.result) && res.body.result.length === 1;
        if (!isResultAvailable) {
          return Promise.reject('Invalid system information result');
        }

        this.deviceInfo.systemInfo = res.body.result[0];
        return Promise.resolve();
      })
  }

  _getInputSource() {
    const url = `http://${this.deviceIP}/sony/avContent`;
    const postBody = this._buildPostBody('getCurrentExternalInputsStatus');
    return this._doPost(url, postBody)
      .then((res) => {
        const isResultAvailable = Array.isArray(res.body.result) && res.body.result.length === 1;
        if (!isResultAvailable) {
          return Promise.reject('Invalid input source result');
        }

        this.deviceInfo.inputSource = res.body.result[0];
        return Promise.resolve();
      });
  }

  _getRemoteControllerInfo() {
    const url = `http://${this.deviceIP}/sony/system`;
    const postBody = this._buildPostBody('getRemoteControllerInfo');
    return this._doPost(url, postBody)
      .then((res) => {
        const isResultAvailable = Array.isArray(res.body.result) && res.body.result.length === 2;

        if (!isResultAvailable) {
          return Promise.reject('Invalid remote controller info result');
        }

        const { result } = res.body;

        this.deviceInfo.controllerInfo = {
          type: result[0],
          commands: result[1],
        };
        return Promise.resolve();
      })
      .catch((err) => {
        return Promise.reject(err);
      });
  }

  // build post body for remote control commands
  _buildIRCCPostBody(command) {
    const postBody =`<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">
          <IRCCCode>${command.value}</IRCCCode>
        </u:X_SendIRCC>
      </s:Body>
    </s:Envelope>`;
    return postBody;
  }

  _buildPostBody(method, params = []) {
    const postBody = {
      method,
      id: ++this.packetID,
      params,
      version: '1.0',
    };
    return postBody;
  }

  _doPost(url, postBody) {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        method: 'POST',
        url,
        body: postBody,
        headers: {},
        // reduce the timeout, because the device mostly in a lan
        timeout: 3000,
        // transport: createTransport({
        //   agent: proxy('http://127.0.0.1:8888')
        // })
      };

      if (this.pskKey) {
        requestOptions.headers['X-Auth-PSK'] = this.pskKey;
      }

      request(requestOptions)
        .use(plugins.parse('json'))
        .then((res) => {
          resolve(res);
        })
        .catch((err) => {
          if (err.code !== 'EPARSE') {
            return reject(err);
          }
          resolve();
        });
    });
  }

  discoveryDevices(searchTimeout = 5000) {
    const ssdp = new Client();
    return new Promise((resolve, reject) => {
      const devices = [];
      ssdp.on('response', (headers, statusCode, rinfo) => {
        const device = parseSSDPHeaders(headers);
        if (!devices.find(d => d.uuid === device.uuid)) {
          devices.push(device);
        }
      });
      ssdp.search('urn:schemas-sony-com:service:ScalarWebAPI:1');

      setTimeout(() => {
        ssdp.stop();

        if (devices.length === 0) {
          // not find any devices
          return reject('failed find any devices.');
        }
        else {
          return resolve(devices);
        }
      }, searchTimeout);
    });
  }

  executeCommands = (commands, results = []) => {
    const cmd = commands.shift(1);
    if (!cmd) {
      return Promise.resolve(results);
    }

    results.push(cmd);
    if (cmd.isDirectCommand) {
      return cmd.func.apply(this, cmd.args)
        .then((result) => {
          cmd.result = result;
          return this.executeCommands(commands, results);
        });
    }
    else if (cmd.isRemoteControlCommand) {
      return this.sendRemoteCommand(cmd.name)
        .then((result) => {
          cmd.result = result;
          return this.executeCommands(commands, results);
        });
    }
  };

  connect(autoPowerOn = true) {
    // return this._getAvailableDevices()
      // .then((devices) => {
        return Promise
          .all([
            this._getInputSource,
            this._getSystemInfo,
            this._getRemoteControllerInfo,
          ].map(p => p.apply(this)))
          .then(() => Promise.resolve(this.deviceInfo))
          .catch((err) => {
            const errorMessage = `Error: Failed to Connect Device: ${err}\nPlease ensure your device is switched on and try again.`;
            throw errorMessage;
          });
      // });
  }

  getPowerStatus() {
    const url = `http://${this.deviceIP}/sony/system`;
    const postBody = this._buildPostBody('getPowerStatus');
    return this._doPost(url, postBody)
      .then((res) => {
        const isResultAvailable = Array.isArray(res.body.result) && res.body.result.length === 1;

        if (!isResultAvailable) {
          return Promise.reject('Invalid power status result');
        }

        const { status } = res.body.result[0];
        this.deviceInfo.status = {
          isPowerOn: (status === 'active'),
        };
        return Promise.resolve(this.deviceInfo.status);
      });
  }

  setInputSource(inputSourceLabel) {
    const targetInputSource = this.deviceInfo.inputSource.find(s => s.label === inputSourceLabel);
    if (!targetInputSource) {
      return Promise.reject('Invalid input source label');
    }

    const url = `http://${this.deviceIP}/sony/avContent`;
    const params = [{
      uri: targetInputSource.uri,
    }];
    const postBody = this._buildPostBody('setPlayContent', params);
    return this._doPost(url, postBody);
  }

  switchTV() {

  }

  sendRemoteCommand(commandName) {
    const command = this.deviceInfo.controllerInfo.commands.find(c => c.name === commandName);

    if (!command) {
      const error = `Command: '${commandName}' is not available for your device.`;
      return Promise.reject(error);
    }

    const url = `http://${this.deviceIP}/sony/IRCC`;
    const postBody = this._buildIRCCPostBody(command);
    return this._doPost(url, postBody).catch((err) => {
      // console.log(err);
    });
  }
}
