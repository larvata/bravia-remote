# bravia-remote
A library/CLI for control your sony bravia device.

## Use as Command line tools

```
npm install -g bravia-remote
```

```
  Usage: bravia [options]

  Options:

    -h, --help                 output usage information  
    -V, --version              output the version number 
    -i                         Interaction mode
    -s, --server <ipaddr>      tv ip address
    -c, --commands <commands>  remote commands
    -k, --pskkey <psk>         PSK key
    -l, --list-device-info     device infomation 


  Examples: 
    # get device status
    bravia -s 192.168.0.111 -k 0000 -l

    # switch the input source and volume up
    bravia -s 192.168.0.111 -k 0000 -c "setInputSource(DisplayPort),VolumeUp"

```


## Use as library

```
npm install --save bravia-remote
```

```
import Bravia from 'bravia-remote';

const bravia = new Bravia('192.168.0.111', '0000');

bravia.connect()
  .then((deviceInfo) => {
    const targetInput = deviceInfo.inputSource.find(is => is.label === 'DisplayPort');
    return bravia.setInputSource(targetInput.uri);
  })
  .then(() => {
    return bravia.sendRemoteCommand('VolumeUp');
  })
  .catch((err) => {
    console.log(err);
  });

```