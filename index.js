/*
Marco Martinez -  markwinap@gmail.com
*/
const WebSocket = require('ws');//WEBSOCKET
const gamepad = require('gamepad');//GAMEPAD
const dgram = require('dgram');//UDP
const server = dgram.createSocket('udp4');// UDP SERVER IPv4 FOR SENDING COMMANDS AND RECEIVING COMMAND CONFIRMATION
const status = dgram.createSocket('udp4');// UDP SERVER IPv4 FOR RECEIVING STATUS
const video = dgram.createSocket('udp4');// UDP SERVER IPv4 FOR RECEIVING VIDEO RAW H264 ENCODED YUV420p
const express = require('express');//EXPRESS HTTP SERVER
const app = express();
const bodyParser = require('body-parser');//EXPRESS BODY RESPONSE PARSER
const colors = require('colors');//CONSOLE COLORS
const fs = require('fs');//FILE SYSTEM READ WRITE FILES

//PORTS
const port_cmd = 8889;//TELLO PORT
const port_status = 8890;//TELLO STATUS PORT
const port_video = 11111;//TELLO VIDEO PORT
const port_websocket = 8080;//WEBSOCKET PORT
const port_httpserver = 3000;//Express HTTP Server PORT

const tello = '192.168.10.1';//TELLO IP

//OBJ TEMP INFO
let  videoBuff = [];//VIDEO BUFFER
let  counter = 0;//COUNTER FOR VIDEO BUFFER FRAMES
let temp_input = {axis: {}, button: {}};//HOLD LATEST GAMEPAD VALUE
 
const deathZone = 0.099;//FILTER FOR AXIS ANALOG INPUT
const scanInterval = 15;//MILISECONDS TO SCAN FOR GAMEPAD INPUT
const scanGamePadInterval = 500;//MILISECONDS TO SCAN FOR GAMEPAD ATTACH
const getInputInterval = 300;//MILISECONDS TO SEND CMD TO TELLO DRONE
let controllerType = 'ps4';//DEFAULT CONTROLLER MAPPING

let controller = {//Controller mapping
    xbox_1 : {
        axis: {
            0: {d: 1},// - 1 to invert result
            1: {c: 1},
            2: {a: 1},
            3: {b: 1}
        },
        button: {
            4: 'land',//OPTIONS
            5: 'takeoff',//SHARE
            0: 'flip f',//˄
            1: 'flip b',//˅
            2: 'flip l',//˂
            3: 'flip r',//>
            6: 'emergency',//L STICK CLICK
            7: 'emergency',//R STICK CLICK
            8: 'streamon',//LB
            9: 'command',//RB
            10: 'flip b',//A
            11: 'flip r',//B
            12: 'flip l',//X
            13: 'flip f',//Y
        },
        button_exclude : [],
        axis_exclude : [4, 5]//4: LT, 5:RT ANALOG
    },
    ps4 : {
        axis: {
            0: {b: -1},// - 1 to invert result
            1: {a: 1},
            2: {c: -1},
            3: {d: 1}
        },
        button: {
            4: 'streamon',//L1
            5: 'command',//R1
            0: 'flip l',//▢
            1: 'flip b',//X
            2: 'flip r',//O
            3: 'flip f',//▲
            6: 'command',
            7: 'command',
            8: 'takeoff',//SHARE
            9: 'land',//OPTIONS
            10: 'emergency',//L STICK CLICK
            11: 'emergency',//R STICK CLICK
            12: 'command',//HOME
            13: 'streamon',//TOUCH PANNEL
        },
        button_exclude : [],
        axis_exclude : [4, 5, 6, 7]//L2 -R2
    }
};


//CONSOLE WELCOME
fs.readFile('banner/_2', 'utf8', function(err, banner) {
    console.log(banner.cyan);
    console.log('OPEN THE FOLLOWING URL IN YOUR INTERNET BROWSER'.white);
    console.log(`http://localhost:${port_httpserver}/\n`.inverse);
    console.log('TO STOP THE SERVER USE'.white);
    console.log(`CTR+C\n`.inverse);
    console.log('HAVE FUN :P'.cyan);
  });
  


gamepad.init();//Init gamepad
let device = gamepad.deviceAtIndex();
controllerType = getVendor(device);

let detectGamepad = setInterval(gamepad.detectDevices, scanGamePadInterval);
let getButtons = setInterval(gamepad.processEvents, scanInterval);
let getInput = setInterval(function(){
    let buttons = Object.keys(temp_input.button);
    for(let i in buttons){
        if(temp_input.button[buttons[i]]){
            sendCMD(controller[controllerType].button[buttons[i]]);
            //console.log(controller[controllerType].button[buttons[i]])
        }
    }
    sendCMD(getRC(temp_input.axis, controller[controllerType].axis));
    //console.log(getRC(temp_input.axis, controller[controllerType].axis))
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



///###EXPRESS HTTP SERVER
app.use('/', express.static('public'));
app.listen(port_httpserver);//START EXPRESS SERVER

//###WEBSOCKET### SERVER
let websocket = new WebSocket.Server({ port: port_websocket });
websocket.on('connection', function connection(websocket) {
    console.log('Socket connected. sending data...');
    websocket.on('error', function error(error) {
        console.log('WebSocket error');
    });
    websocket.on('close', function close(msg) {
        console.log('WebSocket close');
    });
});

//###UDP### VIDEO
//INPUT
//RAW RAW H264 DIVIDED IN MULTIPLE MESSAGES PER FRAME 
video.on('error', (err) => {
    console.log(`server error:\n${err.stack}`);
    video.close();
});
video.on('message', (msg, rinfo) => {
    let buf = Buffer.from(msg);
    if(buf.indexOf(Buffer.from([0, 0, 0, 1])) != -1){//FIND IF FIRST PART OF FRAME
        counter++;
        if(counter == 3){//COLLECT 3 FRAMES AND SEND TO WEBSOCKET
            let temp = Buffer.concat(videoBuff);
            counter = 0
            websocket.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(temp);//SEND OVER WEBSOCKET
                    } catch(e) {
                       console.log(`Sending failed:`, e); 
                    }
                }
            });
            videoBuff.length = 0;
            videoBuff = [];
        }
        videoBuff.push(buf);
    }
    else{
        videoBuff.push(buf);
    }
});
video.on('listening', () => {
    let address = video.address();
    //UNCOMNET FOR DEBUG
    console.log(`UDP VIDEO SERVER - ${address.address}:${address.port}`);
});
video.bind(port_video);

//###UDP### CLIENT SERVER
//INPUT
//OK or Error
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
    console.log(`UDP CMD SERVER - ${address.address}:${address.port}`);
});
server.bind(port_cmd);

//###UDP### STATUS SERVER
//INPUT
//mid:257;x:0;y:0;z:0;mpry:0,0,0;pitch:0;roll:0;yaw:-20;vgx:0;vgy:0;vgz:0;templ:66;temph:69;tof:10;h:0;bat:67;baro:1687.34;time:16;agx:6.00;agy:0.00;agz:-999.00;
status.on('error', (err) => {
    console.log(`server error:\n${err.stack}`);
    status.close();
});
status.on('listening', function () {
    let address = status.address();
    //UNCOMNET FOR DEBUG
    console.log(`UDP STATUS SERVER - ${address.address}:${address.port}`);
});
status.on('message', function (message, remote) {//AGV 100ms for each MSG
    //UNCOMNET FOR DEBUG
    //console.log(new Date().getTime())
    //console.log(`${remote.address}:${remote.port} - ${message}`);
});
status.bind(port_status);


//###OTHER FUNCTIONS
function sendCMD(command){//SEND BYTE ARRAY TO TELLO OVER UDP
    return new Promise((resolve, reject) => {
        let msg = Buffer.from(command);
        server.send(msg, 0, msg.length, port_cmd, tello, function (err) {// tello - 192.168.10.1
          if (err) {
            console.error(err);
            reject(`ERROR : ${command}`);
          } else resolve('OK');
        });
      });
}
function getRC(axis, axis_map){//GET GAMEPAD AXIS BASED ON GAMEPAD VENDOR
    let obj = {a: 0, b: 0, c: 0, d: 0};
    let axis_arr = Object.keys(axis);//{ '0': false, '1': false, '2': false, '3': false }
    for(let i in axis_arr){
        let temp = Object.keys(axis_map[axis_arr[i]]);//{d: 1}
        obj[temp[0]] = axis[axis_arr[i]] ? parseInt((axis[axis_arr[i]] * 100) * axis_map[axis_arr[i]][temp[0]], 0) : 0;        
    }
    return `rc ${obj.a} ${obj.b} ${obj.c} ${obj.d}`;    
}
function getVendor(device){//GET GAMEPAD VENDOR ID FOR MAPPING
    let controllerType = '';
    if(device !== undefined){
        if(device.vendorID == '1118'){
            controllerType =  'xbox_1';
        }
        else if(device.vendorID == '1356'){
            controllerType =  'ps4';
        }
        else{
            controllerType = 'ps4';
        }
    }
    else{
        controllerType = 'ps4';
    }
    console.log(`YOU CONNECTED A ${controllerType} CONTROLLER`);
    return controllerType;
}