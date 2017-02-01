import Bravia from '../lib';
// import net from 'net';
// import dgram from 'dgram';
// import buffer from 'buffer';


const bravia = new Bravia('192.168.1.114', '0000');
const mac = 'AC:9B:0A:19:CE:DE';
// const { Buffer } = buffer;
// const macBytes = 6;

bravia.connect()
  .then((deviceInfo) => {
    const targetInput = deviceInfo.inputSource.find(is => is.label === 'DisplayPort');
    // return bravia.setInputSource(targetInput.uri);
    // return bravia.getPowerStatus();
    //
    return bravia.sendRemoteCommand('VolumeUp');
  })
  .then((status) => {
    console.log(status);
  })
  .catch((err) => {
    console.log(err);
  });



// wol.wake(mac, {});
