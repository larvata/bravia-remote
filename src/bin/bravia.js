#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import Bravia from '../lib';
import program from 'commander';
import pkg from '../package.json';

const version = pkg.version || '0.0.0';

const verboseLog = function(){
  if (!program.verbose) {
    return;
  }
  console.log.apply(null, arguments);
};

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
  verboseLog('parsed commands:', commandList);
  return commandList;
};

program
  .version(version)
  // .option('-i', 'Interaction mode')
  .option('-s, --server <ipaddr>', 'tv ip address')
  .option('-c, --commands <commands>', 'remote commands', list)
  .option('-k, --pskkey <psk>', 'PSK key')
  .option('-l, --list-device-info', 'device infomation')
  .option('-v, --verbose', 'verbose mode')
  .parse(process.argv);


if (program.rawArgs.length <= 2) {
  // start bravia-remote without any argument
  // display help information and exit
  program.help();
  process.exit();
}

// load user profile
const userProfilePath = `${process.env.HOME}/.braviarc.json`;
let userProfile = {};
if (fs.existsSync(userProfilePath)) {
  try {
    userProfile = require(userProfilePath);
  }
  catch (e) {
    console.error(e);
    process.exit(1);
  }
}

if (userProfile && !program.server && !program.pskkey) {
  const { server, pskkey } = userProfile.default;
  program.server = server;
  program.pskkey = pskkey;
  verboseLog('Device Server was not provided, load the server config stored in the .rc file.');
}


const checkParamsResult = checkParams(program);
if (checkParamsResult.error) {
  console.error('  error: ', checkParamsResult.error);
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

      const commandOutput = [];
      commandOutput.push('Available Input Source:');
      commandOutput.push(availableInputSource.join(', \n'));
      commandOutput.push('');
      commandOutput.push('Available Commands:');
      commandOutput.push(availableCommands.join(', '));
      commandOutput.push('');
      commandOutput.push('Device Info');
      commandOutput.push(JSON.stringify(systemInfo, null, 2));
      console.log(commandOutput.join('\n'));
    })
    .catch((err) => {
      console.error(err);
    });
}
else if (program.commands) {
  bravia.connect()
    .then(() => {
      const cmds = parseCommands(bravia);
      return bravia.executeCommands(cmds);
    })
    .then(() => {
      console.log('Command successed.\n');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      if (userProfile
        && userProfile.default.server === program.server
        && userProfile.default.pskkey === program.pskkey) {
        // known server, just exit
        process.exit(0);
      }

      const question = `This is the first time you connect to ${program.server}, \ndo you want to save the server-ip and psk-key for next use? (y/n) `;
      process.stdout.write(question);
      rl.on('line', (answer) => {
        if (answer.toLowerCase() === 'y') {
          userProfile = userProfile || {};
          userProfile.default = userProfile.default || {};
          userProfile.default = {
            server: program.server,
            pskkey: program.pskkey,
          };
          fs.writeFileSync(userProfilePath, JSON.stringify(userProfile, null, 2));
          console.log('write profile done.');
        }
        rl.close();
        process.exit(0);
      });
    })
    // .then(() => {

    // })
    .catch((err) => {
      console.error(err);
    });
}
else {
  if (!program.commands) {
    program.help();
    process.exit(0);
  }
}

