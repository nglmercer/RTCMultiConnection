const express = require('express');
const path = require('path');
const url = require('url');
const fs = require('fs');
const http = require('http'); // or https depending on config

const socketIO = require('socket.io');
const RTCMultiConnectionServer = require('rtcmulticonnection-server');

const app = express();
let PORT = 9002;
let isUseHTTPs = false;

const jsonPath = {
    config: 'config.json',
    logs: 'logs.json'
};

const BASH_COLORS_HELPER = RTCMultiConnectionServer.BASH_COLORS_HELPER;
const getValuesFromConfigJson = RTCMultiConnectionServer.getValuesFromConfigJson;
const getBashParameters = RTCMultiConnectionServer.getBashParameters;
const resolveURL = RTCMultiConnectionServer.resolveURL;

let config = getValuesFromConfigJson(jsonPath);
config = getBashParameters(config, BASH_COLORS_HELPER);

if (PORT === 9001) {
    PORT = config.port;
}
if (isUseHTTPs === false) {
    isUseHTTPs = config.isUseHTTPs;
}

function pushLogs(config, errorType, error) {
    // This is a placeholder for your logging function.
    // In the original code, it's assumed to be RTCMultiConnectionServer.pushLogs,
    // but it's not defined in the provided snippet.
    // You might need to implement or replace this with your actual logging mechanism.
    console.error(`[${errorType}]`, error);
}


// Middleware to serve static files
const staticPaths = [
    '/demos',
    '/dev',
    '/dist',
    '/socket.io',
    '/node_modules/canvas-designer',
    '/admin',
    '/node_modules' // For files like RecordRTC.js, etc.
];

staticPaths.forEach(staticPath => {
    app.use(staticPath, express.static(path.join(config.dirPath ? resolveURL(config.dirPath) : process.cwd(), staticPath.substring(1))));
});

// Special handling for root directory to serve from config.dirPath or process.cwd()
const rootDir = config.dirPath ? resolveURL(config.dirPath) : process.cwd();
app.use('/', express.static(rootDir, { index: false })); // Disable directory indexing for root

// Route handler for all GET requests not handled by static middleware
app.get('*', (req, res) => {
    // to make sure we always get valid info from json file
    // even if external codes are overriding it
    config = getValuesFromConfigJson(jsonPath);
    config = getBashParameters(config, BASH_COLORS_HELPER);

    const uri = url.parse(req.url).pathname;
    let filename = path.join(rootDir, uri);

    if (req.method !== 'GET' || uri.includes('..')) {
        return res.status(401).type('text/plain').send('401 Unauthorized: ' + path.join('/', uri) + '\n');
    }

    if (filename.includes(resolveURL('/admin/')) && config.enableAdmin !== true) {
        return res.status(401).type('text/plain').send('401 Unauthorized: ' + path.join('/', uri) + '\n');
    }

    let matchedStaticPath = false;
    staticPaths.forEach(item => {
        if (filename.includes(resolveURL(item.substring(1)))) { // substring to remove leading '/' for path.join comparison
            matchedStaticPath = true;
        }
    });

    if (!matchedStaticPath) {
        const jsJSONRegex = /.*\.js$|.*\.json$/g;
        if (filename.match(jsJSONRegex)) {
             return res.status(404).type('text/plain').send('404 Not Found: ' + path.join('/', uri) + '\n');
        }
    }


    ['Video-Broadcasting', 'Screen-Sharing', 'Switch-Cameras'].forEach(fname => {
        if (filename.includes(fname + '.html')) {
            filename = filename.replace(fname + '.html', fname.toLowerCase() + '.html');
        }
    });

    fs.stat(filename, (err, stats) => {
        if (err) {
            return res.status(404).type('text/plain').send('404 Not Found: ' + path.join('/', uri) + '\n');
        }

        if (stats.isDirectory()) {
            if (filename.includes(resolveURL('/demos/MultiRTC/'))) {
                filename = path.join(filename, 'index.html');
            } else if (filename.includes(resolveURL('/admin/'))) {
                filename = path.join(filename, 'index.html');
            } else if (filename.includes(resolveURL('/demos/dashboard/'))) {
                filename = path.join(filename, 'index.html');
            } else if (filename.includes(resolveURL('/demos/video-conference/'))) {
                filename = path.join(filename, 'index.html');
            } else if (filename.includes(resolveURL('/demos'))) {
                filename = path.join(filename, 'index.html');
            } else if (config.homePage) {
                filename = path.join(rootDir, config.homePage.startsWith('/') ? config.homePage.substring(1) : config.homePage); // Ensure no leading slash for path.join
            } else {
                return res.status(404).type('text/plain').send('404 Not Found: Directory index is not configured.\n');
            }
        }

        let contentType = 'text/plain';
        if (filename.toLowerCase().endsWith('.html')) {
            contentType = 'text/html';
        } else if (filename.toLowerCase().endsWith('.css')) {
            contentType = 'text/css';
        } else if (filename.toLowerCase().endsWith('.png')) {
            contentType = 'image/png';
        }

        fs.readFile(filename, 'binary', (err, file) => {
            if (err) {
                return res.status(500).type('text/plain').send('500 Internal Server Error: Could not read file.\n' + err.message);
            }

            try {
                if (contentType === 'text/html') {
                    file = file.toString().replace('connection.socketURL = \'/\';', 'connection.socketURL = \'' + config.socketURL + '\';');
                }
            } catch (e) {
                pushLogs(config, 'HTML Replace Error', e);
            }

            res.status(200).type(contentType).send(file);
        });
    });
});


let httpServer;
if (isUseHTTPs) {
    const options = {
        key: null,
        cert: null,
        ca: null,
    };

    let pfx = false;

    if (!fs.existsSync(config.sslKey)) {
        console.log(BASH_COLORS_HELPER.getRedFG(), 'sslKey:\t ' + config.sslKey + ' does not exist.');
    } else {
        pfx = config.sslKey.indexOf('.pfx') !== -1;
        options.key = fs.readFileSync(config.sslKey);
    }

    if (!fs.existsSync(config.sslCert)) {
        console.log(BASH_COLORS_HELPER.getRedFG(), 'sslCert:\t ' + config.sslCert + ' does not exist.');
    } else {
        options.cert = fs.readFileSync(config.sslCert);
    }

    if (config.sslCabundle) {
        if (!fs.existsSync(config.sslCabundle)) {
            console.log(BASH_COLORS_HELPER.getRedFG(), 'sslCabundle:\t ' + config.sslCabundle + ' does not exist.');
        }
        options.ca = fs.readFileSync(config.sslCabundle);
    }

    if (pfx === true) {
        options.pfx = config.sslKey; // Assuming sslKey contains the pfx path
    }

    httpServer = require('https').createServer(options, app);
} else {
    httpServer = http.createServer(app);
}


RTCMultiConnectionServer.beforeHttpListen(app, config); // Changed httpApp to app
httpServer.listen(process.env.PORT || PORT, process.env.IP || "0.0.0.0", () => {
    RTCMultiConnectionServer.afterHttpListen(httpServer, config);
    console.log(`Server listening on http${isUseHTTPs ? 's' : ''}://${process.env.IP || "0.0.0.0"}:${process.env.PORT || PORT}`);
});


// Socket.io integration
const io = socketIO(httpServer);
io.on('connection', function(socket) {
    RTCMultiConnectionServer.addSocket(socket, config);

    const params = socket.handshake.query;
    if (!params.socketCustomEvent) {
        params.socketCustomEvent = 'custom-message';
    }

    socket.on(params.socketCustomEvent, function(message) {
        socket.broadcast.emit(params.socketCustomEvent, message);
    });
});