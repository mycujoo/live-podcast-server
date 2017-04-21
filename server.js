'use strict'

require('dotenv').load({ silent: false })

const fs = require('fs')
const Primus = require('primus')
const uglifyJs = require('uglify-js')
const path = require('path')
const lame = require('lame')
const debug = require('debug')('live-podcast')
const isStream = require('isstream')

const PORT = process.env.PORT || 9200
const isSecure = process.env.SSL_KEY && process.env.SSL_CERT
const isWritableStream = isStream.isWritable
const app = require('connect')()
const cors = require('cors')

let server

if (isSecure) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY),
        cert: fs.readFileSync(process.env.SSL_CERT),
    }

    server = require('https').createServer(options, app)
} else {
    server = require('http').createServer(app)
}

const primus = new Primus(server, {
    transformer: 'websockets',
    parser: 'binary',
    transport: {
        binaryType: 'arraybuffer',
        perMessageDeflate: false
    }
})

primus.plugin('rooms', require('primus-rooms'))
primus.plugin('emitter', require('primus-emitter'))

debug('generating, minifying and saving primus.js client...')

const primusJsClient = uglifyJs.minify(primus.library(), {
    fromString: true
})

fs.writeFileSync(path.resolve(__dirname, 'public', 'primus.js'), primusJsClient.code, 'utf8')

debug('done!')

if (process.env.NODE_ENV !== 'production') {
    const serveStatic = require('serve-static')

    app.use('/', serveStatic(__dirname + '/static'))
    app.use('/public', serveStatic(__dirname + '/public'))
}

app.use(cors())

/**
 * Used to keep track of live broadcasts
 * { sparkId: roomName }
 */
const liveBroadcasts = {}

/**
 * Used to keep track of live rooms.
 * This Set prevents us from iterating over
 * objects/arrays on every action.
 */
const liveRooms = new Set()

/**
 * Used to save a reference to the encoder
 * and output streams.
 */
const activeStreams = {}

/**
 * Used to check if a given room has a
 * live broadcast.
 */
app.use('/broadcasts', (req, res, next) => {
    const statusCode = liveRooms.has(req.url.replace('/', ''))
        ? 200
        : 404

    res.writeHead(statusCode)
    res.end()
})

primus.on('connection', (spark) => {

    spark.on('join', spark.join)

    spark.on('broadcast_started', (room) => {
        startBroadcast(spark, room)
    })

    spark.on('broadcast_stopped', (room) => {
        stopBroadcast(spark)
    })

    spark.on('data', (data) => {
        // host can only be in one room
        const sparkRoom = spark.rooms()[0]

        spark
            .in(sparkRoom)
            .except(spark.id)
            .write(data)

        if (data.buffer && activeStreams[spark.id]
            && isWritableStream(activeStreams[spark.id].encoder)) {
            activeStreams[spark.id].encoder.write(data)
        }
    })

    spark.on('joinroom', (room) => {
        const totalClients = spark.room(room).clients().length
        debug(`client '${spark.id} | ${spark.address.ip}' joined room '${room}' [total clients: ${totalClients}]`)
    })

    spark.on('leaveallrooms', (room) => {
        const totalClients = primus.room(room).clients().length
        debug(`client '${spark.id} | ${spark.address.ip}' left rooms '${room}' [total clients: ${totalClients}]`)

        if (liveBroadcasts[spark.id]) {
            stopBroadcast(spark)
        }
    })

})

server.listen(PORT, (err) => {
    if (err) {
        throw err
    }

    console.info(`listening on ${isSecure ? 'https' : 'http'}://localhost:${PORT}`)
})

function startBroadcast(spark, room) {
    liveBroadcasts[spark.id] = room
    liveRooms.add(room)

    debug(`client '${spark.id} | ${spark.address.ip}' started broadcasting to room '${room}'`)

    startStream(spark, room)
}

function stopBroadcast(spark) {
    const liveRoom = liveBroadcasts[spark.id]

    if (liveRoom) {
        liveRooms.delete(liveRoom)
        delete liveBroadcasts[spark.id]

        debug(`client '${spark.id} | ${spark.address.ip}' stopped broadcasting to room '${liveRoom}'`)
    }

    stopStream(spark)
}

function startStream(spark, room) {
    const timestamp = (new Date()).toISOString().replace(/:/g, '.')
    const fileName = `${timestamp}__${room}__${spark.id}.mp3`

    debug(`recording to ${fileName}`)

    activeStreams[spark.id] = {
        encoder: new lame.Encoder({ channels: 1, bitDepth: 32, float: true, sampleRate: 44100, bitRate: 128, outSampleRate: 22050, mode: lame.MONO }),
        output: fs.createWriteStream(path.resolve(__dirname, 'recordings', fileName))
    }

    activeStreams[spark.id].encoder.on('data', (data) => {
        if (isWritableStream(activeStreams[spark.id].output)) {
            activeStreams[spark.id].output.write(data)
        }
    })
}

function stopStream(spark) {
    activeStreams[spark.id].output.end()
}

function onExit(code) {
    debug(`about to exit with code ${code}`)

    debug('closing encoder/output streams...')

    for (let key in activeStreams) {
        if (activeStreams[key].encoder && isWritableStream(activeStreams[key].encoder)) {
            activeStreams[key].encoder.end()
        }

        if (activeStreams[key].output && isWritableStream(activeStreams[key].output)) {
            activeStreams[key].output.end()
        }
    }

    debug('all good! bye bye :)')
}

process.on('exit', onExit)
process.on('beforeExit', onExit)

process.on('uncaughtException', (err) => {
    console.error(err)
})

process.on('SIGINT', () => {
    debug('got SIGINT. Exiting...')

    process.exit()
})
