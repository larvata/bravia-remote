#!/usr/bin/env node

import Bravia from '../lib';
import program from 'commander';
import pkg from '../package.json';

const version = pkg.version || '0.0.0';

const list = (val) => {
  return val.split(',');
};

const checkParams = () => {
  const result = {
    error: null,
  };

  if (!program.server) {
    result.error = 'server ip is missing';
    return result;
  }

  if (!program.pskkey) {
    result.error = 'PSK key is missing';
  }

  return result;
};

const tryGetRemoteControlCommand = (bravia, cmd) => {
  const availableCommands = bravia.deviceInfo.controllerInfo.commands;
  let result = availableCommands.find(ac => ac.name === cmd);
  if (!result) {
    return null;
  }
  result = Object.assign({}, result);
  result.isRemoteControlCommand = true;
  result.isDirectCommand = false;
  return result;
};

const tryGetDirectCommand = (bravia, cmd) => {
  const directCommands = [{
    name: 'setInputSource',
    func: bravia.setInputSource,
  }];

  const result = {
    name: null,
    args: [],
    isRemoteControlCommand: false,
    isDirectCommand: true,
  };
  const functionParseRegex = /(\b[^()]+)\((.*)\)$/;
  const matchs = cmd.match(functionParseRegex);
  if (!matchs) {
    return null;
  }

  const funcName = matchs[1];
  const args = matchs[2].split(',');
  const directCommand = directCommands.find(dc=> dc.name === funcName);

  if (!directCommand) {
    return null;
  }

  result.name = directCommand.name;
  result.func = directCommand.func;
  result.args = args;

  return result;
};

const parseCommands = (bravia) => {
  const commands = program.commands;

  const commandList = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    const remoteCommand = tryGetRemoteControlCommand(bravia, cmd);
    if (remoteCommand) {
      commandList.push(remoteCommand);
      continue;
    }

    const directCommand = tryGetDirectCommand(bravia, cmd);
    if (directCommand) {
      commandList.push(directCommand);
      continue;
    }

    commandList.push({
      cmd,
      available: false,
    });
  }
  return commandList;
};

program
  .version(version)
  .option('-i', 'Interaction mode')
  .option('-s, --server <ipaddr>', 'tv ip address')
  .option('-c, --commands <commands>', 'remote commands', list)
  .option('-k, --pskkey <psk>', 'PSK key')
  .option('-l, --list-device-info', 'device infomation')
  .parse(process.argv);

const checkParamsResult = checkParams(program);
if (checkParamsResult.error) {
  console.log(checkParamsResult.error);
  console.log('  Example: ');
  console.log('    bravia -s 192.168.0.111 -k 8888 -c "VolumeUp"');
  program.help();
  process.exit(1);
}

const { server, pskkey } = program;
const bravia = new Bravia(server, pskkey);

if (program.listDeviceInfo) {
  bravia.connect()
    .then((deviceInfo) => {
      const { inputSource, systemInfo, controllerInfo } = deviceInfo;
      const availableInputSource = inputSource.map(s => `${s.label || '<NONAME>'}(${s.title})`);
      const availableCommands = controllerInfo.commands.map(c => c.name);

      console.log('Available Input Source:');
      console.log(availableInputSource.join(', \n'));
      console.log('');
      console.log('Available Commands:');
      console.log(availableCommands.join(', '));
      console.log('');
      console.log('Device Info');
      console.log(JSON.stringify(systemInfo, null, 2));
    })
    .catch((err) => {
      console.log(err);
    });
}
else if (program.commands) {
  bravia.connect()
    .then(() => {
      const cmds = parseCommands(bravia);
      return bravia.executeCommands(cmds);
    })
    .then(() => {
      console.log('command successed');
    })
    .catch((err) => {
      console.log(err);
    });
}
else {
  if (!program.commands) {
    program.help();
    process.exit(0);
  }
}

