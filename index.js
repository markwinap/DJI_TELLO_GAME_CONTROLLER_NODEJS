/*
Marco Martinez -  markwinap@gmail.com
*/

const gamepad = require('gamepad');
//UPP
const dgram = require('dgram');
const server = dgram.createSocket('udp4');
const status = dgram.createSocket('udp4');
//UDP PORTS
const port = 8889;//TELLO PORT
const port_status = 8890;//TELLO STATUS PORT
//TELLO IP
const tello = '192.168.10.1';

gamepad.init();
 
const deathZone = 0.099;//FILTER FOR AXIS
const scanInterval = 15;//Miliseconds to scan controller input
const getInputInterval = 300;//Miliseconds to send comand to drone
let controllerType = 'ps4';

let controller = {//Controller mapping
    xbox_1 : {
        axis: {
            0: {d: 1},// - 1 to invert result
            1: {c: 1},
            2: {a: 1},
            3: {b: 1}
        },
        button: {
            4: 'land',
            5: 'takeoff',
            0: 'flip f',
            1: 'flip b',
            2: 'flip l',
            3: 'flip r',
            6: 'emergency',
            7: 'emergency',
            8: 'command',
            9: 'command',
            10: 'flip b',
            11: 'flip r',
            12: 'flip l',
            13: 'flip f',
        },
        button_exclude : [],
        axis_exclude : [4, 5]
    },
    ps4 : {
        axis: {
            0: {b: -1},// - 1 to invert result
            1: {a: 1},
            2: {c: -1},
            3: {d: 1}
        },
        button: {
            4: 'command',
            5: 'command',
            0: 'flip l',
            1: 'flip b',
            2: 'flip r',
            3: 'flip f',
            6: 'command',
            7: 'command',
            8: 'takeoff',
            9: 'land',
            10: 'emergency',
            11: 'emergency',
            12: 'command',
            13: 'command',
        },
        button_exclude : [],
        axis_exclude : [4, 5, 6, 7]
    }
};
let temp_input = {
    axis: {},
    button: {}
}

let device = gamepad.deviceAtIndex();
controllerType = getVendor(device);

setInterval(gamepad.detectDevices, 500);
let getButtons = setInterval(gamepad.processEvents, scanInterval);
let getInput = setInterval(function(){
    let buttons = Object.keys(temp_input.button);
    for(let i in buttons){
        if(temp_input.button[buttons[i]]){
            sendCMD(controller[controllerType].button[buttons[i]]);
        }
    }
    sendCMD(getRC(temp_input.axis, controller[controllerType].axis));
    temp_input.button = {};
}, getInputInterval);

//###GAMEPAD EVENT LISTENER
gamepad.on('move', function (id, axis, value) {
  if(value < (deathZone * -1) || value > deathZone) {
    if(!controller[controllerType].axis_exclude.includes(axis)){
        temp_input.axis[axis] = value;
    }
  }
  else{
    if(!controller[controllerType].axis_exclude.includes(axis)){
        temp_input.axis[axis] = false;
    }    
  }
});
gamepad.on('down', function (id, num) {    
    if(!controller[controllerType].button_exclude.includes(num)){
        temp_input.button[num] = true;
    }
});
gamepad.on('attach', function (id, device) {
    controllerType = getVendor(device);
});
   

//###UDP### CLIENT SERVER
server.on('error', (err) => {
    console.log(`server error:\n${err.stack}`);
    server.close();
});
server.on('message', (msg, rinfo) => {
    //UNCOMNET FOR DEBUG
    console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
});
server.on('listening', () => {
    let address = server.address();
    //UNCOMNET FOR DEBUG
    console.log(`UDP CMD RESPONSE SERVER - ${address.address}:${address.port}`);
});
server.bind(port);
//###UDP### STATUS SERVER
status.on('listening', function () {
    let address = status.address();
    //UNCOMNET FOR DEBUG
    console.log(`UDP STATUS SERVER - ${address.address}:${address.port}`);
});
status.on('message', function (message, remote) {
    //UNCOMNET FOR DEBUG
    //console.log(`${remote.address}:${remote.port} - ${message}`);
});
status.bind(port_status);


//###OTHER FUNCTIONS
function sendCMD(command){
    return new Promise((resolve, reject) => {
        let msg = Buffer.from(command);
        server.send(msg, 0, msg.length, port, tello, function (err) {
          if (err) {
            console.error(err);
            reject(`ERROR : ${command}`);
          } else resolve('OK');
        });
      });
}
function getRC(axis, axis_map){
    let obj = {a: 0, b: 0, c: 0, d: 0};
    let axis_arr = Object.keys(axis);//{ '0': false, '1': false, '2': false, '3': false }
    for(let i in axis_arr){
        let temp = Object.keys(axis_map[axis_arr[i]]);//{d: 1}
        obj[temp[0]] = axis[axis_arr[i]] ? parseInt((axis[axis_arr[i]] * 100) * axis_map[axis_arr[i]][temp[0]], 0) : 0;        
    }
    return `rc ${obj.a} ${obj.b} ${obj.c} ${obj.d}`;    
}
function getVendor(device){
    let controllerType = '';
    if(device.vendorID == '1118'){
        controllerType =  'xbox_1';
    }
    else if(device.vendorID == '1356'){
        controllerType =  'ps4';
    }
    else{
        controllerType = 'ps4';
    }
    console.log(`YOU CONNECTED A ${controllerType} CONTROLLER`);
    return controllerType;
}